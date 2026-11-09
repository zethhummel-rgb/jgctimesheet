begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Additive metadata. Old inactive/imported jobs have no verified closure date.
-- Do not infer one from target dates, modification dates or billing hand-offs.
alter table public.jobs add column closed_at timestamptz;
comment on column public.jobs.closed_at is
  'Server-recorded time of the current Portal closure. Reopening or cancellation clears it; existing unknown dates remain null.';

create function private.set_job_closed_at()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.active or new.cancelled_at is not null then
    new.closed_at := null;
  elsif tg_op = 'INSERT' then
    -- An inactive imported record is not evidence it was closed today.
    new.closed_at := null;
  elsif old.active or old.cancelled_at is not null then
    new.closed_at := clock_timestamp();
  else
    -- Repeated status clicks, invoice discussion changes and edits preserve it.
    -- A client cannot rewrite a recorded date or manufacture a historical one.
    new.closed_at := old.closed_at;
  end if;
  return new;
end;
$$;
revoke all on function private.set_job_closed_at() from public, anon, authenticated;
create trigger set_job_closed_at
before insert or update of active, cancelled_at, closed_at on public.jobs
for each row execute function private.set_job_closed_at();
alter table public.jobs add constraint jobs_closed_at_state
  check (closed_at is null or (active = false and cancelled_at is null));

create or replace function private.job_accounting_source_snapshot()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'jobNumber', btrim(j.job_number), 'jobName', j.job_name,
    'active', j.active, 'cancelledAt', j.cancelled_at,
    'invoiceReviewAt', j.invoice_review_at,
    'closedAt', j.closed_at,
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

commit;
