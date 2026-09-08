-- Run inside a transaction and ROLLBACK. No test versions or jobs are retained.
select set_config('request.jwt.claim.sub', (select id::text from public.profiles where role = 'admin' and account_status = 'approved' order by id limit 1), true);
set local role authenticated;
insert into public.job_accounting_export_setup(id,source_name,source_sha256,master_rows)
values ('main','Synthetic security test.xlsx',repeat('a',64),'[]');
do $$
declare p jsonb; export_id uuid := gen_random_uuid(); request_id uuid := gen_random_uuid(); bytes bytea := decode('504b0304746573742d786c73782d66696c65','hex'); r public.job_accounting_exports;
begin
  p := public.get_job_accounting_export_preview();
  insert into public.job_accounting_exports(id,version,previous_export_id,file_name,file_sha256,file_base64,source_snapshot,rows,summary,exported_by,exported_by_name)
  values (export_id,1,null,'untrusted name.xlsx',encode(extensions.digest(bytes,'sha256'),'hex'),encode(bytes,'base64'),p->'sourceSnapshot','[{"jobNumber":"26999","color":"green","cells":["Synthetic",null,null,null,null,"26999",null,null,null,null,null,null,null,null,null,null]}]','{"total":1}',auth.uid(),'Untrusted name');
  select * into r from public.job_accounting_exports where id = export_id;
  if r.file_name <> 'JGC Accounting Job List - v0001.xlsx' or r.exported_by_name = 'Untrusted name' or r.exported_by <> auth.uid() then raise exception 'Server author/filename stamping failed'; end if;
  begin
    insert into public.job_accounting_exports(id,version,previous_export_id,file_name,file_sha256,file_base64,source_snapshot,rows,summary,exported_by,exported_by_name)
    values (gen_random_uuid(),1,null,'stale.xlsx',r.file_sha256,r.file_base64,p->'sourceSnapshot',r.rows,r.summary,auth.uid(),'x');
    raise exception 'Stale preview was incorrectly accepted';
  exception when serialization_failure then null; end;
  p := public.get_job_accounting_export_preview();
  begin
    insert into public.job_accounting_exports(id,version,previous_export_id,file_name,file_sha256,file_base64,source_snapshot,rows,summary,exported_by,exported_by_name)
    values (gen_random_uuid(),2,export_id,'bad.xlsx',repeat('b',64),r.file_base64,p->'sourceSnapshot',r.rows,r.summary,auth.uid(),'x');
    raise exception 'Corrupt file was incorrectly accepted';
  exception when invalid_parameter_value then null; end;
  begin update public.job_accounting_exports set file_name = 'changed.xlsx' where id = export_id; raise exception 'History was editable'; exception when insufficient_privilege then null; end;
  begin delete from public.job_accounting_exports where id = export_id; raise exception 'History was deletable'; exception when insufficient_privilege then null; end;
  insert into public.job_accounting_export_downloads(id,export_id,downloaded_by,downloaded_by_name) values(request_id,export_id,auth.uid(),'Untrusted name');
  if (select downloaded_by_name from public.job_accounting_export_downloads where id = request_id) = 'Untrusted name' then raise exception 'Download author was not stamped'; end if;
  begin update public.job_accounting_export_downloads set downloaded_by_name = 'changed'; raise exception 'Download log was editable'; exception when insufficient_privilege then null; end;
end;
$$;
reset role;
select set_config('request.jwt.claim.sub', (select id::text from public.profiles where role <> 'admin' and account_status = 'approved' order by id limit 1), true);
set local role authenticated;
do $$
begin
  if (select count(*) from public.job_accounting_exports) <> 0 then raise exception 'Employee read accounting versions'; end if;
  if (select count(*) from public.job_accounting_export_setup) <> 0 then raise exception 'Employee read source reference'; end if;
  if (select count(*) from public.job_accounting_export_downloads) <> 0 then raise exception 'Employee read download log'; end if;
  begin perform public.get_job_accounting_export_preview(); raise exception 'Employee accessed accounting preview'; exception when insufficient_privilege then null; end;
end;
$$;
reset role;
set local role anon;
do $$
begin
  begin perform public.get_job_accounting_export_preview(); raise exception 'Anonymous preview access'; exception when insufficient_privilege then null; end;
  begin perform count(*) from public.job_accounting_exports; raise exception 'Anonymous accounting read'; exception when insufficient_privilege then null; end;
end;
$$;
reset role;
select 'PASS: admin generation, stale rejection, checksum, immutable versions/log, employee and anonymous denial' as accounting_security_result;
