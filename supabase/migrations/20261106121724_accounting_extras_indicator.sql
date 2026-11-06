-- Only the accounting administrator needs the set of job IDs for this export.
create function private.accounting_tm_extra_job_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select distinct x.job_id from public.job_tm_extras x
  where public.is_admin() and private.jgc_has_full_portal_access();
$$;
revoke all on function private.accounting_tm_extra_job_ids() from public, anon;
grant execute on function private.accounting_tm_extra_job_ids() to authenticated;

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
