-- All fixture dates, entries and archives below are rolled back.
begin;
select set_config('request.jwt.claim.sub',(select id::text from public.profiles where role='admin' and account_status='approved' order by id limit 1),true);
set local role authenticated;
do $$
declare
  employee uuid; week_start date := date '2098-08-03' - extract(dow from date '2098-08-03')::int;
  result jsonb; archived jsonb; baseline integer;
begin
  select p.id into employee from public.profiles p
    join public.work_order_labour_workers w on w.profile_id=p.id and w.approved
    join public.employee_feature_access a on a.worker_id=w.id and a.feature_key='accounting' and a.enabled
    where p.account_status='approved' and p.role <> 'admin' order by p.id limit 1;
  if employee is null then raise exception 'No eligible employee for rolled-back verification'; end if;
  perform set_config('jgc.test_employment_profile',employee::text,true);
  select count(*) into baseline from public.previous_timesheet_weeks where profile_id=employee;
  update public.profiles set hire_date=week_start+3 where id=employee;
  begin
    perform public.accounting_autofill_leave_timesheet(employee,week_start-7,array['Monday']);
    raise exception 'Pre-start week accepted' using errcode='ZX001';
  exception when raise_exception then
    if sqlerrm not like '%Employment Start Date%' then raise; end if;
  end;
  begin
    perform public.accounting_autofill_leave_timesheet(employee,week_start,array['Monday','Wednesday','Thursday','Friday']);
    raise exception 'Pre-start day accepted' using errcode='ZX001';
  exception when raise_exception then
    if sqlerrm not like '%Employment Start Date%' then raise; end if;
  end;
  begin
    perform public.accounting_autofill_leave_timesheet(employee,week_start,array['Wednesday']);
    raise exception 'Incomplete week accepted' using errcode='ZX001';
  exception when raise_exception then
    if sqlerrm not like '%still missing%' then raise; end if;
  end;
  result := public.accounting_autofill_leave_timesheet(employee,week_start,array['Wednesday','Thursday','Friday']);
  select entries into archived from public.previous_timesheet_weeks where id=(result->>'source_week_id')::uuid;
  if jsonb_array_length(archived) <> 3 or exists(select 1 from jsonb_array_elements(archived) e where e->>'day' in ('Monday','Tuesday')) then raise exception 'Partial week archive is incorrect'; end if;
  if (result->>'total_hours')::numeric <> 0 then raise exception 'Leave markers became paid work hours'; end if;
  update public.profiles set hire_date=null where id=employee;
  result := public.accounting_autofill_leave_timesheet(employee,week_start+7,array['Monday','Tuesday','Wednesday','Thursday','Friday']);
  if jsonb_array_length(result->'filled_days') <> 5 then raise exception 'Legacy full-week expectation changed'; end if;
  update public.profiles set hire_date=week_start+20 where id=employee;
  begin
    perform public.accounting_autofill_leave_timesheet(employee,week_start+14,array[]::text[]);
    raise exception 'Empty Saturday-start week accepted' using errcode='ZX001';
  exception when raise_exception then
    if sqlerrm not like '%Employment Start Date%' then raise; end if;
  end;
  if (select count(*) from public.previous_timesheet_weeks where profile_id=employee) <> baseline+2 then raise exception 'Unexpected archive writes'; end if;
end $$;
select set_config('request.jwt.claim.sub',current_setting('jgc.test_employment_profile'),true);
do $$
declare affected integer;
begin
  update public.profiles set hire_date=date '2099-01-01' where id=auth.uid();
  get diagnostics affected=row_count;
  if affected <> 0 then raise exception 'Employee changed protected employment date'; end if;
  begin
    perform public.accounting_autofill_leave_timesheet(auth.uid(),date '2098-08-03',array['Monday']);
    raise exception 'Employee invoked Accounting autofill' using errcode='ZX001';
  exception when insufficient_privilege then null; end;
end $$;
rollback;
select 'PASS: employment start checks completed and all fixture changes rolled back' as result;
