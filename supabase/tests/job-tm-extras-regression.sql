-- T&M Extras regression checks. Run with a privileged database test connection.
-- Prerequisite: migration 20261105192414_jgc_job_tm_extras.sql is available in
-- this transaction or already installed. This script always rolls fixtures back.
-- Fixtures reuse approved account identities but only insert synthetic jobs,
-- WOs, entries and 2099 effective rates. It requires an existing payroll capture
-- and an approved worker linked through work_order_labour_workers.
-- No emails are sent. No existing row is altered.
BEGIN;

CREATE TEMP TABLE tm_extras_test_results (test text);
DO $test$
DECLARE
  admin_id uuid; worker_id uuid; other_worker uuid;
  job_a uuid; job_b uuid;
  job_number_a text := '__TM_EXTRAS_A_' || gen_random_uuid()::text;
  job_number_b text := '__TM_EXTRAS_B_' || gen_random_uuid()::text;
  request_id uuid := gen_random_uuid();
  first_extra uuid; second_extra uuid; other_extra uuid;
  draft_wo uuid; submitted_wo uuid; no_extra_wo uuid;
  result jsonb; report jsonb; old_label text;
BEGIN
  SELECT id INTO STRICT admin_id FROM public.profiles WHERE role='admin' AND account_status='approved' ORDER BY id LIMIT 1;
  SELECT id INTO STRICT worker_id FROM public.profiles WHERE role='worker' AND account_status='approved' ORDER BY id LIMIT 1;
  SELECT id INTO STRICT other_worker FROM public.profiles WHERE role='worker' AND account_status='approved' AND id<>worker_id ORDER BY id LIMIT 1;
  INSERT INTO public.jobs(job_number,job_name,job_type) VALUES(job_number_a,'Synthetic extras QA A','contract') RETURNING id INTO job_a;
  INSERT INTO public.jobs(job_number,job_name,job_type) VALUES(job_number_b,'Synthetic extras QA B','contract') RETURNING id INTO job_b;

  IF has_function_privilege('anon','public.list_job_tm_extras(text,uuid)','EXECUTE') OR
     has_table_privilege('authenticated','public.job_tm_extras','INSERT') OR
     has_table_privilege('authenticated','public.job_tm_extras','SELECT') THEN
    RAISE EXCEPTION 'Unexpected direct or anonymous privileges';
  END IF;
  INSERT INTO tm_extras_test_results VALUES('Anonymous RPC and direct client table access denied');
  PERFORM set_config('request.jwt.claim.sub',admin_id::text,true);
  SET LOCAL ROLE authenticated;
  result := public.save_job_tm_extra(job_number_a,'Chip up tiles',NULL,true,request_id);
  first_extra := (result->>'id')::uuid;
  IF result->>'code'<>'X1' THEN RAISE EXCEPTION 'First extra is not X1'; END IF;
  result := public.save_job_tm_extra(job_number_a,'Chip up tiles',NULL,true,request_id);
  IF (result->>'id')::uuid<>first_extra THEN RAISE EXCEPTION 'Retry created duplicate'; END IF;
  result := public.save_job_tm_extra(job_number_a,'Remove partitions');
  second_extra := (result->>'id')::uuid;
  IF result->>'code'<>'X2' THEN RAISE EXCEPTION 'Second extra is not X2'; END IF;
  result := public.save_job_tm_extra(job_number_b,'Other project work');
  other_extra := (result->>'id')::uuid;
  IF result->>'code'<>'X1' THEN RAISE EXCEPTION 'Other job numbering is not independent'; END IF;
  RESET ROLE;
  INSERT INTO tm_extras_test_results VALUES('Per-job X1/X2 numbering and idempotent create retry');

  PERFORM set_config('request.jwt.claim.sub',worker_id::text,true);
  SET LOCAL ROLE authenticated;
  IF jsonb_array_length(public.list_job_tm_extras(job_number_a))<>2 THEN RAISE EXCEPTION 'Worker cannot list extras'; END IF;
  BEGIN
    PERFORM public.save_job_tm_extra(job_number_a,'Unauthorized extra');
    RAISE EXCEPTION 'Worker created an extra';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.get_job_tm_extras(job_number_a);
    RAISE EXCEPTION 'Worker read administrative totals';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  INSERT INTO public.work_orders(wo_number,work_order_date,job_id,job_number,job_name,created_by,created_by_name,tm_extra_id,tm_extra_label)
    VALUES('WO-QA-'||gen_random_uuid(),current_date,job_a,job_number_a,'Synthetic A',worker_id,'Synthetic Worker',first_extra,'Forged label')
    RETURNING id,tm_extra_label INTO draft_wo,old_label;
  IF old_label<>'X1 â€” Chip up tiles' THEN RAISE EXCEPTION 'Label was not generated on server'; END IF;
  INSERT INTO public.work_order_labour(work_order_id,employee_name,worker_key,hours,complete)
    VALUES(draft_wo,'Synthetic timesheet worker','synthetic-worker',2,true),
          (draft_wo,'Synthetic manual worker','manual-synthetic',3,true);
  INSERT INTO public.work_orders(wo_number,work_order_date,job_id,job_number,job_name,created_by,created_by_name,tm_extra_id)
    VALUES('WO-QA-'||gen_random_uuid(),current_date,job_a,job_number_a,'Synthetic A',worker_id,'Synthetic Worker',first_extra)
    RETURNING id INTO submitted_wo;
  INSERT INTO public.work_order_labour(work_order_id,employee_name,hours,complete) VALUES(submitted_wo,'Synthetic submitted worker',4,true);
  UPDATE public.work_orders SET status='submitted',locked=true WHERE id=submitted_wo;
  INSERT INTO public.work_orders(wo_number,work_order_date,job_id,job_number,created_by)
    VALUES('WO-QA-'||gen_random_uuid(),current_date,job_a,job_number_a,worker_id) RETURNING id INTO no_extra_wo;
  INSERT INTO public.work_order_labour(work_order_id,employee_name,hours,complete) VALUES(no_extra_wo,'Synthetic base work',25,true);
  BEGIN
    UPDATE public.work_orders SET tm_extra_id=other_extra WHERE id=draft_wo;
    RAISE EXCEPTION 'Cross-job extra accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    UPDATE public.work_orders SET job_id=job_b,job_number=job_number_b WHERE id=draft_wo;
    RAISE EXCEPTION 'Job change retained an unrelated extra';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    UPDATE public.work_orders SET tm_extra_id=second_extra WHERE id=submitted_wo;
    RAISE EXCEPTION 'Submitted work order extra changed';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  PERFORM set_config('request.jwt.claim.sub',other_worker::text,true);
  BEGIN
    UPDATE public.work_orders SET tm_extra_id=second_extra WHERE id=draft_wo;
    RAISE EXCEPTION 'Other worker reassigned extra';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;
  INSERT INTO tm_extras_test_results VALUES('Worker choices, admin-only management/totals, cross-job and ownership checks, submitted WO protection');

  PERFORM set_config('request.jwt.claim.sub',admin_id::text,true);
  SET LOCAL ROLE authenticated;
  report := public.get_job_tm_extras(job_number_a);
  SELECT e INTO STRICT result FROM jsonb_array_elements(report->'extras') e WHERE (e->>'id')::uuid=first_extra;
  IF (result->>'hours')::numeric<>9 OR (result->>'submitted_hours')::numeric<>4 OR jsonb_array_length(result->'work_orders')<>2 THEN
    RAISE EXCEPTION 'Incorrect totals or base WO included: %',result;
  END IF;
  UPDATE public.work_order_labour SET hours=3.5 WHERE work_order_id=draft_wo AND worker_key='synthetic-worker';
  report := public.get_job_tm_extras(job_number_a);
  SELECT e INTO STRICT result FROM jsonb_array_elements(report->'extras') e WHERE (e->>'id')::uuid=first_extra;
  IF (result->>'hours')::numeric<>10.5 THEN RAISE EXCEPTION 'Updated labour not counted'; END IF;
  PERFORM public.save_job_tm_extra(job_number_a,'Renamed tile work',first_extra,false);
  IF jsonb_array_length(public.list_job_tm_extras(job_number_a))<>1 OR
     jsonb_array_length(public.list_job_tm_extras(job_number_a,first_extra))<>2 OR
     jsonb_array_length(public.list_job_tm_extras(job_number_a,other_extra))<>1 THEN
    RAISE EXCEPTION 'Closed/selected/cross-job option filtering failed';
  END IF;
  UPDATE public.work_orders SET tm_extra_id=first_extra,tm_extra_label='Forged renamed snapshot' WHERE id=draft_wo;
  IF (SELECT tm_extra_label FROM public.work_orders WHERE id=draft_wo)<>old_label THEN RAISE EXCEPTION 'Historic snapshot changed'; END IF;
  UPDATE public.work_orders SET notes='Synthetic refresh',tm_extra_id=first_extra,tm_extra_label='Forged submitted snapshot' WHERE id=submitted_wo;
  IF (SELECT tm_extra_label FROM public.work_orders WHERE id=submitted_wo)<>old_label THEN RAISE EXCEPTION 'Submitted snapshot changed'; END IF;
  BEGIN
    UPDATE public.work_orders SET tm_extra_id=first_extra WHERE id=no_extra_wo;
    RAISE EXCEPTION 'New closed-extra assignment accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  UPDATE public.work_orders SET tm_extra_id=second_extra WHERE id=draft_wo;
  report := public.get_job_tm_extras(job_number_a);
  SELECT e INTO STRICT result FROM jsonb_array_elements(report->'extras') e WHERE (e->>'id')::uuid=first_extra;
  IF (result->>'hours')::numeric<>4 OR (result->>'submitted_hours')::numeric<>4 THEN RAISE EXCEPTION 'Reassignment failed to move hours'; END IF;
  SELECT e INTO STRICT result FROM jsonb_array_elements(report->'extras') e WHERE (e->>'id')::uuid=second_extra;
  IF (result->>'hours')::numeric<>6.5 OR (result->>'submitted_hours')::numeric<>0 THEN RAISE EXCEPTION 'Reassigned hours missing'; END IF;
  UPDATE public.work_orders SET tm_extra_id=NULL WHERE id=draft_wo;
  IF (SELECT tm_extra_label FROM public.work_orders WHERE id=draft_wo) IS NOT NULL THEN RAISE EXCEPTION 'Unassignment left stale label'; END IF;
  RESET ROLE;
  INSERT INTO tm_extras_test_results VALUES('Live manual/timesheet totals, submitted split, closed extra preservation, label snapshots, reassignment and removal');
END
$test$;
SELECT test FROM tm_extras_test_results;


CREATE TEMP TABLE tm_cost_test_results(test text);
CREATE TEMP TABLE tm_cost_sources(day_offset int, entry_id uuid, source_hours numeric, source_profile uuid);
DO $cost_test$
DECLARE
 admin_id uuid; worker_id uuid; worker_two uuid; legacy_id uuid; job_a uuid; job_b uuid;
 job_number_a text := '__TM_COST_A_' || gen_random_uuid();
 job_number_b text := '__TM_COST_B_' || gen_random_uuid();
 first_extra uuid; second_extra uuid; wo_id uuid; entry_id uuid; submission_id uuid;
 report jsonb; result jsonb; total_hours numeric; total_cost numeric; total_missing numeric;
 allocated_hours numeric; allocated_cost numeric; allocated_missing numeric;
 first_day date := date '2099-01-04'; row record; work_day date; target_profile uuid;
BEGIN
 SELECT id INTO STRICT admin_id FROM public.profiles WHERE role='admin' AND account_status='approved' ORDER BY id LIMIT 1;
 SELECT p.id,w.id INTO STRICT worker_id,legacy_id FROM public.profiles p JOIN public.work_order_labour_workers w ON w.profile_id=p.id WHERE p.role='worker' AND p.account_status='approved' ORDER BY p.id LIMIT 1;
 SELECT id INTO STRICT worker_two FROM public.profiles WHERE role='worker' AND account_status='approved' AND id<>worker_id ORDER BY id LIMIT 1;
 SELECT id INTO STRICT submission_id FROM public.accounting_timesheet_submissions ORDER BY id LIMIT 1;
 INSERT INTO public.jobs(job_number,job_name,job_type) VALUES(job_number_a,'Synthetic labour QA A','contract') RETURNING id INTO job_a;
 INSERT INTO public.jobs(job_number,job_name,job_type) VALUES(job_number_b,'Synthetic labour QA B','contract') RETURNING id INTO job_b;
 PERFORM set_config('request.jwt.claim.sub',admin_id::text,true);
 first_extra := (public.save_job_tm_extra(job_number_a,'Synthetic X1')->>'id')::uuid;
 second_extra := (public.save_job_tm_extra(job_number_a,'Synthetic X2')->>'id')::uuid;
 INSERT INTO public.accounting_employee_rates(profile_id,regular_rate,night_premium,effective_from,created_by) VALUES
  (worker_id,31.17,2.35,'2099-01-01',admin_id),
  (worker_id,32.03,2.35,'2099-01-08',admin_id),
  (worker_two,20.13,1.17,'2099-01-01',admin_id);
 FOR row IN SELECT * FROM (VALUES
  (0,0.33),(0,0.67),(1,0.11),(2,0.17),(3,0.23),(4,0.29),(5,0.31),(6,0.37),(7,0.47),(8,0.53),(9,0.59),(10,0.43)
 ) x(day_offset,hours) LOOP
  work_day := first_day+row.day_offset;
  target_profile := CASE WHEN row.day_offset=9 THEN worker_two WHEN row.day_offset=10 THEN NULL ELSE worker_id END;
  INSERT INTO public.timesheet_entries(profile_id,worker_name,week_start,week_end,job_number,job_name,day_of_week,time_in,time_out,hours)
   VALUES(target_profile,coalesce((SELECT worker_key FROM public.profiles WHERE id=target_profile),'__Synthetic cost QA no-profile'),work_day-extract(dow FROM work_day)::int,
    work_day-extract(dow FROM work_day)::int+6,CASE WHEN row.day_offset=8 THEN job_number_b ELSE job_number_a END,
    'Synthetic cost QA',to_char(work_day,'FMDay'),'08:00','09:00',row.hours)
   RETURNING id INTO entry_id;
  INSERT INTO tm_cost_sources VALUES(row.day_offset,entry_id,row.hours,target_profile);
 END LOOP;
 -- Replace a provisional record with its captured payroll source; only 0.41 is costed.
 SELECT s.entry_id INTO STRICT entry_id FROM tm_cost_sources s WHERE day_offset=6;
 INSERT INTO public.accounting_time_entries(submission_id,source_entry_key,source_index,profile_id,worker_name,work_date,day_of_week,
  entry_type,job_id,job_match_status,shift_type,payable_hours,source_data)
 VALUES(submission_id,'__TM_COST_'||gen_random_uuid(),1,worker_id,(SELECT worker_key FROM public.profiles WHERE id=worker_id),first_day+6,to_char(first_day+6,'FMDay'),
  'work',job_a,'exact','night',0.41,jsonb_build_object('id',entry_id));
 -- X1 repeated WOs are deduplicated for costing; both first-ID and profile/day mappings apply.
 FOR row IN SELECT * FROM (VALUES
  (0,1,1),(0,1,2),(1,2,1),(3,1,1),(3,0,1),(4,1,1),(4,2,1),(5,1,1),(6,1,1),
  (7,2,1),(8,2,1),(9,2,1),(10,2,1)
 ) x(day_offset,extra_number,variant) LOOP
  INSERT INTO public.work_orders(wo_number,work_order_date,job_number,job_id,created_by,tm_extra_id)
   VALUES('WO-QA-'||gen_random_uuid(),first_day+row.day_offset+CASE WHEN row.day_offset=7 THEN 1 ELSE 0 END,
    job_number_a,job_a,admin_id,CASE row.extra_number WHEN 1 THEN first_extra WHEN 2 THEN second_extra ELSE NULL END)
   RETURNING id INTO wo_id;
  SELECT s.entry_id INTO entry_id FROM tm_cost_sources s WHERE day_offset=row.day_offset ORDER BY source_hours LIMIT 1;
  INSERT INTO public.work_order_labour(work_order_id,employee_id,employee_name,worker_key,hours,complete,matched_timesheet_entry_id)
   VALUES(wo_id,CASE WHEN row.day_offset=10 THEN NULL WHEN row.variant=2 THEN legacy_id ELSE worker_id END,
    'Synthetic cost worker','synthetic-'||gen_random_uuid(),CASE WHEN row.day_offset=5 THEN 0 ELSE 1 END,
    row.day_offset<>5,entry_id);
 END LOOP;
 INSERT INTO public.work_order_labour(work_order_id,employee_name,worker_key,hours,complete,notes)
 SELECT w.id,'Synthetic manual worker','manual-synthetic',3.75,true,'Manual labour entry'
 FROM public.work_orders w WHERE w.job_id=job_a AND w.tm_extra_id=first_extra ORDER BY w.id LIMIT 1;

 report := public.get_job_tm_extras(job_number_a)->'costing';
 SELECT e INTO STRICT result FROM jsonb_array_elements(report->'extras') e WHERE (e->>'id')::uuid=first_extra;
 IF (result->>'hours')::numeric<>1.72 OR (result->>'unpriced_manual_wo_hours')::numeric<>3.75 THEN
  RAISE EXCEPTION 'Extra X1 whole-day/dedup/zero-hour/submitted/manual classification failed: %',result;
 END IF;
 SELECT e INTO STRICT result FROM jsonb_array_elements(report->'extras') e WHERE (e->>'id')::uuid=second_extra;
 IF (result->>'hours')::numeric<>0.54 OR (result->>'missing_rate_hours')::numeric<>0.43 THEN
  RAISE EXCEPTION 'Extra X2 corrected job/date/worker or missing-rate classification failed: %',result;
 END IF;
 IF (report#>>'{original,hours}')::numeric<>1.23 OR (report#>>'{unallocated,hours}')::numeric<>0.52 THEN
  RAISE EXCEPTION 'Original and conflicting WO allocation failed: %',report;
 END IF;
 IF (report->>'unpriced_manual_wo_hours')::numeric<>3.75 THEN RAISE EXCEPTION 'Manual hours not separately tracked'; END IF;
 INSERT INTO tm_cost_test_results VALUES('Whole-day source attribution; first-entry and legacy profile mapping; repeated WO dedup; zero-hour expected worker');
 INSERT INTO tm_cost_test_results VALUES('Ambiguous base/extra and two-extra WOs stay unallocated; corrected job/date/worker references do not misassign');
 INSERT INTO tm_cost_test_results VALUES('Captured/provisional source dedup; missing-rate hours and separate manual unpriced hours');

 SELECT sum(hours),sum(loaded_labour_cost),sum(missing_rate_hours) INTO total_hours,total_cost,total_missing
 FROM public.get_estimator_job_labour_actuals() WHERE portal_job_id=job_a;
 IF (report#>>'{total,hours}')::numeric<>total_hours OR (report#>>'{total,loaded_cost}')::numeric<>total_cost OR
    (report#>>'{total,missing_rate_hours}')::numeric<>total_missing THEN
  RAISE EXCEPTION 'Existing authoritative totals changed';
 END IF;
 SELECT sum((e->>'hours')::numeric),sum((e->>'loaded_cost')::numeric),sum((e->>'missing_rate_hours')::numeric)
 INTO allocated_hours,allocated_cost,allocated_missing
 FROM jsonb_array_elements((report->'extras')||jsonb_build_array(report->'original',report->'unallocated'))e;
 IF allocated_hours<>total_hours OR allocated_cost<>total_cost OR allocated_missing<>total_missing THEN
  RAISE EXCEPTION 'Cost split does not reconcile';
 END IF;
 IF EXISTS(SELECT FROM jsonb_array_elements((report->'extras')||jsonb_build_array(report->'original',report->'unallocated'))e
  WHERE (e->>'hours')::numeric<0 OR (e->>'loaded_cost')::numeric<0 OR (e->>'missing_rate_hours')::numeric<0) THEN
  RAISE EXCEPTION 'Rounding produced negative bucket';
 END IF;
 -- Independent expected raw total verifies rate effectiveness and night premium.
 IF total_cost<>round(1.51*31.17*1.4+1.07*32.03*1.4,2)+round(.41*(32.03+2.35)*1.4,2)+round(.59*20.13*1.4,2) THEN
  RAISE EXCEPTION 'Synthetic effective-rate/night-premium expected cost differs: %',total_cost;
 END IF;
 INSERT INTO tm_cost_test_results VALUES('Cost/hours/missing-rate partitions exactly match existing RPC grouping/rounding; effective dates/night premiums preserved');
END
$cost_test$;
SELECT test FROM tm_cost_test_results;

DO $parity$
DECLARE result record;
BEGIN
 FOR result IN WITH old_totals AS MATERIALIZED (
 SELECT portal_job_id,sum(hours) AS hours,sum(loaded_labour_cost) AS cost,sum(missing_rate_hours) AS missing
 FROM public.get_estimator_job_labour_actuals() GROUP BY portal_job_id
), new_totals AS MATERIALIZED (
 SELECT id,private.jgc_job_tm_extra_costing(id)->'total' AS total FROM public.jobs
)
SELECT count(*) AS official_jobs_checked,
 count(*) FILTER(WHERE (n.total->>'hours')::numeric<>coalesce(o.hours,0)) AS hours_mismatches,
 count(*) FILTER(WHERE (n.total->>'loaded_cost')::numeric<>coalesce(o.cost,0)) AS cost_mismatches,
 count(*) FILTER(WHERE (n.total->>'missing_rate_hours')::numeric<>coalesce(o.missing,0)) AS missing_rate_mismatches
FROM new_totals n LEFT JOIN old_totals o ON o.portal_job_id=n.id LOOP
  IF result.hours_mismatches<>0 OR result.cost_mismatches<>0 OR result.missing_rate_mismatches<>0 THEN
   RAISE EXCEPTION 'Existing labour totals changed: %',row_to_json(result);
  END IF;
  INSERT INTO tm_cost_test_results VALUES('Authoritative total parity across '||result.official_jobs_checked||' official and synthetic jobs');
 END LOOP;
END
$parity$;
SELECT test FROM tm_extras_test_results UNION ALL SELECT test FROM tm_cost_test_results;
ROLLBACK;
