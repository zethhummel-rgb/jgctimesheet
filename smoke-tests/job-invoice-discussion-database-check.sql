-- Synthetic, rollback-only check: no actual project or saved history is changed.
begin;
set local statement_timeout = '30s';
select set_config('request.jwt.claim.sub', (select id::text from public.profiles where role = 'admin' and account_status = 'approved' order by id limit 1), true);
set local role authenticated;
do $$
declare
  job_id uuid := gen_random_uuid(); number text := 'invoice-review-qa-' || job_id::text;
  marker timestamptz; row_data public.jobs; p jsonb; x uuid := gen_random_uuid();
  blue_rows jsonb; bytes bytea := decode('504b0304746573742d786c73782d66696c65','hex'); stored public.job_accounting_exports;
begin
  insert into public.jobs(id, job_number, job_name, active, invoice_review_at, document_link)
    values(job_id, number, 'Synthetic rollback invoice discussion', false, clock_timestamp(), 'https://example.com/drawings');
  select * into row_data from public.jobs where id=job_id;
  marker := row_data.invoice_review_at;
  if marker is null or row_data.accounting_status_changed_at is null or row_data.cancelled_at is not null then raise exception 'Discussion status missing'; end if;
  update public.jobs set job_name='Updated synthetic name', active=false where id=job_id;
  if (select invoice_review_at from public.jobs where id=job_id) is distinct from marker then raise exception 'Inactive import/details cleared discussion'; end if;
  p := public.get_job_accounting_export_preview();
  if not exists (select 1 from jsonb_array_elements(p->'sourceSnapshot') j where j->>'jobNumber'=number and nullif(j->>'invoiceReviewAt','') is not null) then raise exception 'Snapshot omitted discussion'; end if;
  -- Include all current discussion jobs so concurrent legitimate blue flags
  -- do not make this synthetic check fail or alter existing jobs.
  select jsonb_agg(jsonb_build_object('jobNumber',j->>'jobNumber','color','blue',
    'cells',jsonb_build_array('Synthetic test',null,null,null,null,j->>'jobNumber',null,null,null,null,null,null,null,null,null,null)))
    into blue_rows from jsonb_array_elements(p->'sourceSnapshot') j where nullif(j->>'invoiceReviewAt','') is not null;
  begin
    insert into public.job_accounting_exports(id,cycle,version,previous_export_id,file_name,file_sha256,file_base64,source_snapshot,rows,summary,exported_by,exported_by_name)
      values(x,(p->>'cycle')::int,(p->>'version')::int,(p->>'previousExportId')::uuid,'test.xlsx',encode(extensions.digest(bytes,'sha256'),'hex'),encode(bytes,'base64'),p->'sourceSnapshot','[]','{"total":0}',auth.uid(),'test');
    raise exception 'Older client omitted blue job without rejection';
  exception when serialization_failure then null; end;
  insert into public.job_accounting_exports(id,cycle,version,previous_export_id,file_name,file_sha256,file_base64,source_snapshot,rows,summary,exported_by,exported_by_name)
    values(x,(p->>'cycle')::int,(p->>'version')::int,(p->>'previousExportId')::uuid,'test.xlsx',encode(extensions.digest(bytes,'sha256'),'hex'),encode(bytes,'base64'),p->'sourceSnapshot',blue_rows,jsonb_build_object('total',jsonb_array_length(blue_rows),'blue',jsonb_array_length(blue_rows)),auth.uid(),'test');
  select * into stored from public.job_accounting_exports where id=x;
  if stored.rows is distinct from blue_rows then raise exception 'Blue rows were not saved'; end if;
  begin update public.job_accounting_exports set summary='{}' where id=x; raise exception 'History editable'; exception when insufficient_privilege then null; end;
  update public.jobs set invoice_review_at=null where id=job_id;
  select * into row_data from public.jobs where id=job_id;
  if row_data.active or row_data.invoice_review_at is not null or row_data.accounting_status_changed_at <= marker then raise exception 'Resolution did not record fresh closed event'; end if;
  update public.jobs set invoice_review_at=clock_timestamp() where id=job_id;
  update public.jobs set active=true where id=job_id;
  select * into row_data from public.jobs where id=job_id;
  if row_data.invoice_review_at is not null or row_data.cancelled_at is not null or row_data.document_link <> 'https://example.com/drawings' then raise exception 'Legacy reactivation lost links or retained marker'; end if;
  update public.jobs set active=false, invoice_review_at=clock_timestamp() where id=job_id;
  update public.jobs set cancelled_at=clock_timestamp() where id=job_id;
  if (select invoice_review_at from public.jobs where id=job_id) is not null then raise exception 'Cancellation retained blue marker'; end if;
end;
$$;
reset role;
select set_config('request.jwt.claim.sub', (select id::text from public.profiles where role <> 'admin' and account_status = 'approved' order by id limit 1), true);
set local role authenticated;
do $$
begin
  begin
    insert into public.jobs(job_number,job_name,active,invoice_review_at) values('invoice-review-denied-qa','Denied',false,clock_timestamp());
    raise exception 'Employee status write was allowed';
  exception when insufficient_privilege then null; end;
  begin perform public.get_job_accounting_export_preview(); raise exception 'Employee read private accounting preview'; exception when insufficient_privilege then null; end;
end;
$$;
reset role;
rollback;
select 'PASS: discussion, import preservation, snapshot, legacy-client rejection, immutable blue exports, resolution, reactivation, cancellation and employee denial; rolled back' as result;
