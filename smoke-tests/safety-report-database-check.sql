-- Run after the migration. Temporary copies test constraints without real reports,
-- acknowledgements, notifications or production triggers.
begin;
create temporary table injury_report_check (like public.employee_injury_reports including all);
create temporary table supervisor_report_check (like public.accident_reports including all);
do $$
declare
  payload jsonb := '{"version":1,"employee":{"manual":true,"company":"Synthetic trade"},"signatures":[{"role":"Employee","printedName":"Synthetic signer","strokes":[[[0.1,0.2],[0.3,0.4]]]}]}'::jsonb;
begin
  insert into injury_report_check(id,employee_worker,employee_display,employee_name,accident_location,accident_date,accident_description,created_by_worker,report_details)
  values(gen_random_uuid(),'manual:test','Synthetic person','Synthetic person','Synthetic site',current_date,'Synthetic incident','synthetic creator',payload);
  if not exists(select from injury_report_check where report_details=payload) then raise exception 'Structured data round trip failed'; end if;
  insert into supervisor_report_check(id,accident_date,site_location,injured_worker,injured_worker_display,report_maker_worker,report_maker_display,incident_description,created_by_worker)
  values(gen_random_uuid(),current_date,'Synthetic site','manual:test','Synthetic person','synthetic creator','Synthetic creator','Synthetic incident','synthetic creator');
  if not exists(select from supervisor_report_check where report_details='{}'::jsonb) then raise exception 'Legacy default failed'; end if;
  begin
    update injury_report_check set report_details='[]'::jsonb;
    raise exception 'Array payload accepted';
  exception when check_violation then null;
  end;
  begin
    update supervisor_report_check set report_details=jsonb_build_object('oversized',repeat('x',1048577));
    raise exception 'Oversized payload accepted';
  exception when check_violation then null;
  end;
end $$;
rollback;
select 'PASS: structured fields/signatures round trip, legacy default, object and size constraints; no retained test data' as result;
