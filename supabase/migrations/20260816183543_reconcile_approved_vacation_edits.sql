alter table public.timesheet_entries
  add column if not exists vacation_request_id uuid
  references public.vacation_requests(id) on delete set null;

create index if not exists timesheet_entries_vacation_request_id_idx
  on public.timesheet_entries (vacation_request_id)
  where vacation_request_id is not null;

create or replace function private.jgc_reconcile_vacation_worker_range(
  p_worker_name text,
  p_range_start date,
  p_range_end date
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_worker_key text := lower(trim(coalesce(p_worker_name, '')));
  v_profile_id uuid;
  v_profile_role text;
  v_date date;
  v_week_start date;
  v_week_end text;
  v_week_label text;
  v_day text;
  v_request public.vacation_requests%rowtype;
  v_week public.previous_timesheet_weeks%rowtype;
  v_entries jsonb;
  v_clean_entries jsonb;
  v_has_conflict boolean;
  v_total_hours numeric(10,2);
begin
  if v_worker_key = '' or p_range_start is null or p_range_end is null or p_range_end < p_range_start then
    return;
  end if;

  select profile.id, profile.role
  into v_profile_id, v_profile_role
  from public.profiles profile
  where lower(trim(profile.worker_key)) = v_worker_key
  limit 1;

  -- Salary administrators do not receive automatic vacation timesheet rows.
  if lower(coalesce(v_profile_role, '')) = 'admin' then
    return;
  end if;

  for v_date in
    select day_value::date
    from generate_series(p_range_start, p_range_end, interval '1 day') day_value
    where extract(isodow from day_value) between 1 and 5
  loop
    v_week_start := v_date - extract(dow from v_date)::integer;
    v_week_end := to_char((v_week_start + 6)::timestamp, 'Mon FMDD, YYYY');
    v_week_label := to_char(v_week_start::timestamp, 'Mon FMDD, YYYY') || ' to ' || v_week_end;
    v_day := case extract(dow from v_date)::integer
      when 1 then 'Monday'
      when 2 then 'Tuesday'
      when 3 then 'Wednesday'
      when 4 then 'Thursday'
      when 5 then 'Friday'
      else ''
    end;

    select request.*
    into v_request
    from public.vacation_requests request
    where lower(trim(request.worker_name)) = v_worker_key
      and request.status = 'approved'
      and v_date between request.start_date and request.end_date
      and coalesce((request.form_data ->> 'halfDayRequest')::boolean, false) = false
      and request.total_days <> 0.5
      and lower(request.request_type) not like '%half%'
    order by request.updated_at desc, request.created_at desc
    limit 1;

    select previous.*
    into v_week
    from public.previous_timesheet_weeks previous
    where (
        (v_profile_id is not null and previous.profile_id = v_profile_id)
        or lower(trim(previous.worker_name)) = v_worker_key
      )
      and (
        previous.week_label = v_week_label
        or exists (
          select 1
          from jsonb_array_elements(previous.entries) entry
          where entry ->> 'weekStartValue' = v_week_start::text
        )
      )
    order by previous.submitted_at desc
    limit 1
    for update;

    if found then
      select coalesce(jsonb_agg(entry.value order by entry.ordinality), '[]'::jsonb)
      into v_clean_entries
      from jsonb_array_elements(v_week.entries) with ordinality entry(value, ordinality)
      where not (
        entry.value ->> 'day' = v_day
        and coalesce(nullif(entry.value ->> 'entryType', ''), 'work') = 'vacation'
        and coalesce(entry.value ->> 'leaveType', '') <> 'half_day'
        and abs(coalesce(nullif(entry.value ->> 'hours', ''), '0')::numeric) <= 0.011
      );

      select exists (
        select 1
        from jsonb_array_elements(v_clean_entries) entry
        where entry ->> 'day' = v_day
      )
      into v_has_conflict;

      v_entries := v_clean_entries;

      if v_request.id is not null and not v_has_conflict then
        v_entries := v_entries || jsonb_build_array(jsonb_build_object(
          'id', gen_random_uuid()::text,
          'user', v_request.worker_name,
          'weekStartValue', v_week_start::text,
          'weekStart', to_char(v_week_start::timestamp, 'Mon FMDD, YYYY'),
          'weekEnd', v_week_end,
          'jobName', case when lower(v_request.request_type) like '%unpaid%' then 'Vacation Day - Unpaid' else 'Vacation Day - Paid' end,
          'jobNumber', coalesce(nullif(v_request.request_type, ''), 'Vacation'),
          'day', v_day,
          'timeIn', '00:00',
          'timeOut', '00:00',
          'hours', '0.01',
          'tookLunch', false,
          'nightWork', false,
          'entryType', 'vacation',
          'leaveType', case when lower(v_request.request_type) like '%unpaid%' then 'unpaid' else 'paid' end,
          'leaveNote', coalesce(nullif(v_request.request_type, ''), 'Approved Vacation'),
          'vacationRequestId', v_request.id::text
        ));
      end if;

      select coalesce(sum(
        case
          when coalesce(nullif(entry.value ->> 'entryType', ''), 'work') <> 'work'
            and abs(coalesce(nullif(entry.value ->> 'hours', ''), '0')::numeric) <= 0.011
            then 0
          else coalesce(nullif(entry.value ->> 'hours', ''), '0')::numeric
        end
      ), 0)::numeric(10,2)
      into v_total_hours
      from jsonb_array_elements(v_entries) entry;

      if jsonb_array_length(v_entries) = 0 then
        -- If an edited vacation request removes the only rows in a submitted
        -- week, remove the now-empty submission and its unlocked accounting
        -- snapshot instead of leaving stale leave data behind.
        delete from public.accounting_timesheet_submissions accounting
        where accounting.source_week_id = v_week.id;

        delete from public.previous_timesheet_weeks previous
        where previous.id = v_week.id;
      elsif v_entries is distinct from v_week.entries or v_total_hours is distinct from v_week.total_hours then
        update public.previous_timesheet_weeks
        set entries = v_entries,
            total_hours = v_total_hours
        where id = v_week.id;
      end if;

      delete from public.timesheet_entries live
      where (
          (v_profile_id is not null and live.profile_id = v_profile_id)
          or lower(trim(live.worker_name)) = v_worker_key
        )
        and live.week_start = v_week_start
        and live.day_of_week = v_day
        and live.entry_type = 'vacation'
        and live.leave_type <> 'half_day'
        and abs(live.hours) <= 0.011;
    else
      delete from public.timesheet_entries live
      where (
          (v_profile_id is not null and live.profile_id = v_profile_id)
          or lower(trim(live.worker_name)) = v_worker_key
        )
        and live.week_start = v_week_start
        and live.day_of_week = v_day
        and live.entry_type = 'vacation'
        and live.leave_type <> 'half_day'
        and abs(live.hours) <= 0.011;

      select exists (
        select 1
        from public.timesheet_entries live
        where (
            (v_profile_id is not null and live.profile_id = v_profile_id)
            or lower(trim(live.worker_name)) = v_worker_key
          )
          and live.week_start = v_week_start
          and live.day_of_week = v_day
      )
      into v_has_conflict;

      if v_request.id is not null and not v_has_conflict then
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
          vacation_request_id
        ) values (
          v_profile_id,
          v_request.worker_name,
          v_week_start,
          v_week_end,
          case when lower(v_request.request_type) like '%unpaid%' then 'Vacation Day - Unpaid' else 'Vacation Day - Paid' end,
          coalesce(nullif(v_request.request_type, ''), 'Vacation'),
          v_day,
          '00:00'::time,
          '00:00'::time,
          0.01,
          false,
          false,
          'vacation',
          case when lower(v_request.request_type) like '%unpaid%' then 'unpaid' else 'paid' end,
          coalesce(nullif(v_request.request_type, ''), 'Approved Vacation'),
          v_request.id
        );
      end if;
    end if;
  end loop;
end;
$$;

revoke all on function private.jgc_reconcile_vacation_worker_range(text, date, date)
  from public, anon, authenticated;

create or replace function private.jgc_reconcile_vacation_request_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op <> 'INSERT' then
    perform private.jgc_reconcile_vacation_worker_range(old.worker_name, old.start_date, old.end_date);
  end if;

  if tg_op <> 'DELETE' then
    perform private.jgc_reconcile_vacation_worker_range(new.worker_name, new.start_date, new.end_date);
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

revoke all on function private.jgc_reconcile_vacation_request_trigger()
  from public, anon, authenticated;

drop trigger if exists jgc_reconcile_vacation_request_timesheets on public.vacation_requests;
create trigger jgc_reconcile_vacation_request_timesheets
after insert or update of worker_name, start_date, end_date, total_days, request_type, status, form_data
or delete on public.vacation_requests
for each row execute function private.jgc_reconcile_vacation_request_trigger();

create or replace function private.jgc_remove_vacation_placeholder_for_work()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.entry_type = 'work' then
    delete from public.timesheet_entries vacation
    where vacation.id <> new.id
      and (
        (new.profile_id is not null and vacation.profile_id = new.profile_id)
        or lower(trim(vacation.worker_name)) = lower(trim(new.worker_name))
      )
      and vacation.week_start = new.week_start
      and vacation.day_of_week = new.day_of_week
      and vacation.entry_type = 'vacation'
      and vacation.leave_type <> 'half_day'
      and abs(vacation.hours) <= 0.011;
  end if;

  return new;
end;
$$;

revoke all on function private.jgc_remove_vacation_placeholder_for_work()
  from public, anon, authenticated;

drop trigger if exists jgc_remove_vacation_placeholder_when_work_saved on public.timesheet_entries;
create trigger jgc_remove_vacation_placeholder_when_work_saved
after insert or update of worker_name, profile_id, week_start, day_of_week, entry_type
on public.timesheet_entries
for each row execute function private.jgc_remove_vacation_placeholder_for_work();

create or replace function private.jgc_normalize_submitted_vacation_conflicts()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_entries jsonb;
begin
  if jsonb_typeof(new.entries) <> 'array' then
    return new;
  end if;

  select coalesce(jsonb_agg(entry.value order by entry.ordinality), '[]'::jsonb)
  into v_entries
  from jsonb_array_elements(new.entries) with ordinality entry(value, ordinality)
  where not (
    coalesce(nullif(entry.value ->> 'entryType', ''), 'work') = 'vacation'
    and coalesce(entry.value ->> 'leaveType', '') <> 'half_day'
    and abs(coalesce(nullif(entry.value ->> 'hours', ''), '0')::numeric) <= 0.011
    and exists (
      select 1
      from jsonb_array_elements(new.entries) work_entry
      where work_entry ->> 'day' = entry.value ->> 'day'
        and coalesce(nullif(work_entry ->> 'entryType', ''), 'work') = 'work'
    )
  );

  new.entries := v_entries;

  select coalesce(sum(
    case
      when coalesce(nullif(entry.value ->> 'entryType', ''), 'work') <> 'work'
        and abs(coalesce(nullif(entry.value ->> 'hours', ''), '0')::numeric) <= 0.011
        then 0
      else coalesce(nullif(entry.value ->> 'hours', ''), '0')::numeric
    end
  ), 0)::numeric(10,2)
  into new.total_hours
  from jsonb_array_elements(new.entries) entry;

  return new;
end;
$$;

revoke all on function private.jgc_normalize_submitted_vacation_conflicts()
  from public, anon, authenticated;

drop trigger if exists jgc_normalize_submitted_vacation_conflicts on public.previous_timesheet_weeks;
create trigger jgc_normalize_submitted_vacation_conflicts
before insert or update of entries, total_hours on public.previous_timesheet_weeks
for each row execute function private.jgc_normalize_submitted_vacation_conflicts();

create or replace function public.update_approved_vacation_request_dates(
  p_request_id uuid,
  p_start_date date,
  p_end_date date,
  p_return_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_request public.vacation_requests%rowtype;
  v_updated public.vacation_requests%rowtype;
  v_profile public.profiles%rowtype;
  v_is_admin boolean := false;
  v_is_owner boolean := false;
  v_total_days numeric;
begin
  if v_user_id is null then
    raise exception 'Sign in before editing a vacation request.' using errcode = '42501';
  end if;

  select profile.*
  into v_profile
  from public.profiles profile
  where profile.id = v_user_id
    and profile.account_status = 'approved';

  if v_profile.id is null or not private.jgc_has_full_portal_access() then
    raise exception 'Approved portal access is required.' using errcode = '42501';
  end if;

  select request.*
  into v_request
  from public.vacation_requests request
  where request.id = p_request_id
  for update;

  if v_request.id is null then
    raise exception 'Vacation request not found.';
  end if;

  v_is_admin := v_profile.role = 'admin';
  v_is_owner := lower(trim(v_profile.worker_key)) = lower(trim(v_request.worker_name));

  if not v_is_admin and not v_is_owner then
    raise exception 'You can edit only your own approved vacation requests.' using errcode = '42501';
  end if;

  if v_request.status <> 'approved' then
    raise exception 'Only approved vacation requests can be edited here.';
  end if;

  if p_start_date is null or p_end_date is null or p_end_date < p_start_date then
    raise exception 'Choose a valid first and last day off.';
  end if;

  if p_end_date - p_start_date > 62 then
    raise exception 'Vacation edits cannot span more than 63 calendar days.';
  end if;

  if p_return_date is not null and p_return_date <= p_end_date then
    raise exception 'Return to work must be after the last day off.';
  end if;

  if exists (
    select 1
    from public.accounting_pay_periods period
    where period.status = 'locked'
      and daterange(period.week_one_start, period.week_two_end, '[]') &&
          daterange(least(v_request.start_date, p_start_date), greatest(v_request.end_date, p_end_date), '[]')
  ) then
    raise exception 'This vacation overlaps a locked Accounting period and cannot be changed.';
  end if;

  if coalesce((v_request.form_data ->> 'halfDayRequest')::boolean, false) then
    if p_start_date <> p_end_date then
      raise exception 'A half-day request must start and end on the same date.';
    end if;
    v_total_days := 0.5;
  else
    select count(*)::numeric
    into v_total_days
    from generate_series(p_start_date, p_end_date, interval '1 day') day_value
    where extract(isodow from day_value) between 1 and 5;

    if v_total_days < 1 then
      raise exception 'The edited request must include at least one weekday.';
    end if;
  end if;

  update public.vacation_requests request
  set start_date = p_start_date,
      end_date = p_end_date,
      return_date = p_return_date,
      total_days = v_total_days,
      form_data = request.form_data || jsonb_build_object(
        'startDate', p_start_date::text,
        'endDate', p_end_date::text,
        'returnDate', coalesce(p_return_date::text, ''),
        'totalDays', v_total_days
      ),
      email_body = concat_ws(E'\n',
        'Vacation Request',
        'Employee: ' || coalesce(request.worker_display_name, request.worker_name),
        'Request Date: ' || request.request_date::text,
        '',
        'First Day Off: ' || p_start_date::text,
        'Last Day Off: ' || p_end_date::text,
        'Return To Work Date: ' || coalesce(p_return_date::text, ''),
        'Requested Work Days: ' || v_total_days::text,
        'Request Type: ' || request.request_type,
        'Half Day: ' || case when coalesce((request.form_data ->> 'halfDayRequest')::boolean, false) then 'Yes' else 'No' end,
        'Finish Time: ' || coalesce(request.form_data ->> 'halfDayFinishTimeLabel', ''),
        '',
        'Notes:',
        coalesce(request.reason, ''),
        '',
        'Employee Signature: ' || request.employee_signature,
        'Status: Approved'
      ),
      updated_at = now(),
      google_sync_status = 'not_synced',
      google_sync_error = null
  where request.id = p_request_id
  returning request.* into v_updated;

  return jsonb_build_object(
    'request', to_jsonb(v_updated),
    'message', 'Approved vacation dates updated and timesheets reconciled.'
  );
end;
$$;

revoke all on function public.update_approved_vacation_request_dates(uuid, date, date, date)
  from public, anon;
grant execute on function public.update_approved_vacation_request_dates(uuid, date, date, date)
  to authenticated;

comment on function public.update_approved_vacation_request_dates(uuid, date, date, date)
  is 'Lets the owning employee or an approved admin change approved vacation dates while reconciling live and submitted timesheet placeholders.';
