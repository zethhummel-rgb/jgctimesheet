create or replace function public.accounting_autofill_leave_timesheet(
  p_profile_id uuid,
  p_week_start date,
  p_days text[] default '{}'::text[],
  p_entry_type text default 'vacation',
  p_leave_type text default 'paid',
  p_note text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin_name text;
  v_worker_name text;
  v_worker_key text;
  v_entry_type text := lower(trim(coalesce(p_entry_type, '')));
  v_leave_type text := lower(trim(coalesce(p_leave_type, '')));
  v_note text := trim(coalesce(p_note, ''));
  v_label text;
  v_days text[];
  v_day text;
  v_missing_days text[];
  v_week_end_text text;
  v_week_label text;
  v_archive_entries jsonb;
  v_total_hours numeric(10,2);
  v_source_week_id uuid;
  v_filled_count integer := 0;
begin
  if (select auth.uid()) is null or not private.jgc_has_accounting_access() then
    raise exception 'Accounting administrator access is required.' using errcode = '42501';
  end if;

  select profile.display_name
  into v_admin_name
  from public.profiles profile
  where profile.id = (select auth.uid())
    and profile.role = 'admin'
    and profile.account_status = 'approved';

  if p_week_start is null or extract(dow from p_week_start) <> 0 then
    raise exception 'The timesheet week must start on Sunday.';
  end if;

  if length(v_note) > 500 then
    raise exception 'The Accounting note cannot exceed 500 characters.';
  end if;

  if v_entry_type not in ('vacation', 'civic_holiday') then
    raise exception 'Only Vacation or Civic Holiday can be auto-filled.';
  end if;

  if v_entry_type = 'vacation' and v_leave_type not in ('paid', 'unpaid') then
    raise exception 'Vacation must be marked Paid or Unpaid.';
  end if;

  if v_entry_type = 'civic_holiday' then
    v_leave_type := '';
    v_label := 'Civic Holiday';
  else
    v_label := 'Vacation';
  end if;

  select profile.display_name, profile.worker_key
  into v_worker_name, v_worker_key
  from public.profiles profile
  where profile.id = p_profile_id
    and profile.account_status = 'approved'
    and exists (
      select 1
      from public.work_order_labour_workers worker
      join public.employee_feature_access access
        on access.worker_id = worker.id
       and access.feature_key = 'accounting'
       and access.enabled = true
      where worker.profile_id = profile.id
        and worker.approved = true
    );

  if v_worker_name is null then
    raise exception 'This employee is not enabled for Accounting.' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_profile_id::text || '|' || p_week_start::text, 0));

  v_week_end_text := to_char((p_week_start + 6)::timestamp, 'Mon FMDD, YYYY');
  v_week_label := to_char(p_week_start::timestamp, 'Mon FMDD, YYYY') || ' to ' || v_week_end_text;

  if exists (
    select 1
    from public.previous_timesheet_weeks previous
    where previous.profile_id = p_profile_id
      and (
        previous.week_label = v_week_label
        or previous.entries -> 0 ->> 'weekStartValue' = p_week_start::text
      )
  ) then
    raise exception 'This employee already has a submitted timesheet for that week.';
  end if;

  select coalesce(array_agg(day_name order by day_offset), '{}'::text[])
  into v_days
  from (
    select distinct
      case lower(trim(selected_day))
        when 'monday' then 'Monday'
        when 'tuesday' then 'Tuesday'
        when 'wednesday' then 'Wednesday'
        when 'thursday' then 'Thursday'
        when 'friday' then 'Friday'
        else null
      end as day_name,
      case lower(trim(selected_day))
        when 'monday' then 1
        when 'tuesday' then 2
        when 'wednesday' then 3
        when 'thursday' then 4
        when 'friday' then 5
        else null
      end as day_offset
    from unnest(coalesce(p_days, '{}'::text[])) selected_day
  ) normalized_days
  where day_name is not null;

  if cardinality(v_days) <> cardinality(coalesce(p_days, '{}'::text[])) then
    raise exception 'Only Monday through Friday can be auto-filled.';
  end if;

  update public.timesheet_entries entry
  set profile_id = p_profile_id
  where entry.profile_id is null
    and lower(trim(entry.worker_name)) = lower(trim(v_worker_key))
    and entry.week_start = p_week_start;

  foreach v_day in array v_days
  loop
    if exists (
      select 1
      from public.timesheet_entries entry
      where entry.profile_id = p_profile_id
        and entry.week_start = p_week_start
        and entry.day_of_week = v_day
    ) then
      raise exception '% already has a timesheet entry for %.', v_worker_name, v_day;
    end if;

    insert into public.timesheet_entries (
      profile_id,
      worker_name,
      week_start,
      week_end,
      job_name,
      job_number,
      day_of_week,
      time_in,
      time_out,
      hours,
      took_lunch,
      night_work,
      entry_type,
      leave_type,
      leave_note,
      admin_entered_by,
      admin_entered_at,
      admin_entry_note
    ) values (
      p_profile_id,
      v_worker_name,
      p_week_start,
      v_week_end_text,
      v_label,
      v_label,
      v_day,
      '00:00'::time,
      '00:00'::time,
      0.01,
      false,
      false,
      v_entry_type,
      v_leave_type,
      coalesce(nullif(v_note, ''), v_label),
      v_admin_name,
      now(),
      'Accounting auto-fill: ' || v_label || coalesce(' - ' || nullif(v_note, ''), '')
    );

    v_filled_count := v_filled_count + 1;
  end loop;

  select coalesce(array_agg(required_day order by day_offset), '{}'::text[])
  into v_missing_days
  from (
    values
      ('Monday'::text, 1),
      ('Tuesday'::text, 2),
      ('Wednesday'::text, 3),
      ('Thursday'::text, 4),
      ('Friday'::text, 5)
  ) required(required_day, day_offset)
  where not exists (
    select 1
    from public.timesheet_entries entry
    where entry.profile_id = p_profile_id
      and entry.week_start = p_week_start
      and entry.day_of_week = required.required_day
  );

  if cardinality(v_missing_days) > 0 then
    raise exception 'The week is still missing: %.', array_to_string(v_missing_days, ', ');
  end if;

  select
    jsonb_agg(
      jsonb_build_object(
        'id', entry.id::text,
        'user', entry.worker_name,
        'weekStartValue', entry.week_start::text,
        'weekStart', to_char(entry.week_start::timestamp, 'Mon FMDD, YYYY'),
        'weekEnd', entry.week_end,
        'jobName', entry.job_name,
        'jobNumber', entry.job_number,
        'day', entry.day_of_week,
        'timeIn', to_char(entry.time_in, 'HH24:MI'),
        'timeOut', to_char(entry.time_out, 'HH24:MI'),
        'hours', entry.hours,
        'tookLunch', entry.took_lunch,
        'nightWork', entry.night_work,
        'entryType', entry.entry_type,
        'leaveType', entry.leave_type,
        'leaveNote', coalesce(nullif(entry.leave_note, ''), nullif(entry.admin_entry_note, ''), '')
      ) order by
        case entry.day_of_week
          when 'Sunday' then 0
          when 'Monday' then 1
          when 'Tuesday' then 2
          when 'Wednesday' then 3
          when 'Thursday' then 4
          when 'Friday' then 5
          when 'Saturday' then 6
          else 7
        end,
        entry.created_at,
        entry.id
    ),
    coalesce(sum(
      case
        when entry.entry_type <> 'work' and abs(entry.hours - 0.01) < 0.001 then 0
        else entry.hours
      end
    ), 0)::numeric(10,2)
  into v_archive_entries, v_total_hours
  from public.timesheet_entries entry
  where entry.profile_id = p_profile_id
    and entry.week_start = p_week_start;

  insert into public.previous_timesheet_weeks (
    profile_id,
    worker_name,
    week_label,
    entries,
    total_hours,
    note
  ) values (
    p_profile_id,
    v_worker_name,
    v_week_label,
    v_archive_entries,
    v_total_hours,
    case
      when v_filled_count > 0 then
        'Accounting auto-filled ' || v_label || ' for ' || array_to_string(v_days, ', ')
          || coalesce('. ' || nullif(v_note, ''), '') || '. Submitted by ' || v_admin_name || '.'
      else
        'Completed week submitted by Accounting (' || v_admin_name || ').'
    end
  )
  returning id into v_source_week_id;

  delete from public.timesheet_entries entry
  where entry.profile_id = p_profile_id
    and entry.week_start = p_week_start;

  return jsonb_build_object(
    'source_week_id', v_source_week_id,
    'profile_id', p_profile_id,
    'worker_name', v_worker_name,
    'week_start', p_week_start,
    'week_label', v_week_label,
    'filled_days', v_days,
    'total_hours', v_total_hours
  );
end;
$$;

comment on function public.accounting_autofill_leave_timesheet(uuid, date, text[], text, text, text)
  is 'Approved Accounting administrators can fill missing weekdays with leave markers and atomically submit the completed employee timesheet week.';

revoke all on function public.accounting_autofill_leave_timesheet(uuid, date, text[], text, text, text) from public;
revoke all on function public.accounting_autofill_leave_timesheet(uuid, date, text[], text, text, text) from anon;
revoke all on function public.accounting_autofill_leave_timesheet(uuid, date, text[], text, text, text) from authenticated;
grant execute on function public.accounting_autofill_leave_timesheet(uuid, date, text[], text, text, text) to authenticated;
