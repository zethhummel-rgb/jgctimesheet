begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Billing requests are separate from operational job status and estimator autosaves.
create table public.job_progress_billing_requests (
  id uuid primary key,
  job_id uuid not null references public.jobs(id) on delete restrict,
  requested_at timestamptz not null default clock_timestamp(),
  requested_by uuid not null references public.profiles(id) on delete restrict,
  requested_by_name text not null,
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles(id) on delete restrict,
  cancelled_by_name text,
  exported_at timestamptz,
  export_id uuid,
  export_cycle integer,
  export_version integer,
  export_color text check (export_color in ('orange','green','blue','yellow','red')),
  check (cancelled_at is null or exported_at is null)
);
-- Keep the hand-off receipt even when accounting download history is reset.
create unique index job_progress_billing_pending_idx on public.job_progress_billing_requests(job_id)
  where exported_at is null and cancelled_at is null;
create index job_progress_billing_history_idx on public.job_progress_billing_requests(job_id, requested_at desc, id);
create index job_progress_billing_author_idx on public.job_progress_billing_requests(requested_by);
create index job_progress_billing_cancel_author_idx on public.job_progress_billing_requests(cancelled_by);
alter table public.job_progress_billing_requests enable row level security;
revoke all on public.job_progress_billing_requests from public, anon, authenticated;
grant select on public.job_progress_billing_requests to authenticated, service_role;
create policy progress_billing_admin_read on public.job_progress_billing_requests for select to authenticated
  using ((select private.jgc_has_accounting_access()) and (select private.jgc_has_full_portal_access()));

create function private.change_job_progress_billing(p_job_id uuid, p_request_id uuid, p_action text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare j public.jobs; r public.job_progress_billing_requests; actor_name text;
begin
  if auth.uid() is null or not private.jgc_has_accounting_access() or not private.jgc_has_full_portal_access() then
    raise exception 'Approved administrator access is required.' using errcode = '42501';
  end if;
  if p_request_id is null or p_job_id is null or p_action not in ('request','cancel') or p_action is null then
    raise exception 'Choose a job and a valid progress billing action.' using errcode = '22023';
  end if;
  -- Serialize requests/cancellations with accounting saves and history resets.
  if not pg_try_advisory_xact_lock(726481,1) then
    raise exception 'Another accounting action is in progress. Please retry.' using errcode = '40001';
  end if;
  select * into r from public.job_progress_billing_requests where id = p_request_id;
  if found and r.job_id <> p_job_id then
    raise exception 'This request belongs to another job.' using errcode = '22023';
  end if;
  if p_action = 'request' and r.id is not null then return to_jsonb(r); end if;
  select coalesce(nullif(btrim(display_name),''),'Administrator') into actor_name from public.profiles where id = auth.uid();
  if p_action = 'cancel' then
    if r.id is null then raise exception 'The request was not found.' using errcode = '22023'; end if;
    if r.exported_at is not null then raise exception 'This request is already in a saved accounting version.' using errcode = '40001'; end if;
    if r.cancelled_at is null then
      update public.job_progress_billing_requests set cancelled_at = clock_timestamp(), cancelled_by = auth.uid(), cancelled_by_name = actor_name
      where id = r.id returning * into r;
    end if;
    return to_jsonb(r);
  end if;
  select * into j from public.jobs where id = p_job_id for share;
  if not found or not j.active or j.cancelled_at is not null then
    raise exception 'Progress billing is available for active jobs.' using errcode = '22023';
  end if;
  select * into r from public.job_progress_billing_requests where job_id = p_job_id and exported_at is null and cancelled_at is null;
  if found then return to_jsonb(r); end if;
  insert into public.job_progress_billing_requests(id,job_id,requested_by,requested_by_name)
    values(p_request_id,p_job_id,auth.uid(),actor_name) returning * into r;
  return to_jsonb(r);
end;
$$;
revoke all on function private.change_job_progress_billing(uuid,uuid,text) from public, anon;
grant execute on function private.change_job_progress_billing(uuid,uuid,text) to authenticated;
create function public.change_job_progress_billing(p_job_id uuid, p_request_id uuid, p_action text)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.change_job_progress_billing(p_job_id,p_request_id,p_action);
$$;
revoke all on function public.change_job_progress_billing(uuid,uuid,text) from public, anon;
grant execute on function public.change_job_progress_billing(uuid,uuid,text) to authenticated;

create or replace function private.job_accounting_source_snapshot()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'jobNumber', btrim(j.job_number), 'jobName', j.job_name,
    'active', j.active, 'cancelledAt', j.cancelled_at,
    'invoiceReviewAt', j.invoice_review_at,
    'progressBillingRequestId', (select r.id from public.job_progress_billing_requests r
      where r.job_id = j.id and r.exported_at is null and r.cancelled_at is null),
    'statusChangedAt', j.accounting_status_changed_at,
    'projectManager', coalesce(j.project_manager, ''), 'jobType', coalesce(j.job_type, ''),
    'customer', coalesce(j.customer, ''), 'site', coalesce(j.site_name, ''),
    'address', coalesce(j.address, ''), 'startDate', j.start_date, 'targetEndDate', j.target_end_date,
    'price', case when (coalesce(e.item->>'quoteId', '') <> '' or e.item->>'hasQuotedValue' = 'true' or coalesce(e.item->>'jobDate','') <> '') and coalesce(e.item->>'hasQuotedValue','true') <> 'false' then e.item->'acceptedRevenue' else null end,
    'extras', case when (coalesce(e.item->>'quoteId', '') <> '' or e.item->>'hasQuotedValue' = 'true' or coalesce(e.item->>'jobDate','') <> '') then e.item->'approvedRevenueChanges' else null end,
    'hasExtras', j.id in (select * from private.accounting_tm_extra_job_ids())
      or exists (
        select 1 from public.estimator_workspaces workspace
        cross join lateral jsonb_array_elements(workspace.payload->'quotes') as changes(item)
        where workspace.id = 'main' and changes.item->>'documentKind' = 'Change Notice'
          and changes.item->>'jobId' = e.item->>'id'
          and jsonb_typeof(changes.item->'changeOrder') = 'object'
      ),
    'jobDate', e.item->>'jobDate', 'subcontractors', e.item->>'subcontractors',
    'acceptedAt', case when (coalesce(e.item->>'quoteId', '') <> '' or e.item->>'hasQuotedValue' = 'true' or coalesce(e.item->>'jobDate','') <> '') then e.item->>'acceptedAt' else null end,
    'customerPo', coalesce(e.item->>'clientReference', q.frozen->>'customerPo', ''),
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
    or coalesce(r->>'color','') not in ('white','green','yellow','red','blue','orange')
    or jsonb_typeof(r->'cells') is distinct from 'array'
    or jsonb_array_length(r->'cells') <> 16)
    or (select count(*) from jsonb_array_elements(new.rows)) <>
       (select count(distinct r->>'jobNumber') from jsonb_array_elements(new.rows) r) then
    raise exception 'The accounting file contains invalid or duplicate job rows.' using errcode = '22023';
  end if;
  -- A first/new discussion event is blue. Once handed off it is yellow, even
  -- after detail-only edits. A reset has no previous export and starts blue.
  -- Reject stale clients rather than letting them omit or recolour the event.
  if exists (
    select 1 from jsonb_array_elements(preview->'sourceSnapshot') j
    where nullif(j->>'invoiceReviewAt','') is not null
      and not exists (
        select 1 from jsonb_array_elements(new.rows) r
        where lower(btrim(r->>'jobNumber')) = lower(btrim(j->>'jobNumber'))
          and r->>'color' = case when preview->>'previousExportId' is not null
            and exists (
              select 1 from jsonb_array_elements(preview->'previousRows') old_row
              where lower(btrim(old_row->>'jobNumber')) = lower(btrim(j->>'jobNumber'))
                and old_row->>'color' in ('blue','yellow')
            )
            and not exists (
              select 1 from jsonb_array_elements(preview->'previousSnapshot') before_job
              where lower(btrim(before_job->>'jobNumber')) = lower(btrim(j->>'jobNumber'))
                and (before_job->>'statusChangedAt' is distinct from j->>'statusChangedAt'
                  or before_job->>'active' is distinct from j->>'active'
                  or before_job->>'cancelledAt' is distinct from j->>'cancelledAt'
                  or before_job->>'invoiceReviewAt' is distinct from j->>'invoiceReviewAt')
            ) then 'yellow' else 'blue' end
      )
  ) then
    raise exception 'Invoice discussion hand-offs changed. Refresh Estimate Desk before creating this download.' using errcode = '40001';
  end if;
  -- A stale client cannot consume a request without colouring the row orange.
  if exists (
    select 1 from jsonb_array_elements(preview->'sourceSnapshot') j
    where nullif(j->>'progressBillingRequestId','') is not null
      and not exists (
        select 1 from jsonb_array_elements(new.rows) r
        where lower(btrim(r->>'jobNumber')) = lower(btrim(j->>'jobNumber'))
          and case when (j->>'active')::boolean then r->>'color' = 'orange'
            else r->>'color' in ('green','blue','yellow','red') end
      )
  ) or exists (
    select 1 from jsonb_array_elements(new.rows) r where r->>'color' = 'orange'
      and not exists (
        select 1 from jsonb_array_elements(preview->'sourceSnapshot') j
        where lower(btrim(r->>'jobNumber')) = lower(btrim(j->>'jobNumber'))
          and (j->>'active')::boolean and nullif(j->>'progressBillingRequestId','') is not null
      )
  ) then
    raise exception 'Progress billing changed. Refresh Estimate Desk and the accounting preview.' using errcode = '40001';
  end if;
  bytes := decode(new.file_base64,'base64');
  if substring(bytes from 1 for 4) <> decode('504b0304','hex')
    or encode(extensions.digest(bytes,'sha256'),'hex') <> new.file_sha256 then
    raise exception 'The Excel file failed its integrity check. No version was saved.' using errcode = '22023';
  end if;
  new.exported_by := auth.uid();
  select coalesce(nullif(btrim(p.display_name),''),'Administrator') into new.exported_by_name from public.profiles p where p.id = auth.uid();
  new.exported_at := clock_timestamp();
  new.file_name := 'JGC Accounting Job List - v' || lpad(new.version::text,greatest(4,length(new.version::text)),'0') || '.xlsx';
  return new;
end;
$$;


-- This runs in the same transaction as the immutable workbook insert. Failed saves
-- cannot clear a request; previews and downloads of existing versions never reach it.
create function private.record_progress_billing_export()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not private.jgc_has_accounting_access() then
    raise exception 'Approved administrator access is required.' using errcode = '42501';
  end if;
  update public.job_progress_billing_requests request
    set exported_at = new.exported_at, export_id = new.id, export_cycle = new.cycle,
        export_version = new.version, export_color = r->>'color'
    from jsonb_array_elements(new.source_snapshot) j, jsonb_array_elements(new.rows) r
    where request.id::text = j->>'progressBillingRequestId'
      and lower(btrim(j->>'jobNumber')) = lower(btrim(r->>'jobNumber'))
      and request.cancelled_at is null and request.exported_at is null;
  return new;
end;
$$;
revoke all on function private.record_progress_billing_export() from public, anon, authenticated;
create trigger record_progress_billing_export after insert on public.job_accounting_exports
  for each row execute function private.record_progress_billing_export();
commit;
