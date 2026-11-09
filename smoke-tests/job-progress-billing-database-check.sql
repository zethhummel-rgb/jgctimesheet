
-- Rollback-only verification against the existing export path.
begin;
set local statement_timeout = '25s';
set local lock_timeout = '3s';
select set_config('request.jwt.claim.sub',(select id::text from public.profiles where role='admin' and account_status='approved' order by id limit 1),true);
create function pg_temp.save_billing_test_export(p jsonb, forced_color text default null)
returns uuid language plpgsql security invoker set search_path='' as $$
declare rid uuid := gen_random_uuid(); bytes bytea := decode('504b0304746573742d786c73782d66696c65','hex'); rows jsonb;
begin
 select jsonb_agg(jsonb_build_object('jobNumber',j->>'jobNumber','color',
   case when nullif(j->>'progressBillingRequestId','') is not null and (j->>'active')::boolean then coalesce(forced_color,'orange')
     when (j->>'active')::boolean then 'white'
     when nullif(j->>'cancelledAt','') is not null then 'red'
     when nullif(j->>'invoiceReviewAt','') is not null then
       case when p->>'previousExportId' is not null
         and exists(select 1 from jsonb_array_elements(p->'previousRows') r where lower(btrim(r->>'jobNumber'))=lower(btrim(j->>'jobNumber')) and r->>'color' in ('blue','yellow'))
         and not exists(select 1 from jsonb_array_elements(p->'previousSnapshot') b where lower(btrim(b->>'jobNumber'))=lower(btrim(j->>'jobNumber'))
           and (b->>'statusChangedAt' is distinct from j->>'statusChangedAt' or b->>'active' is distinct from j->>'active'
             or b->>'cancelledAt' is distinct from j->>'cancelledAt' or b->>'invoiceReviewAt' is distinct from j->>'invoiceReviewAt'))
         then 'yellow' else 'blue' end else 'green' end,
   'cells',jsonb_build_array('Synthetic billing test',null,null,null,null,j->>'jobNumber',null,null,null,null,null,null,null,null,null,null)))
 into rows from jsonb_array_elements(p->'sourceSnapshot') j;
 insert into public.job_accounting_exports(id,cycle,version,previous_export_id,file_name,file_sha256,file_base64,source_snapshot,rows,summary,exported_by,exported_by_name)
 values(rid,(p->>'cycle')::int,(p->>'version')::int,(p->>'previousExportId')::uuid,'test.xlsx',encode(extensions.digest(bytes,'sha256'),'hex'),
 encode(bytes,'base64'),p->'sourceSnapshot',rows,'{}',auth.uid(),'fake actor');
 return rid;
end;
$$;
set local role authenticated;
do $$
declare job uuid; first_id uuid:=gen_random_uuid(); second_id uuid:=gen_random_uuid(); response jsonb; p jsonb; old_p jsonb; export uuid;
  original jsonb; refreshed jsonb; row public.job_progress_billing_requests;
begin
 select id,to_jsonb(j) into job,original from public.jobs j where active and cancelled_at is null
   and not exists(select 1 from public.job_progress_billing_requests r where r.job_id=j.id and r.exported_at is null and r.cancelled_at is null) order by id limit 1;
 if job is null then raise exception 'No eligible active job for rollback-only test'; end if;
 old_p := public.get_job_accounting_export_preview();
 response:=public.change_job_progress_billing(job,first_id,'request');
 if response->>'requested_by_name' is null or (response->>'requested_by')::uuid <> auth.uid() then raise exception 'Actor stamping failed'; end if;
 if (public.change_job_progress_billing(job,first_id,'request')->>'id')::uuid <> first_id then raise exception 'Retry not idempotent'; end if;
 if (public.change_job_progress_billing(job,gen_random_uuid(),'request')->>'id')::uuid <> first_id then raise exception 'Duplicate pending request'; end if;
 begin perform pg_temp.save_billing_test_export(old_p); raise exception 'Stale preview accepted'; exception when serialization_failure then null; end;
 p := public.get_job_accounting_export_preview();
 if not exists(select 1 from jsonb_array_elements(p->'sourceSnapshot') j where j->>'progressBillingRequestId'=first_id::text) then raise exception 'Pending request absent from preview'; end if;
 begin perform pg_temp.save_billing_test_export(p,'white'); raise exception 'Missing orange accepted'; exception when serialization_failure then null; end;
 if (select exported_at from public.job_progress_billing_requests where id=first_id) is not null then raise exception 'Failed export consumed request'; end if;
 export:=pg_temp.save_billing_test_export(p);
 select * into row from public.job_progress_billing_requests where id=first_id;
 if row.export_id is distinct from export or row.export_color is distinct from 'orange' or row.exported_at is null then raise exception 'Export receipt missing'; end if;
 refreshed:=public.get_job_accounting_export_preview();
 if exists(select 1 from jsonb_array_elements(refreshed->'sourceSnapshot') j where j->>'progressBillingRequestId'=first_id::text) then raise exception 'Request repeated in next export'; end if;
 if not exists(select 1 from jsonb_array_elements(refreshed->'previousRows') r where r->>'jobNumber'=original->>'job_number' and r->>'color'='orange') then raise exception 'Saved orange history missing'; end if;
 perform pg_temp.save_billing_test_export(refreshed);
 if (select count(*) from public.job_progress_billing_requests where id=first_id and export_id=export)<>1 then raise exception 'Second export changed receipt'; end if;
 begin perform public.change_job_progress_billing(job,first_id,'cancel'); raise exception 'Exported request cancelled'; exception when serialization_failure then null; end;
 response:=public.change_job_progress_billing(job,second_id,'request');
 if response->>'id'<>second_id::text then raise exception 'Cannot request next billing cycle'; end if;
 perform public.change_job_progress_billing(job,second_id,'cancel');
 if (select cancelled_at from public.job_progress_billing_requests where id=second_id) is null then raise exception 'Cancellation not recorded'; end if;
 -- A download-history reset cannot erase or replay the per-job billing receipt.
 refreshed:=public.get_job_accounting_export_state();
 perform public.clear_job_accounting_download_history(gen_random_uuid(),(refreshed->>'cycle')::integer,(refreshed->>'latestExportId')::uuid,'DELETE HISTORY');
 if (select exported_at from public.job_progress_billing_requests where id=first_id) is null then raise exception 'Reset erased billing receipt'; end if;
 refreshed:=public.get_job_accounting_export_preview();
 if exists(select 1 from jsonb_array_elements(refreshed->'sourceSnapshot') j where j->>'progressBillingRequestId'=first_id::text) then raise exception 'Reset replayed progress billing'; end if;
 if original is distinct from (select to_jsonb(j) from public.jobs j where id=job) then raise exception 'Billing modified job state'; end if;
 begin update public.job_progress_billing_requests set requested_by_name='Forged'; raise exception 'Audit is editable'; exception when insufficient_privilege then null; end;
 begin delete from public.job_progress_billing_requests; raise exception 'Audit is deletable'; exception when insufficient_privilege then null; end;
end;
$$;
reset role;
select set_config('request.jwt.claim.sub',(select id::text from public.profiles where role<>'admin' and account_status='approved' order by id limit 1),true);
set local role authenticated;
do $$
begin
 if (select count(*) from public.job_progress_billing_requests)<>0 then raise exception 'Employee read billing history'; end if;
 begin perform public.change_job_progress_billing(gen_random_uuid(),gen_random_uuid(),'request'); raise exception 'Employee requested billing'; exception when insufficient_privilege then null; end;
end;
$$;
reset role;
set local role anon;
do $$
begin
 begin perform public.change_job_progress_billing(gen_random_uuid(),gen_random_uuid(),'request'); raise exception 'Anonymous request accepted'; exception when insufficient_privilege then null; end;
 begin perform count(*) from public.job_progress_billing_requests; raise exception 'Anonymous read accepted'; exception when insufficient_privilege then null; end;
end;
$$;
reset role;
select 'PASS - audit stamping, retry, pending dedupe, stale rejection, required orange, failed save retention, atomic receipt, next export clearing, immutable history, repeat billing, cancellation, unchanged job, employee and anonymous denial. All writes rolled back.' as result;
rollback;
