create or replace function public.get_estimator_job_labour_actuals()
returns table (
  portal_job_id uuid,
  job_number text,
  worker_profile_id uuid,
  worker_name text,
  source_status text,
  first_work_date date,
  last_work_date date,
  hours numeric,
  loaded_labour_cost numeric,
  missing_rate_hours numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (select public.is_admin()) then
    raise insufficient_privilege using
      message = 'Approved administrator access is required to view employee labour costs.';
  end if;

  return query
  with source_entries as (
    select
      entry.job_id as portal_job_id,
      job.job_number,
      entry.profile_id as worker_profile_id,
      entry.worker_name,
      entry.work_date,
      entry.payable_hours as hours,
      entry.shift_type = 'night' as is_night,
      'submitted'::text as source_status
    from public.accounting_time_entries entry
    join public.jobs job on job.id = entry.job_id
    where entry.is_current
      and lower(entry.entry_type) = 'work'
      and entry.job_id is not null
      and entry.payable_hours > 0

    union all

    select
      job.id as portal_job_id,
      job.job_number,
      entry.profile_id as worker_profile_id,
      entry.worker_name,
      (entry.week_start + case lower(entry.day_of_week)
        when 'sunday' then 0
        when 'monday' then 1
        when 'tuesday' then 2
        when 'wednesday' then 3
        when 'thursday' then 4
        when 'friday' then 5
        when 'saturday' then 6
        else 0
      end)::date as work_date,
      entry.hours,
      coalesce(entry.night_work, false) as is_night,
      'provisional'::text as source_status
    from public.timesheet_entries entry
    join public.jobs job
      on lower(trim(job.job_number)) = lower(trim(entry.job_number))
    where lower(entry.entry_type) = 'work'
      and entry.hours > 0
      and not exists (
        select 1
        from public.accounting_time_entries captured
        where captured.is_current
          and captured.source_data ->> 'id' = entry.id::text
      )
  ),
  costed as (
    select
      source.*,
      rate.regular_rate,
      rate.night_premium
    from source_entries source
    left join lateral (
      select employee_rate.regular_rate, employee_rate.night_premium
      from public.accounting_employee_rates employee_rate
      where employee_rate.profile_id = source.worker_profile_id
        and employee_rate.effective_from <= source.work_date
      order by employee_rate.effective_from desc
      limit 1
    ) rate on true
  )
  select
    costed.portal_job_id,
    costed.job_number,
    costed.worker_profile_id,
    costed.worker_name,
    costed.source_status,
    min(costed.work_date) as first_work_date,
    max(costed.work_date) as last_work_date,
    round(sum(costed.hours), 2) as hours,
    round(sum(
      case
        when costed.regular_rate is null then 0
        else costed.hours
          * (costed.regular_rate + case when costed.is_night then coalesce(costed.night_premium, 0) else 0 end)
          * 1.4
      end
    ), 2) as loaded_labour_cost,
    round(sum(case when costed.regular_rate is null then costed.hours else 0 end), 2) as missing_rate_hours
  from costed
  group by
    costed.portal_job_id,
    costed.job_number,
    costed.worker_profile_id,
    costed.worker_name,
    costed.source_status
  order by costed.job_number, costed.worker_name, costed.source_status;
end;
$$;

comment on function public.get_estimator_job_labour_actuals() is
  'Returns approved-admin-only job labour summaries for the Estimator. Loaded cost matches the Accounting workbook: regular wages plus night premium, with 40 percent burden. Raw pay rates are never returned.';

revoke all on function public.get_estimator_job_labour_actuals() from public, anon, authenticated;
grant execute on function public.get_estimator_job_labour_actuals() to authenticated;
