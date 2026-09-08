begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Additive status metadata only. Existing jobs, links, uploads, pricing and
-- immutable accounting files are not rewritten by this migration.
alter table public.jobs add column if not exists invoice_review_at timestamptz;
comment on column public.jobs.invoice_review_at is
  'Closed but awaiting an invoicing discussion. Blue in accounting exports until explicitly resolved; never automatically handed off.';

create or replace function public.clear_reactivated_job_cancellation()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.active then
    new.cancelled_at := null;
  end if;
  if new.active or new.cancelled_at is not null then
    new.invoice_review_at := null;
  end if;
  if tg_op = 'UPDATE' then
    if new.invoice_review_at is distinct from old.invoice_review_at then
      new.accounting_status_changed_at := clock_timestamp();
    end if;
  elsif new.invoice_review_at is not null then
    new.accounting_status_changed_at := clock_timestamp();
  end if;
  return new;
end;
$$;
revoke all on function public.clear_reactivated_job_cancellation() from public, anon, authenticated;
drop trigger if exists clear_reactivated_job_cancellation on public.jobs;
create trigger clear_reactivated_job_cancellation
before insert or update of active, cancelled_at, invoice_review_at on public.jobs
for each row execute function public.clear_reactivated_job_cancellation();

-- Imports that omit the new field preserve it while inactive. Reactivation
-- anywhere clears it, just as it already clears a cancellation.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'jobs_invoice_review_closed' and conrelid = 'public.jobs'::regclass) then
    alter table public.jobs add constraint jobs_invoice_review_closed
      check (invoice_review_at is null or (active = false and cancelled_at is null));
  end if;
end;
$$;

create or replace function private.job_accounting_source_snapshot()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'jobNumber', btrim(j.job_number), 'jobName', j.job_name,
    'active', j.active, 'cancelledAt', j.cancelled_at,
    'invoiceReviewAt', j.invoice_review_at,
    'statusChangedAt', j.accounting_status_changed_at,
    'projectManager', coalesce(j.project_manager, ''), 'jobType', coalesce(j.job_type, ''),
    'customer', coalesce(j.customer, ''), 'site', coalesce(j.site_name, ''),
    'address', coalesce(j.address, ''), 'startDate', j.start_date, 'targetEndDate', j.target_end_date,
    'price', case when coalesce(e.item->>'quoteId', '') <> '' then e.item->'acceptedRevenue' else null end,
    'extras', case when coalesce(e.item->>'quoteId', '') <> '' then e.item->'approvedRevenueChanges' else null end,
    'acceptedAt', case when coalesce(e.item->>'quoteId', '') <> '' then e.item->>'acceptedAt' else null end,
    'customerPo', coalesce(q.frozen->>'customerPo', ''),
    'quoteReference', coalesce(q.frozen->>'reference', '')
  ) order by btrim(j.job_number)), '[]'::jsonb)
  from public.jobs j
  left join lateral (
    select x.item from public.estimator_workspaces w,
      lateral jsonb_array_elements(coalesce(w.payload->'jobs','[]'::jsonb)) x(item)
    where w.id = 'main' and (x.item->>'portalJobId' = j.id::text
      or (coalesce(x.item->>'portalJobId','') = '' and btrim(x.item->>'jobNumber') = btrim(j.job_number)))
    order by (x.item->>'portalJobId' = j.id::text) desc limit 1
  ) e on true
  left join lateral (
    select case when (e.item->>'acceptedQuoteSnapshot') is json object
      then (e.item->>'acceptedQuoteSnapshot')::jsonb else '{}'::jsonb end as frozen
  ) q on true;
$$;

create or replace function private.prepare_job_accounting_export()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare preview jsonb; bytes bytea;
begin
  if auth.uid() is null or not private.jgc_has_accounting_access() then
    raise exception 'Approved administrator access is required.' using errcode = '42501';
  end if;
  if not pg_try_advisory_xact_lock(726481,1) then
    raise exception 'Another accounting action is in progress. Refresh the preview and try again.' using errcode = '40001';
  end if;
  preview := public.get_job_accounting_export_preview();
  if new.source_snapshot is distinct from preview->'sourceSnapshot'
     or new.previous_export_id::text is distinct from preview->>'previousExportId'
     or new.version is distinct from (preview->>'version')::integer
     or new.cycle is distinct from (preview->>'cycle')::integer then
    raise exception 'Jobs or download history changed. Refresh the preview before creating a new version.' using errcode = '40001';
  end if;
  if exists (select 1 from jsonb_array_elements(new.rows) r where
    length(coalesce(r->>'jobNumber','')) not between 1 and 100
    or coalesce(r->>'color','') not in ('white','green','yellow','red','blue')
    or jsonb_typeof(r->'cells') is distinct from 'array'
    or jsonb_array_length(r->'cells') <> 16)
    or (select count(*) from jsonb_array_elements(new.rows)) <>
       (select count(distinct r->>'jobNumber') from jsonb_array_elements(new.rows) r) then
    raise exception 'The accounting file contains invalid or duplicate job rows.' using errcode = '22023';
  end if;
  -- An already-open older app must not export a discussion job as green/yellow
  -- or omit it. Require the new blue semantics before saving a version.
  if exists (
    select 1 from jsonb_array_elements(preview->'sourceSnapshot') j
    where nullif(j->>'invoiceReviewAt','') is not null
      and not exists (select 1 from jsonb_array_elements(new.rows) r
        where r->>'jobNumber' = j->>'jobNumber' and r->>'color' = 'blue')
  ) then
    raise exception 'Invoice discussion flags changed. Refresh Estimate Desk before creating this download.' using errcode = '40001';
  end if;
  bytes := decode(new.file_base64,'base64');
  if substring(bytes from 1 for 4) <> decode('504b0304','hex')
    or encode(extensions.digest(bytes,'sha256'),'hex') <> new.file_sha256 then
    raise exception 'The Excel file failed its integrity check. No version was saved.' using errcode = '22023';
  end if;
  new.exported_by := auth.uid();
  select coalesce(nullif(btrim(p.display_name),''),'Administrator') into new.exported_by_name from public.profiles p where p.id = auth.uid();
  new.exported_at := clock_timestamp();
  new.file_name := 'JGC Accounting Job List - v' || lpad(new.version::text,greatest(4,length(new.version::text)),'0')
    || '.xlsx';
  return new;
end;
$$;
commit;
