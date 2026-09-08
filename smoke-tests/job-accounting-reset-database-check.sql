-- Run as a database administrator. The entire destructive-reset exercise is
-- transactional and ALWAYS rolled back; no real download history is removed.
begin;
select set_config('request.jwt.claims',jsonb_build_object('sub',id,'role','authenticated')::text,true)
from public.profiles where role='admin' and account_status='approved' limit 1;
set local role authenticated;
do $$
declare
  p jsonb; original_preview jsonb; fresh jsonb; result jsonb; retry jsonb;
  reset_id uuid := gen_random_uuid(); export_id uuid := gen_random_uuid(); after_id uuid := gen_random_uuid();
  original_count bigint; log_count bigint; jobs_before text; workspace_before text; setup_before text;
  bytes bytea := decode('504b030453796e7468657469632074657374206f6e6c79','hex');
  sample_rows jsonb := '[{"jobNumber":"29999","color":"green","cells":["Synthetic rollback check",null,null,null,null,"29999",null,null,null,null,null,null,null,null,null,null]}]';
begin
  original_preview := public.get_job_accounting_export_preview();
  select count(*) into original_count from public.job_accounting_exports;
  select count(*) into log_count from public.job_accounting_export_downloads;
  select md5(jsonb_agg(to_jsonb(j) order by id)::text) into jobs_before from public.jobs j;
  select md5(jsonb_agg(to_jsonb(w) order by id)::text) into workspace_before from public.estimator_workspaces w;
  select md5(master_rows::text||baseline_snapshot::text) into setup_before from public.job_accounting_export_setup where id='main';
  p := original_preview;
  insert into public.job_accounting_exports(id,cycle,version,previous_export_id,file_name,file_sha256,file_base64,source_snapshot,rows,summary,exported_by,exported_by_name)
    values(export_id,(p->>'cycle')::integer,(p->>'version')::integer,(p->>'previousExportId')::uuid,'synthetic.xlsx',encode(extensions.digest(bytes,'sha256'),'hex'),encode(bytes,'base64'),p->'sourceSnapshot',sample_rows,'{}',auth.uid(),'forged');
  insert into public.job_accounting_export_downloads(id,export_id,downloaded_by,downloaded_by_name)
    values(gen_random_uuid(),export_id,auth.uid(),'forged');
  begin
    perform public.clear_job_accounting_download_history(reset_id,(p->>'cycle')::integer,export_id,'RESET TO V0');
    raise exception 'Old confirmation was accepted for permanent deletion';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.reset_job_accounting_exports(reset_id,(p->>'cycle')::integer,export_id,'RESET TO V0');
    raise exception 'Older client can still reset';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.clear_job_accounting_download_history(reset_id,(p->>'cycle')::integer+1,export_id,'DELETE HISTORY');
    raise exception 'Stale reset was accepted';
  exception when serialization_failure then null; end;
  if (select count(*) from public.job_accounting_exports) <> original_count+1
    or (select count(*) from public.job_accounting_export_downloads) <> log_count+1 then raise exception 'Rejected reset changed history'; end if;
  result := public.clear_job_accounting_download_history(reset_id,(p->>'cycle')::integer,export_id,'DELETE HISTORY');
  if (result->>'deletedFiles')::bigint <> original_count+1 or (result->>'deletedLogs')::bigint <> log_count+1 then raise exception 'Deletion receipt counts incorrect'; end if;
  if exists(select 1 from public.job_accounting_exports) or exists(select 1 from public.job_accounting_export_downloads)
    or exists(select 1 from public.job_accounting_export_resets) then raise exception 'Old files or logs survived reset'; end if;
  fresh := public.get_job_accounting_export_preview();
  if (fresh->>'version')::integer <> 0 or fresh->>'previousExportId' is not null
    or fresh->'previousRows' <> '[]'::jsonb or fresh->'previousSnapshot' <> original_preview->'baselineSnapshot'
    or (fresh->>'cycle')::integer <> (p->>'cycle')::integer+1 then raise exception 'Reset did not restore starting hand-off state'; end if;
  if fresh->'masterRows' <> original_preview->'masterRows' then raise exception 'Original master colours changed'; end if;
  begin
    perform public.clear_job_accounting_download_history(gen_random_uuid(),(fresh->>'cycle')::integer,export_id,'DELETE HISTORY');
    raise exception 'Empty history was reset again';
  exception when serialization_failure then null; end;
  begin
    insert into public.job_accounting_exports(id,cycle,version,previous_export_id,file_name,file_sha256,file_base64,source_snapshot,rows,summary,exported_by,exported_by_name)
      values(gen_random_uuid(),(p->>'cycle')::integer,0,null,'stale.xlsx',encode(extensions.digest(bytes,'sha256'),'hex'),encode(bytes,'base64'),fresh->'sourceSnapshot',sample_rows,'{}',auth.uid(),'forged');
    raise exception 'Old generation accepted a stale save';
  exception when serialization_failure then null; end;
  insert into public.job_accounting_exports(id,cycle,version,previous_export_id,file_name,file_sha256,file_base64,source_snapshot,rows,summary,exported_by,exported_by_name)
    values(after_id,(fresh->>'cycle')::integer,0,null,'synthetic.xlsx',encode(extensions.digest(bytes,'sha256'),'hex'),encode(bytes,'base64'),fresh->'sourceSnapshot',sample_rows,'{}',auth.uid(),'forged');
  insert into public.job_accounting_export_downloads(id,export_id,downloaded_by,downloaded_by_name)
    values(gen_random_uuid(),after_id,auth.uid(),'forged');
  if (select file_name from public.job_accounting_exports where id=after_id) <> 'JGC Accounting Job List - v0000.xlsx' then raise exception 'New V0 filename incorrect'; end if;
  if (public.get_job_accounting_export_state()->>'nextVersion')::integer <> 1
    or (public.get_job_accounting_export_preview()->>'previousExportId')::uuid <> after_id then raise exception 'V0 did not advance to V1'; end if;
  retry := public.clear_job_accounting_download_history(reset_id,(p->>'cycle')::integer,export_id,'DELETE HISTORY');
  if retry->>'reused' <> 'true' or result->>'id' <> retry->>'id'
    or (select count(*) from public.job_accounting_exports) <> 1
    or (select count(*) from public.job_accounting_export_downloads) <> 1 then raise exception 'Late retry removed the new version or log'; end if;
  begin update private.job_accounting_reset_control set cycle=1 where id='main'; raise exception 'Reset control mutable by browser'; exception when insufficient_privilege then null; end;
  begin insert into public.job_accounting_export_resets(id,cycle,previous_export_id,reset_by,reset_by_name) values(gen_random_uuid(),999,after_id,auth.uid(),'forged'); raise exception 'Legacy reset insert allowed'; exception when insufficient_privilege then null; end;
  begin update public.job_accounting_exports set file_name='changed' where id=after_id; raise exception 'Saved file editable'; exception when insufficient_privilege then null; end;
  begin delete from public.job_accounting_exports where id=after_id; raise exception 'Direct delete allowed'; exception when insufficient_privilege then null; end;
  begin truncate public.job_accounting_export_downloads,public.job_accounting_export_resets,public.job_accounting_exports; raise exception 'Direct truncate allowed'; exception when insufficient_privilege then null; end;
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
  if private.jgc_has_accounting_access() then raise exception 'Worker fixture still has admin access'; end if;
  if exists(select 1 from private.job_accounting_reset_control) then raise exception 'Employee can read reset control'; end if;
  begin perform public.get_job_accounting_export_state(); raise exception 'Employee can read admin state'; exception when insufficient_privilege then null; end;
  begin perform public.clear_job_accounting_download_history(gen_random_uuid(),1,gen_random_uuid(),'DELETE HISTORY'); raise exception 'Employee can reset'; exception when insufficient_privilege then null; end;
  begin perform private.clear_job_accounting_download_history(gen_random_uuid(),1,gen_random_uuid(),'DELETE HISTORY'); raise exception 'Employee can bypass wrapper'; exception when insufficient_privilege then null; end;
end;
$$;
reset role;
set local role anon;
do $$
begin
  begin perform public.get_job_accounting_export_state(); raise exception 'Anonymous state access'; exception when insufficient_privilege then null; end;
  begin perform public.clear_job_accounting_download_history(gen_random_uuid(),1,gen_random_uuid(),'DELETE HISTORY'); raise exception 'Anonymous reset access'; exception when insufficient_privilege then null; end;
  begin perform private.clear_job_accounting_download_history(gen_random_uuid(),1,gen_random_uuid(),'DELETE HISTORY'); raise exception 'Anonymous private reset access'; exception when insufficient_privilege then null; end;
end;
$$;
reset role;
rollback;
select 'PASS: permanent history deletion, V0 restart, safe late retry, stale-client rejection, unchanged jobs/master, admin-only access; all test changes rolled back' as result;
