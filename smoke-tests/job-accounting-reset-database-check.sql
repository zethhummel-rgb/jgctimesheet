-- Run as a database administrator. Every synthetic version/reset is rolled back.
begin;
select set_config('request.jwt.claims',jsonb_build_object('sub',id,'role','authenticated')::text,true)
from public.profiles where role='admin' and account_status='approved' limit 1;
set local role authenticated;
do $$
declare
  p jsonb; original_preview jsonb; fresh jsonb; result jsonb; retry jsonb;
  reset_id uuid := gen_random_uuid(); export_id uuid := gen_random_uuid(); after_id uuid := gen_random_uuid();
  original_count bigint; reset_count bigint; jobs_before text; workspace_before text; setup_before text; files_before text;
  bytes bytea := decode('504b030453796e7468657469632074657374206f6e6c79','hex');
  sample_rows jsonb := '[{"jobNumber":"29999","color":"green","cells":["Synthetic rollback check",null,null,null,null,"29999",null,null,null,null,null,null,null,null,null,null]}]';
begin
  original_preview := public.get_job_accounting_export_preview();
  select count(*) into original_count from public.job_accounting_exports;
  select count(*) into reset_count from public.job_accounting_export_resets;
  select md5(jsonb_agg(to_jsonb(j) order by id)::text) into jobs_before from public.jobs j;
  select md5(jsonb_agg(to_jsonb(w) order by id)::text) into workspace_before from public.estimator_workspaces w;
  select md5(master_rows::text||baseline_snapshot::text) into setup_before from public.job_accounting_export_setup where id='main';
  select md5(string_agg(id::text||file_sha256||file_base64,',' order by id)) into files_before from public.job_accounting_exports;
  p := original_preview;
  insert into public.job_accounting_exports(id,cycle,version,previous_export_id,file_name,file_sha256,file_base64,source_snapshot,rows,summary,exported_by,exported_by_name)
    values(export_id,(p->>'cycle')::integer,(p->>'version')::integer,(p->>'previousExportId')::uuid,'synthetic.xlsx',encode(extensions.digest(bytes,'sha256'),'hex'),encode(bytes,'base64'),p->'sourceSnapshot',sample_rows,'{}',auth.uid(),'forged name');
  begin
    perform public.reset_job_accounting_exports(reset_id,(p->>'cycle')::integer,export_id,'wrong');
    raise exception 'Unconfirmed reset was accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.reset_job_accounting_exports(reset_id,(p->>'cycle')::integer+1,export_id,'RESET TO V1');
    raise exception 'Stale reset was accepted';
  exception when serialization_failure then null; end;
  result := public.reset_job_accounting_exports(reset_id,(p->>'cycle')::integer,export_id,'RESET TO V1');
  retry := public.reset_job_accounting_exports(reset_id,(p->>'cycle')::integer,export_id,'RESET TO V1');
  if retry->>'reused' <> 'true' or result->>'id' <> retry->>'id' then raise exception 'Reset retry was not idempotent'; end if;
  if (select count(*) from public.job_accounting_export_resets) <> reset_count+1 then raise exception 'Duplicate reset created'; end if;
  fresh := public.get_job_accounting_export_preview();
  if (fresh->>'version')::integer <> 1 or fresh->>'previousExportId' is not null
    or fresh->'previousRows' <> '[]'::jsonb or fresh->'previousSnapshot' <> original_preview->'baselineSnapshot'
    or (fresh->>'cycle')::integer <> (p->>'cycle')::integer+1 then raise exception 'Reset did not restore the starting hand-off state'; end if;
  if fresh->'masterRows' <> original_preview->'masterRows' then raise exception 'Original master colours changed'; end if;
  begin
    perform public.reset_job_accounting_exports(gen_random_uuid(),(fresh->>'cycle')::integer,export_id,'RESET TO V1');
    raise exception 'Empty run was reset again';
  exception when serialization_failure then null; end;
  begin
    insert into public.job_accounting_exports(id,cycle,version,previous_export_id,file_name,file_sha256,file_base64,source_snapshot,rows,summary,exported_by,exported_by_name)
      values(gen_random_uuid(),(p->>'cycle')::integer,1,null,'stale.xlsx',encode(extensions.digest(bytes,'sha256'),'hex'),encode(bytes,'base64'),fresh->'sourceSnapshot',sample_rows,'{}',auth.uid(),'forged');
    raise exception 'Old run accepted a stale save';
  exception when serialization_failure then null; end;
  insert into public.job_accounting_exports(id,cycle,version,previous_export_id,file_name,file_sha256,file_base64,source_snapshot,rows,summary,exported_by,exported_by_name)
    values(after_id,(fresh->>'cycle')::integer,1,null,'synthetic.xlsx',encode(extensions.digest(bytes,'sha256'),'hex'),encode(bytes,'base64'),fresh->'sourceSnapshot',sample_rows,'{}',auth.uid(),'forged');
  if (select file_name from public.job_accounting_exports where id=after_id) <> 'JGC Accounting Job List - v0001 - run'||(fresh->>'cycle')||'.xlsx' then raise exception 'Reset filename was ambiguous'; end if;
  retry := public.reset_job_accounting_exports(reset_id,(p->>'cycle')::integer,export_id,'RESET TO V1');
  if (select count(*) from public.job_accounting_export_resets) <> reset_count+1 then raise exception 'Late retry reset a newer run'; end if;
  begin update public.job_accounting_export_resets set reset_by_name='changed' where id=reset_id; raise exception 'Reset audit was mutable'; exception when insufficient_privilege then null; end;
  begin delete from public.job_accounting_exports where id=export_id; raise exception 'History was deletable'; exception when insufficient_privilege then null; end;
  if (select count(*) from public.job_accounting_exports) <> original_count+2 then raise exception 'History count changed unexpectedly'; end if;
  if files_before is distinct from (select md5(string_agg(id::text||file_sha256||file_base64,',' order by id)) from public.job_accounting_exports where id not in(export_id,after_id)) then raise exception 'Original file bytes changed'; end if;
  if jobs_before is distinct from (select md5(jsonb_agg(to_jsonb(j) order by id)::text) from public.jobs j)
    or workspace_before is distinct from (select md5(jsonb_agg(to_jsonb(w) order by id)::text) from public.estimator_workspaces w)
    or setup_before is distinct from (select md5(master_rows::text||baseline_snapshot::text) from public.job_accounting_export_setup where id='main') then raise exception 'Operational data or master reference changed'; end if;
end;
$$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',id,'role','authenticated')::text,true)
from public.profiles where role='worker' and account_status='approved' limit 1;
set local role authenticated;
do $$
begin
  if private.jgc_has_accounting_access() then raise exception 'The worker fixture still has admin access'; end if;
  if exists(select 1 from public.job_accounting_export_resets) then raise exception 'Employee can read reset audit'; end if;
  begin perform public.get_job_accounting_export_state(); raise exception 'Employee can read admin state'; exception when insufficient_privilege then null; end;
  begin perform public.reset_job_accounting_exports(gen_random_uuid(),1,gen_random_uuid(),'RESET TO V1'); raise exception 'Employee can reset'; exception when insufficient_privilege then null; end;
end;
$$;
reset role;
set local role anon;
do $$
begin
  begin perform public.get_job_accounting_export_state(); raise exception 'Anonymous state access'; exception when insufficient_privilege then null; end;
  begin perform public.reset_job_accounting_exports(gen_random_uuid(),1,gen_random_uuid(),'RESET TO V1'); raise exception 'Anonymous reset access'; exception when insufficient_privilege then null; end;
end;
$$;
reset role;
rollback;
select 'PASS: confirmed/idempotent/stale-safe reset, immutable files, unchanged jobs/reference, admin-only access; all test changes rolled back' as result;
