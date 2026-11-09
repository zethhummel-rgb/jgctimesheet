begin;
set local statement_timeout='30s';
do $test$
declare
 test_id uuid; imported_id uuid; closed_first timestamptz; closed_again timestamptz;
 admin_id uuid; worker_id uuid; n integer; snapshot jsonb;
begin
 select id into admin_id from public.profiles where role='admin' and account_status='approved' limit 1;
 select id into worker_id from public.profiles where role='worker' and account_status='approved' limit 1;
 if admin_id is null or worker_id is null then raise exception 'Missing test roles'; end if;
 insert into public.jobs(job_number,job_name,active,closed_at)
 values ('QA-CLOSED-'||gen_random_uuid(), 'Rollback-only closure test',true,'2000-01-01') returning id into test_id;
 assert (select closed_at is null from public.jobs where id=test_id), 'active insert must not accept closure';
 insert into public.jobs(job_number,job_name,active,closed_at)
 values ('QA-CLOSED-'||gen_random_uuid(), 'Rollback-only old import test',false,'2000-01-01') returning id into imported_id;
 assert (select closed_at is null from public.jobs where id=imported_id), 'old inactive import unknown';
 perform set_config('request.jwt.claim.sub',admin_id::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true);
 execute 'set local role authenticated';
 update public.jobs set active=false where id=test_id returning closed_at into closed_first;
 assert closed_first between transaction_timestamp() and clock_timestamp(), 'admin close server date';
 update public.jobs set customer='Edited customer',closed_at='2000-01-01' where id=test_id;
 assert (select closed_at=closed_first from public.jobs where id=test_id), 'detail edit and spoof must preserve';
 update public.jobs set active=false,invoice_review_at=clock_timestamp() where id=test_id;
 assert (select closed_at=closed_first from public.jobs where id=test_id), 'discussion preserve';
 update public.jobs set active=false,invoice_review_at=null where id=test_id;
 assert (select closed_at=closed_first from public.jobs where id=test_id), 'repeat close preserve';
 update public.jobs set active=true where id=test_id;
 assert (select closed_at is null from public.jobs where id=test_id), 'reopen clears';
 update public.jobs set active=false,invoice_review_at=clock_timestamp() where id=test_id returning closed_at into closed_again;
 assert closed_again>closed_first, 'reclose new date';
 execute 'reset role';
 select item into snapshot from jsonb_array_elements(private.job_accounting_source_snapshot()) item where item->>'jobNumber'=(select job_number from public.jobs where id=test_id);
 assert (snapshot->>'closedAt')::timestamptz=closed_again, 'export snapshot uses canonical closure';
 execute 'set local role authenticated';
 update public.jobs set active=false,cancelled_at=clock_timestamp() where id=test_id;
 assert (select closed_at is null from public.jobs where id=test_id), 'cancellation clears';
 update public.jobs set active=true where id=test_id;
 execute 'reset role';
 perform set_config('request.jwt.claim.sub',worker_id::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',worker_id,'role','authenticated')::text,true);
 execute 'set local role authenticated';
 begin
  update public.jobs set active=false,closed_at='2000-01-01' where id=test_id;
  get diagnostics n=row_count;
  assert n=0, 'worker cannot close';
 exception when insufficient_privilege then null;
 end;
 execute 'reset role';
 assert (select active and closed_at is null from public.jobs where id=test_id), 'worker did not change job';
end;
$test$;
rollback;
select 'PASS: server dates; both close options; edits/repeated closes preserve; reopen/reclose; cancellation; inactive imports; export snapshot; employee denied; all synthetic writes rolled back' as result;