-- Durable receipts make retries safe even after the browser loses the response.
-- Financial data stays in the existing admin-only workspace, never public.jobs.
create table public.portal_job_creation_receipts (
  request_id uuid primary key,
  job_id uuid not null unique,
  job_number text not null unique,
  quote_id text unique,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);
alter table public.portal_job_creation_receipts enable row level security;
revoke all on public.portal_job_creation_receipts from public, anon, authenticated;
grant select, insert on public.portal_job_creation_receipts to authenticated;
create policy portal_job_creation_admin_read on public.portal_job_creation_receipts
  for select to authenticated using ((select private.jgc_has_estimator_admin_access()));
create policy portal_job_creation_admin_insert on public.portal_job_creation_receipts
  for insert to authenticated with check ((select private.jgc_has_estimator_admin_access()) and created_by = (select auth.uid()));

create function public.create_portal_job(p_request_id uuid, p_expected_revision bigint, p_job jsonb, p_client jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  workspace public.estimator_workspaces%rowtype;
  receipt public.portal_job_creation_receipts%rowtype;
  job_id uuid := gen_random_uuid();
  job_number text;
  year_base integer;
  next_number integer;
  job_date date;
  v_quote_id text := nullif(p_job->>'quoteId','');
  quote jsonb;
  saved_job jsonb;
  client_list jsonb;
  quote_list jsonb;
  stamp timestamptz;
begin
  if auth.uid() is null or not private.jgc_has_estimator_admin_access() then
    raise exception 'Approved administrator access is required.' using errcode = '42501';
  end if;
  -- All creators lock the same workspace row before checking retries, quotes or numbers.
  select * into workspace from public.estimator_workspaces where id = 'main' for update;
  if not found then raise exception 'Reload the job list before creating a job.' using errcode = '40001'; end if;
  select * into receipt from public.portal_job_creation_receipts where request_id = p_request_id;
  if found then
    return jsonb_build_object('jobId',receipt.job_id,'jobNumber',receipt.job_number,'reused',true);
  end if;
  if workspace.revision is distinct from p_expected_revision then
    raise exception 'The shared job list or estimate changed. Reload the page and review the details before creating the job.' using errcode = '40001';
  end if;
  if p_request_id is null or coalesce(btrim(p_job->>'project'),'') = ''
    or coalesce(btrim(p_client->>'name'),'') = '' or coalesce(p_client->>'id','') = ''
    or p_job->>'clientId' is distinct from p_client->>'id'
    or coalesce(btrim(p_job->>'projectManager'),'') = ''
    or coalesce(p_job->>'jobType','') not in ('Contract','T&M') then
    raise exception 'Client, job name, job type and project manager: this information is required.' using errcode = '22023';
  end if;
  if (p_job->>'jobType' = 'Contract' and coalesce((p_job->>'hasQuotedValue')::boolean,false) = false)
    or jsonb_typeof(p_job->'acceptedRevenue') is distinct from 'number'
    or (p_job->>'acceptedRevenue')::numeric < 0 then
    raise exception 'Customer quoted price before tax: this information is required.' using errcode = '22023';
  end if;
  if coalesce(p_job->>'documentLink','') <> '' and p_job->>'documentLink' !~ '^https://[^[:space:]]+$' then
    raise exception 'Use a secure https:// document link.' using errcode = '22023';
  end if;
  if nullif(p_job->>'targetEndDate','')::date < nullif(p_job->>'startDate','')::date then
    raise exception 'Target completion cannot be before the start date.' using errcode = '22023';
  end if;
  if v_quote_id is not null then
    select item into quote from jsonb_array_elements(workspace.payload->'quotes') item where item->>'id' = v_quote_id;
    if quote is null or quote->>'status' <> 'Finished' or quote->>'documentKind' = 'Change Notice'
      or quote->>'clientId' is distinct from p_client->>'id'
      or exists (select 1 from jsonb_array_elements(workspace.payload->'jobs') item where item->>'quoteId' = v_quote_id)
      or exists (select 1 from public.portal_job_creation_receipts r where r.quote_id = v_quote_id) then
      raise exception 'This quote is no longer available to make into a job.' using errcode = '22023';
    end if;
  end if;
  stamp := clock_timestamp();
  job_date := (stamp at time zone 'America/Toronto')::date;
  year_base := (extract(year from job_date)::integer % 100) * 1000;
  select greatest(year_base,coalesce(max(n),year_base)) + 1 into next_number from (
    select j.job_number::integer n from public.jobs j where j.job_number ~ '^[0-9]{5}$'
    union all select r.job_number::integer from public.portal_job_creation_receipts r
    union all select (item->>'jobNumber')::integer from jsonb_array_elements(workspace.payload->'jobs') item where item->>'jobNumber' ~ '^[0-9]{5}$'
  ) numbers where n >= year_base and n < year_base + 1000;
  if next_number >= year_base + 1000 then raise exception 'The job number range for this year is full.' using errcode = '22023'; end if;
  job_number := lpad(next_number::text,5,'0');
  insert into public.jobs(id,job_number,job_name,active,job_type,project_manager,customer,address,site_name,start_date,target_end_date,document_link,document_link_label)
  values(job_id,job_number,btrim(p_job->>'project'),true,p_job->>'jobType',btrim(p_job->>'projectManager'),btrim(p_client->>'name'),p_job->>'portalAddress',p_job->>'portalSiteName',nullif(p_job->>'startDate','')::date,nullif(p_job->>'targetEndDate','')::date,p_job->>'documentLink','Open Project Documents');
  saved_job := p_job || jsonb_build_object('id',job_id,'portalJobId',job_id,'jobNumber',job_number,
    'status','Active','portalActive',true,'portalJobName',btrim(p_job->>'project'),'portalCustomer',btrim(p_client->>'name'),
    'acceptedAt',stamp,'jobDate',job_date,'portalLastSyncedAt',stamp,
    'acceptedQuoteSnapshot',case when quote is null then '' else (quote || jsonb_build_object('revisions','[]'::jsonb))::text end,
    'acceptedQuoteRevision',quote->'revision');
  select coalesce(jsonb_agg(case when item->>'id'=p_client->>'id' then p_client else item end),'[]'::jsonb)
    into client_list from jsonb_array_elements(workspace.payload->'clients') item;
  if not exists(select 1 from jsonb_array_elements(client_list) item where item->>'id'=p_client->>'id') then client_list := client_list || jsonb_build_array(p_client); end if;
  select coalesce(jsonb_agg(case when item->>'id'=v_quote_id then item || jsonb_build_object('status','Won','wonAt',stamp,'updatedAt',stamp,'jobId',job_id) else item end),'[]'::jsonb)
    into quote_list from jsonb_array_elements(workspace.payload->'quotes') item;
  update public.estimator_workspaces set payload = workspace.payload || jsonb_build_object(
    'clients',client_list,'quotes',quote_list,'jobs',jsonb_build_array(saved_job) || coalesce(workspace.payload->'jobs','[]'::jsonb),
    'activity',jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'quoteId',v_quote_id,'title','Job created','detail','Portal job ' || job_number || ' created.','createdAt',stamp)) || coalesce(workspace.payload->'activity','[]'::jsonb)) where id='main';
  insert into public.portal_job_creation_receipts(request_id,job_id,job_number,quote_id) values(p_request_id,job_id,job_number,v_quote_id);
  return jsonb_build_object('jobId',job_id,'jobNumber',job_number);
end;
$$;
revoke all on function public.create_portal_job(uuid,bigint,jsonb,jsonb) from public,anon;
grant execute on function public.create_portal_job(uuid,bigint,jsonb,jsonb) to authenticated;

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
    'jobDate', e.item->>'jobDate', 'subcontractors', e.item->>'subcontractors',
    'acceptedAt', case when (coalesce(e.item->>'quoteId', '') <> '' or e.item->>'hasQuotedValue' = 'true' or coalesce(e.item->>'jobDate','') <> '') then e.item->>'acceptedAt' else null end,
    'customerPo', coalesce(nullif(e.item->>'clientReference',''), q.frozen->>'customerPo', ''),
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
