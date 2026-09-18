-- Synthetic jobs and workspace edits are rolled back, including allocated numbers.
begin;
select set_config('request.jwt.claim.sub',(select id::text from public.profiles where role='admin' and account_status='approved' order by id limit 1),true);
set local role authenticated;
do $$
declare
  rev bigint; a jsonb; b jsonb; req uuid := gen_random_uuid(); client jsonb;
  draft jsonb; before_count integer; saved jsonb; quote jsonb;
begin
  client := jsonb_build_object('id','synthetic-job-entry-client','name','Synthetic Job Entry Client','sites','[]'::jsonb,'contacts','[]'::jsonb);
  draft := jsonb_build_object('clientId',client->>'id','project','Synthetic Job Entry','projectManager','Synthetic PM','jobType','Contract','acceptedRevenue',1250,'hasQuotedValue',true,'originalCostBudget',1000,'costs','[]'::jsonb,'clientReference','PO-SYNTHETIC','subcontractors','Yes','documentLink','https://example.com/job-docs','portalSiteName','Synthetic site');
  select count(*) into before_count from public.jobs;
  select revision into rev from public.estimator_workspaces where id='main';
  begin
    perform public.create_portal_job(req,rev,draft || '{"project":""}',client);
    raise exception 'Missing job name accepted';
  exception when invalid_parameter_value then null; end;
  if (select count(*) from public.jobs) <> before_count then raise exception 'Invalid draft created a job'; end if;
  a := public.create_portal_job(req,rev,draft,client);
  b := public.create_portal_job(req,rev,draft,client);
  if a->>'jobId' <> b->>'jobId' or (select count(*) from public.jobs) <> before_count+1 then raise exception 'Retry created a duplicate'; end if;
  select item into saved from public.estimator_workspaces w, lateral jsonb_array_elements(w.payload->'jobs') item where w.id='main' and item->>'id'=a->>'jobId';
  if saved->>'jobDate' <> ((clock_timestamp() at time zone 'America/Toronto')::date)::text then raise exception 'Wrong job date'; end if;
  if left(a->>'jobNumber',2) <> to_char(clock_timestamp() at time zone 'America/Toronto','YY') then raise exception 'Wrong job year'; end if;
  if (select customer from public.jobs where id=(a->>'jobId')::uuid) <> client->>'name' then raise exception 'Employee client missing'; end if;
  if saved->>'acceptedRevenue' <> '1250' then raise exception 'Selling price missing'; end if;
  if not exists(select 1 from jsonb_array_elements(private.job_accounting_source_snapshot()) item where item->>'jobNumber'=a->>'jobNumber' and item->>'price'='1250' and item->>'customerPo'='PO-SYNTHETIC' and item->>'subcontractors'='Yes') then raise exception 'Accounting did not receive portal job details'; end if;
  begin perform public.create_portal_job(gen_random_uuid(),rev,draft,client); raise exception 'Stale workspace accepted'; exception when serialization_failure then null; end;
  select revision into rev from public.estimator_workspaces where id='main';
  b := public.create_portal_job(gen_random_uuid(),rev,draft || '{"jobType":"T&M","hasQuotedValue":false,"acceptedRevenue":0}',client);
  if (b->>'jobNumber')::integer <> (a->>'jobNumber')::integer+1 then raise exception 'Failed save consumed a number'; end if;
  quote := jsonb_build_object('id','synthetic-job-entry-quote','clientId',client->>'id','status','Finished','revision',0,'lines','[]'::jsonb,'revisions','[]'::jsonb);
  update public.estimator_workspaces set payload=jsonb_set(payload,'{quotes}',(payload->'quotes') || jsonb_build_array(quote)) where id='main';
  select revision into rev from public.estimator_workspaces where id='main';
  perform public.create_portal_job(gen_random_uuid(),rev,draft || jsonb_build_object('quoteId',quote->>'id'),client);
  select revision into rev from public.estimator_workspaces where id='main';
  begin perform public.create_portal_job(gen_random_uuid(),rev,draft || jsonb_build_object('quoteId',quote->>'id'),client); raise exception 'Quote converted twice'; exception when invalid_parameter_value then null; end;
  if not exists(select 1 from public.estimator_workspaces w, lateral jsonb_array_elements(w.payload->'quotes') item where item->>'id'=quote->>'id' and item->>'status'='Won') then raise exception 'Converted quote not marked Won'; end if;
end;
$$;
reset role;
select set_config('request.jwt.claim.sub',(select id::text from public.profiles where role<>'admin' and account_status='approved' order by id limit 1),true);
set local role authenticated;
do $$ begin
  if not exists(select 1 from public.jobs where customer='Synthetic Job Entry Client' and active) then raise exception 'Employee cannot read new active jobs'; end if;
  if exists(select 1 from public.estimator_workspaces) then raise exception 'Employee can read estimates'; end if;
  if exists(select 1 from public.portal_job_creation_receipts) then raise exception 'Employee can read job creation receipts'; end if;
  begin perform public.create_portal_job(gen_random_uuid(),1,'{}','{}'); raise exception 'Employee created job'; exception when insufficient_privilege then null; end;
end; $$;
reset role;
set local role anon;
do $$ begin
  begin perform public.create_portal_job(gen_random_uuid(),1,'{}','{}'); raise exception 'Anonymous created job'; exception when insufficient_privilege then null; end;
end; $$;
reset role;
rollback;
select 'PASS: validation, retry, gap-free numbering, Toronto date, quote once, accounting, employee read, financial privacy and anonymous denial; all test records rolled back' as result;
