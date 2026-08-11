-- Secure Accounting / payroll ledger and least-privilege timesheet ownership.
-- The Accounting ledger is durable even when employee-facing submitted weeks
-- are removed by the existing two-month retention cleanup.

create schema if not exists private;

alter table public.timesheet_entries
  add column if not exists profile_id uuid;

alter table public.previous_timesheet_weeks
  add column if not exists profile_id uuid;

update public.timesheet_entries e
set profile_id = p.id
from public.profiles p
where e.profile_id is null
  and p.worker_key = lower(trim(e.worker_name));

update public.previous_timesheet_weeks w
set profile_id = p.id
from public.profiles p
where w.profile_id is null
  and p.worker_key = lower(trim(w.worker_name));

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'timesheet_entries_profile_id_fkey'
      and conrelid = 'public.timesheet_entries'::regclass
  ) then
    alter table public.timesheet_entries
      add constraint timesheet_entries_profile_id_fkey
      foreign key (profile_id) references public.profiles(id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'previous_timesheet_weeks_profile_id_fkey'
      and conrelid = 'public.previous_timesheet_weeks'::regclass
  ) then
    alter table public.previous_timesheet_weeks
      add constraint previous_timesheet_weeks_profile_id_fkey
      foreign key (profile_id) references public.profiles(id) on delete set null;
  end if;
end $$;

create index if not exists timesheet_entries_profile_week_idx
  on public.timesheet_entries (profile_id, week_start);

create index if not exists previous_timesheet_weeks_profile_submitted_idx
  on public.previous_timesheet_weeks (profile_id, submitted_at desc);

create or replace function private.jgc_assign_timesheet_profile_id()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select p.id
  into new.profile_id
  from public.profiles p
  where p.worker_key = lower(trim(new.worker_name))
  limit 1;

  return new;
end;
$$;

revoke all on function private.jgc_assign_timesheet_profile_id() from public, anon, authenticated;

drop trigger if exists jgc_assign_timesheet_entry_profile_id on public.timesheet_entries;
create trigger jgc_assign_timesheet_entry_profile_id
before insert or update of worker_name, profile_id on public.timesheet_entries
for each row execute function private.jgc_assign_timesheet_profile_id();

drop trigger if exists jgc_assign_previous_timesheet_profile_id on public.previous_timesheet_weeks;
create trigger jgc_assign_previous_timesheet_profile_id
before insert or update of worker_name, profile_id on public.previous_timesheet_weeks
for each row execute function private.jgc_assign_timesheet_profile_id();

create table if not exists public.accounting_employee_settings (
  profile_id uuid primary key references public.profiles(id) on delete restrict,
  include_in_payroll boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.accounting_employee_rates (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete restrict,
  pay_type text not null default 'hourly' check (pay_type in ('hourly', 'salary')),
  regular_rate numeric(10,2) not null check (regular_rate >= 0),
  overtime_multiplier numeric(6,3) not null default 1.5 check (overtime_multiplier >= 0),
  night_premium numeric(10,2) not null default 3.00 check (night_premium >= 0),
  effective_from date not null,
  note text not null default '' check (length(note) <= 1000),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (profile_id, effective_from)
);

create table if not exists public.accounting_pay_periods (
  id uuid primary key default gen_random_uuid(),
  pay_date date not null unique,
  week_one_start date not null,
  week_one_end date not null,
  week_two_start date not null,
  week_two_end date not null,
  status text not null default 'draft' check (status in ('draft', 'locked')),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  locked_by uuid references public.profiles(id) on delete set null,
  locked_at timestamptz,
  check (week_one_end = week_one_start + 6),
  check (week_two_start = week_one_end + 1),
  check (week_two_end = week_two_start + 6),
  check (pay_date = week_two_end + 5),
  check ((status = 'draft' and locked_at is null and locked_by is null)
    or (status = 'locked' and locked_at is not null and locked_by is not null))
);

create table if not exists public.accounting_period_employee_inputs (
  pay_period_id uuid not null references public.accounting_pay_periods(id) on delete restrict,
  profile_id uuid not null references public.profiles(id) on delete restrict,
  stat_selected boolean not null default false,
  stat_hours numeric(6,2) not null default 0 check (stat_hours >= 0 and stat_hours <= 40),
  adjustment numeric(12,2) not null default 0,
  vacation_pay numeric(12,2) not null default 0,
  other_amount numeric(12,2) not null default 0,
  note text not null default '' check (length(note) <= 2000),
  updated_by uuid not null references public.profiles(id) on delete restrict,
  updated_at timestamptz not null default now(),
  primary key (pay_period_id, profile_id)
);

create table if not exists public.accounting_timesheet_submissions (
  id uuid primary key default gen_random_uuid(),
  source_week_id uuid not null unique,
  profile_id uuid references public.profiles(id) on delete set null,
  worker_name text not null,
  week_label text not null,
  week_start date not null,
  week_end date not null,
  original_entries jsonb not null check (jsonb_typeof(original_entries) = 'array'),
  source_total_hours numeric(10,2) not null default 0,
  normalized_work_hours numeric(10,2) not null default 0,
  note text not null default '',
  submitted_at timestamptz not null,
  captured_at timestamptz not null default now(),
  source_revision integer not null default 1 check (source_revision >= 1),
  check (week_end = week_start + 6)
);

create table if not exists public.accounting_time_entries (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.accounting_timesheet_submissions(id) on delete restrict,
  source_entry_key text not null,
  source_index integer not null check (source_index >= 1),
  profile_id uuid references public.profiles(id) on delete set null,
  worker_name text not null,
  work_date date not null,
  day_of_week text not null check (day_of_week in ('Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday')),
  entry_type text not null,
  leave_type text not null default '',
  leave_note text not null default '',
  source_job_number text not null default '',
  source_job_name text not null default '',
  job_id uuid references public.jobs(id) on delete set null,
  job_match_status text not null check (job_match_status in ('exact', 'manual', 'unmatched', 'not_applicable')),
  job_match_note text not null default '',
  job_matched_by uuid references public.profiles(id) on delete set null,
  job_matched_at timestamptz,
  shift_type text not null check (shift_type in ('day', 'night')),
  original_hours numeric(10,2) not null default 0,
  payable_hours numeric(10,2) not null default 0,
  time_in text not null default '',
  time_out text not null default '',
  took_lunch boolean not null default false,
  is_current boolean not null default true,
  source_data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (submission_id, source_entry_key)
);

create table if not exists public.accounting_workbook_templates (
  id text primary key,
  file_name text not null,
  file_base64 text not null,
  file_sha256 text not null check (file_sha256 ~ '^[a-f0-9]{64}$'),
  is_active boolean not null default true,
  uploaded_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists accounting_one_active_workbook_template_idx
  on public.accounting_workbook_templates (is_active)
  where is_active;

create table if not exists public.accounting_exports (
  id uuid primary key default gen_random_uuid(),
  pay_period_id uuid not null references public.accounting_pay_periods(id) on delete restrict,
  file_name text not null,
  file_sha256 text not null check (file_sha256 ~ '^[a-f0-9]{64}$'),
  file_base64 text not null,
  is_final boolean not null default false,
  snapshot jsonb not null,
  exported_by uuid not null references public.profiles(id) on delete restrict,
  exported_at timestamptz not null default now()
);

create table if not exists public.accounting_audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id) on delete set null,
  table_name text not null,
  record_id text not null,
  action text not null check (action in ('INSERT', 'UPDATE')),
  old_data jsonb,
  new_data jsonb,
  changed_at timestamptz not null default now()
);

create index if not exists accounting_submissions_period_idx
  on public.accounting_timesheet_submissions (week_start, profile_id);
create index if not exists accounting_entries_period_profile_idx
  on public.accounting_time_entries (work_date, profile_id)
  where is_current;
create index if not exists accounting_entries_unmatched_idx
  on public.accounting_time_entries (work_date, job_match_status)
  where is_current and job_match_status = 'unmatched';
create index if not exists accounting_entries_job_idx
  on public.accounting_time_entries (job_id, work_date)
  where is_current;
create index if not exists accounting_rates_profile_effective_idx
  on public.accounting_employee_rates (profile_id, effective_from desc);
create index if not exists accounting_inputs_profile_idx
  on public.accounting_period_employee_inputs (profile_id, pay_period_id);
create index if not exists accounting_exports_period_idx
  on public.accounting_exports (pay_period_id, exported_at desc);
create unique index if not exists accounting_one_final_export_per_period_idx
  on public.accounting_exports (pay_period_id)
  where is_final;
create index if not exists accounting_audit_changed_idx
  on public.accounting_audit_log (changed_at desc);
create index if not exists accounting_audit_actor_idx
  on public.accounting_audit_log (actor_id, changed_at desc);

insert into public.accounting_employee_settings (
  profile_id,
  include_in_payroll,
  created_by,
  updated_by
)
select
  p.id,
  (p.account_status = 'approved' and p.role <> 'admin' and p.worker_key <> 'test account'),
  p.id,
  p.id
from public.profiles p
on conflict (profile_id) do nothing;

create or replace function private.jgc_capture_accounting_timesheet(
  p_source_week_id uuid,
  p_worker_name text,
  p_week_label text,
  p_entries jsonb,
  p_total_hours numeric,
  p_submitted_at timestamptz,
  p_note text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_submission_id uuid;
  v_profile_id uuid;
  v_week_start date;
  v_week_end date;
  v_normalized_work_hours numeric(10,2);
  v_entry jsonb;
  v_ordinal bigint;
  v_entry_type text;
  v_day text;
  v_work_date date;
  v_source_hours numeric(10,2);
  v_job_id uuid;
  v_job_status text;
  v_source_key text;
begin
  if jsonb_typeof(p_entries) <> 'array' or jsonb_array_length(p_entries) = 0 then
    raise exception 'Accounting capture requires a non-empty timesheet entry array.';
  end if;

  select p.id into v_profile_id
  from public.profiles p
  where p.worker_key = lower(trim(p_worker_name))
  limit 1;

  v_week_start := nullif(p_entries -> 0 ->> 'weekStartValue', '')::date;
  if v_week_start is null then
    raise exception 'Accounting capture requires weekStartValue.';
  end if;
  v_week_end := v_week_start + 6;

  select coalesce(sum(
    case
      when coalesce(nullif(item ->> 'entryType', ''), 'work') = 'work'
        then coalesce(nullif(item ->> 'hours', ''), '0')::numeric
      else 0
    end
  ), 0)::numeric(10,2)
  into v_normalized_work_hours
  from jsonb_array_elements(p_entries) item;

  insert into public.accounting_timesheet_submissions (
    source_week_id,
    profile_id,
    worker_name,
    week_label,
    week_start,
    week_end,
    original_entries,
    source_total_hours,
    normalized_work_hours,
    note,
    submitted_at
  ) values (
    p_source_week_id,
    v_profile_id,
    p_worker_name,
    p_week_label,
    v_week_start,
    v_week_end,
    p_entries,
    coalesce(p_total_hours, 0),
    v_normalized_work_hours,
    coalesce(p_note, ''),
    p_submitted_at
  )
  on conflict (source_week_id) do update set
    profile_id = excluded.profile_id,
    worker_name = excluded.worker_name,
    week_label = excluded.week_label,
    week_start = excluded.week_start,
    week_end = excluded.week_end,
    original_entries = excluded.original_entries,
    source_total_hours = excluded.source_total_hours,
    normalized_work_hours = excluded.normalized_work_hours,
    note = excluded.note,
    submitted_at = excluded.submitted_at,
    captured_at = now(),
    source_revision = public.accounting_timesheet_submissions.source_revision + 1
  returning id into v_submission_id;

  update public.accounting_time_entries
  set is_current = false,
      updated_at = now()
  where submission_id = v_submission_id;

  for v_entry, v_ordinal in
    select value, ordinality
    from jsonb_array_elements(p_entries) with ordinality
  loop
    v_entry_type := coalesce(nullif(v_entry ->> 'entryType', ''), 'work');
    v_day := coalesce(nullif(v_entry ->> 'day', ''), 'Sunday');
    v_work_date := v_week_start + case v_day
      when 'Sunday' then 0
      when 'Monday' then 1
      when 'Tuesday' then 2
      when 'Wednesday' then 3
      when 'Thursday' then 4
      when 'Friday' then 5
      when 'Saturday' then 6
      else 0
    end;
    v_source_hours := coalesce(nullif(v_entry ->> 'hours', ''), '0')::numeric(10,2);
    v_source_key := coalesce(nullif(v_entry ->> 'id', ''), 'entry-' || v_ordinal::text);
    v_job_id := null;

    if v_entry_type = 'work' and trim(coalesce(v_entry ->> 'jobNumber', '')) <> '' then
      select j.id into v_job_id
      from public.jobs j
      where lower(trim(j.job_number)) = lower(trim(v_entry ->> 'jobNumber'))
      limit 1;
    end if;

    v_job_status := case
      when v_entry_type <> 'work' then 'not_applicable'
      when v_job_id is not null then 'exact'
      else 'unmatched'
    end;

    insert into public.accounting_time_entries (
      submission_id,
      source_entry_key,
      source_index,
      profile_id,
      worker_name,
      work_date,
      day_of_week,
      entry_type,
      leave_type,
      leave_note,
      source_job_number,
      source_job_name,
      job_id,
      job_match_status,
      shift_type,
      original_hours,
      payable_hours,
      time_in,
      time_out,
      took_lunch,
      is_current,
      source_data
    ) values (
      v_submission_id,
      v_source_key,
      v_ordinal::integer,
      v_profile_id,
      p_worker_name,
      v_work_date,
      v_day,
      v_entry_type,
      coalesce(v_entry ->> 'leaveType', ''),
      coalesce(v_entry ->> 'leaveNote', ''),
      coalesce(v_entry ->> 'jobNumber', ''),
      coalesce(v_entry ->> 'jobName', ''),
      v_job_id,
      v_job_status,
      case when coalesce((v_entry ->> 'nightWork')::boolean, false) then 'night' else 'day' end,
      v_source_hours,
      case when v_entry_type = 'work' then v_source_hours else 0 end,
      coalesce(v_entry ->> 'timeIn', ''),
      coalesce(v_entry ->> 'timeOut', ''),
      coalesce((v_entry ->> 'tookLunch')::boolean, false),
      true,
      v_entry
    )
    on conflict (submission_id, source_entry_key) do update set
      source_index = excluded.source_index,
      profile_id = excluded.profile_id,
      worker_name = excluded.worker_name,
      work_date = excluded.work_date,
      day_of_week = excluded.day_of_week,
      entry_type = excluded.entry_type,
      leave_type = excluded.leave_type,
      leave_note = excluded.leave_note,
      source_job_number = excluded.source_job_number,
      source_job_name = excluded.source_job_name,
      job_id = case
        when public.accounting_time_entries.job_matched_by is not null
          and public.accounting_time_entries.job_match_status in ('manual', 'not_applicable')
          then public.accounting_time_entries.job_id
        else excluded.job_id
      end,
      job_match_status = case
        when public.accounting_time_entries.job_matched_by is not null
          and public.accounting_time_entries.job_match_status in ('manual', 'not_applicable')
          then public.accounting_time_entries.job_match_status
        else excluded.job_match_status
      end,
      job_match_note = case
        when public.accounting_time_entries.job_matched_by is not null
          and public.accounting_time_entries.job_match_status in ('manual', 'not_applicable')
          then public.accounting_time_entries.job_match_note
        else ''
      end,
      job_matched_by = case
        when public.accounting_time_entries.job_matched_by is not null
          and public.accounting_time_entries.job_match_status in ('manual', 'not_applicable')
          then public.accounting_time_entries.job_matched_by
        else null
      end,
      job_matched_at = case
        when public.accounting_time_entries.job_matched_by is not null
          and public.accounting_time_entries.job_match_status in ('manual', 'not_applicable')
          then public.accounting_time_entries.job_matched_at
        else null
      end,
      shift_type = excluded.shift_type,
      original_hours = excluded.original_hours,
      payable_hours = excluded.payable_hours,
      time_in = excluded.time_in,
      time_out = excluded.time_out,
      took_lunch = excluded.took_lunch,
      is_current = true,
      source_data = excluded.source_data,
      updated_at = now();
  end loop;
end;
$$;

revoke all on function private.jgc_capture_accounting_timesheet(uuid,text,text,jsonb,numeric,timestamptz,text)
  from public, anon, authenticated;

create or replace function private.jgc_capture_accounting_timesheet_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.jgc_capture_accounting_timesheet(
    new.id,
    new.worker_name,
    new.week_label,
    new.entries,
    new.total_hours,
    new.submitted_at,
    new.note
  );
  return new;
end;
$$;

revoke all on function private.jgc_capture_accounting_timesheet_trigger() from public, anon, authenticated;

drop trigger if exists jgc_capture_accounting_timesheet on public.previous_timesheet_weeks;
create trigger jgc_capture_accounting_timesheet
after insert or update of worker_name, week_label, entries, total_hours, submitted_at, note
on public.previous_timesheet_weeks
for each row execute function private.jgc_capture_accounting_timesheet_trigger();

select private.jgc_capture_accounting_timesheet(
  w.id,
  w.worker_name,
  w.week_label,
  w.entries,
  w.total_hours,
  w.submitted_at,
  w.note
)
from public.previous_timesheet_weeks w
order by w.submitted_at;

create or replace function private.jgc_protect_accounting_pay_period()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'locked' then
    raise exception 'Locked Accounting pay periods cannot be changed.';
  end if;

  if new.pay_date is distinct from old.pay_date
    or new.week_one_start is distinct from old.week_one_start
    or new.week_one_end is distinct from old.week_one_end
    or new.week_two_start is distinct from old.week_two_start
    or new.week_two_end is distinct from old.week_two_end
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at then
    raise exception 'Accounting pay-period dates and creator fields are immutable.';
  end if;

  if new.status = 'locked' and not exists (
    select 1
    from public.accounting_exports e
    where e.pay_period_id = old.id
      and e.is_final
  ) then
    raise exception 'A pay period can only be locked by its final workbook export.';
  end if;

  return new;
end;
$$;

revoke all on function private.jgc_protect_accounting_pay_period() from public, anon, authenticated;

drop trigger if exists accounting_protect_pay_period on public.accounting_pay_periods;
create trigger accounting_protect_pay_period
before update on public.accounting_pay_periods
for each row execute function private.jgc_protect_accounting_pay_period();

create or replace function private.jgc_guard_accounting_export()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  select p.status
  into v_status
  from public.accounting_pay_periods p
  where p.id = new.pay_period_id
  for update;

  if v_status is null then
    raise exception 'Accounting pay period not found.';
  end if;

  if v_status <> 'draft' then
    raise exception 'No new exports can be added to a locked Accounting pay period.';
  end if;

  return new;
end;
$$;

revoke all on function private.jgc_guard_accounting_export() from public, anon, authenticated;

drop trigger if exists accounting_guard_export on public.accounting_exports;
create trigger accounting_guard_export
before insert on public.accounting_exports
for each row execute function private.jgc_guard_accounting_export();

create or replace function private.jgc_finalize_accounting_export()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.accounting_pay_periods
  set status = 'locked',
      updated_by = new.exported_by,
      updated_at = new.exported_at,
      locked_by = new.exported_by,
      locked_at = new.exported_at
  where id = new.pay_period_id
    and status = 'draft';

  if not found then
    raise exception 'The Accounting pay period could not be locked.';
  end if;

  return new;
end;
$$;

revoke all on function private.jgc_finalize_accounting_export() from public, anon, authenticated;

drop trigger if exists accounting_finalize_export on public.accounting_exports;
create trigger accounting_finalize_export
after insert on public.accounting_exports
for each row
when (new.is_final)
execute function private.jgc_finalize_accounting_export();

create or replace function private.jgc_accounting_audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new jsonb;
  v_old jsonb;
  v_record_id text;
begin
  v_new := case when tg_op = 'INSERT' then to_jsonb(new) else to_jsonb(new) end;
  v_old := case when tg_op = 'UPDATE' then to_jsonb(old) else null end;

  if tg_table_name = 'accounting_workbook_templates' then
    v_new := v_new - 'file_base64';
    v_old := case when v_old is null then null else v_old - 'file_base64' end;
  elsif tg_table_name = 'accounting_exports' then
    v_new := v_new - 'file_base64' - 'snapshot';
    v_old := case when v_old is null then null else v_old - 'file_base64' - 'snapshot' end;
  end if;

  v_record_id := coalesce(
    v_new ->> 'id',
    nullif(concat_ws(':', v_new ->> 'pay_period_id', v_new ->> 'profile_id'), ''),
    v_new ->> 'profile_id',
    'unknown'
  );

  insert into public.accounting_audit_log (
    actor_id,
    table_name,
    record_id,
    action,
    old_data,
    new_data
  ) values (
    (select auth.uid()),
    tg_table_name,
    v_record_id,
    tg_op,
    v_old,
    v_new
  );

  return new;
end;
$$;

revoke all on function private.jgc_accounting_audit_trigger() from public, anon, authenticated;

drop trigger if exists accounting_employee_settings_audit on public.accounting_employee_settings;
create trigger accounting_employee_settings_audit
after insert or update on public.accounting_employee_settings
for each row execute function private.jgc_accounting_audit_trigger();

drop trigger if exists accounting_employee_rates_audit on public.accounting_employee_rates;
create trigger accounting_employee_rates_audit
after insert on public.accounting_employee_rates
for each row execute function private.jgc_accounting_audit_trigger();

drop trigger if exists accounting_pay_periods_audit on public.accounting_pay_periods;
create trigger accounting_pay_periods_audit
after insert or update on public.accounting_pay_periods
for each row execute function private.jgc_accounting_audit_trigger();

drop trigger if exists accounting_period_employee_inputs_audit on public.accounting_period_employee_inputs;
create trigger accounting_period_employee_inputs_audit
after insert or update on public.accounting_period_employee_inputs
for each row execute function private.jgc_accounting_audit_trigger();

drop trigger if exists accounting_workbook_templates_audit on public.accounting_workbook_templates;
create trigger accounting_workbook_templates_audit
after insert or update on public.accounting_workbook_templates
for each row execute function private.jgc_accounting_audit_trigger();

drop trigger if exists accounting_time_entries_manual_job_audit on public.accounting_time_entries;
create trigger accounting_time_entries_manual_job_audit
after update of job_id, job_match_status, job_match_note on public.accounting_time_entries
for each row
when (
  old.job_id is distinct from new.job_id
  or old.job_match_status is distinct from new.job_match_status
  or old.job_match_note is distinct from new.job_match_note
)
execute function private.jgc_accounting_audit_trigger();

drop trigger if exists accounting_exports_audit on public.accounting_exports;
create trigger accounting_exports_audit
after insert on public.accounting_exports
for each row execute function private.jgc_accounting_audit_trigger();

alter table public.accounting_employee_settings enable row level security;
alter table public.accounting_employee_rates enable row level security;
alter table public.accounting_pay_periods enable row level security;
alter table public.accounting_period_employee_inputs enable row level security;
alter table public.accounting_timesheet_submissions enable row level security;
alter table public.accounting_time_entries enable row level security;
alter table public.accounting_workbook_templates enable row level security;
alter table public.accounting_exports enable row level security;
alter table public.accounting_audit_log enable row level security;

revoke all on public.accounting_employee_settings from public, anon, authenticated;
revoke all on public.accounting_employee_rates from public, anon, authenticated;
revoke all on public.accounting_pay_periods from public, anon, authenticated;
revoke all on public.accounting_period_employee_inputs from public, anon, authenticated;
revoke all on public.accounting_timesheet_submissions from public, anon, authenticated;
revoke all on public.accounting_time_entries from public, anon, authenticated;
revoke all on public.accounting_workbook_templates from public, anon, authenticated;
revoke all on public.accounting_exports from public, anon, authenticated;
revoke all on public.accounting_audit_log from public, anon, authenticated;

grant select, insert, update on public.accounting_employee_settings to authenticated;
grant select, insert on public.accounting_employee_rates to authenticated;
grant select, insert, update on public.accounting_pay_periods to authenticated;
grant select, insert, update on public.accounting_period_employee_inputs to authenticated;
grant select on public.accounting_timesheet_submissions to authenticated;
grant select on public.accounting_time_entries to authenticated;
grant update (job_id, job_match_status, job_match_note, job_matched_by, job_matched_at)
  on public.accounting_time_entries to authenticated;
grant select, insert, update on public.accounting_workbook_templates to authenticated;
grant select, insert on public.accounting_exports to authenticated;
grant select on public.accounting_audit_log to authenticated;

grant all on public.accounting_employee_settings to service_role;
grant all on public.accounting_employee_rates to service_role;
grant all on public.accounting_pay_periods to service_role;
grant all on public.accounting_period_employee_inputs to service_role;
grant all on public.accounting_timesheet_submissions to service_role;
grant all on public.accounting_time_entries to service_role;
grant all on public.accounting_workbook_templates to service_role;
grant all on public.accounting_exports to service_role;
grant all on public.accounting_audit_log to service_role;
grant usage, select on sequence public.accounting_audit_log_id_seq to service_role;

create policy "Approved admins read accounting employee settings"
on public.accounting_employee_settings for select to authenticated
using ((select public.is_admin()));
create policy "Approved admins add accounting employee settings"
on public.accounting_employee_settings for insert to authenticated
with check ((select public.is_admin()));
create policy "Approved admins update accounting employee settings"
on public.accounting_employee_settings for update to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

create policy "Approved admins read accounting rates"
on public.accounting_employee_rates for select to authenticated
using ((select public.is_admin()));
create policy "Approved admins add accounting rates"
on public.accounting_employee_rates for insert to authenticated
with check ((select public.is_admin()) and created_by = (select auth.uid()));

create policy "Approved admins read accounting pay periods"
on public.accounting_pay_periods for select to authenticated
using ((select public.is_admin()));
create policy "Approved admins add accounting pay periods"
on public.accounting_pay_periods for insert to authenticated
with check ((select public.is_admin()) and created_by = (select auth.uid()));
create policy "Approved admins lock draft accounting pay periods"
on public.accounting_pay_periods for update to authenticated
using ((select public.is_admin()) and status = 'draft')
with check (
  (select public.is_admin())
  and updated_by = (select auth.uid())
  and status in ('draft', 'locked')
);

create policy "Approved admins read accounting period inputs"
on public.accounting_period_employee_inputs for select to authenticated
using ((select public.is_admin()));
create policy "Approved admins add draft accounting period inputs"
on public.accounting_period_employee_inputs for insert to authenticated
with check (
  (select public.is_admin())
  and updated_by = (select auth.uid())
  and exists (
    select 1 from public.accounting_pay_periods p
    where p.id = pay_period_id and p.status = 'draft'
  )
);
create policy "Approved admins update draft accounting period inputs"
on public.accounting_period_employee_inputs for update to authenticated
using (
  (select public.is_admin())
  and exists (
    select 1 from public.accounting_pay_periods p
    where p.id = pay_period_id and p.status = 'draft'
  )
)
with check (
  (select public.is_admin())
  and updated_by = (select auth.uid())
  and exists (
    select 1 from public.accounting_pay_periods p
    where p.id = pay_period_id and p.status = 'draft'
  )
);

create policy "Approved admins read captured accounting submissions"
on public.accounting_timesheet_submissions for select to authenticated
using ((select public.is_admin()));

create policy "Approved admins read captured accounting entries"
on public.accounting_time_entries for select to authenticated
using ((select public.is_admin()));
create policy "Approved admins match accounting entries to jobs"
on public.accounting_time_entries for update to authenticated
using (
  (select public.is_admin())
  and not exists (
    select 1
    from public.accounting_pay_periods p
    where p.status = 'locked'
      and accounting_time_entries.work_date between p.week_one_start and p.week_two_end
  )
)
with check (
  (select public.is_admin())
  and not exists (
    select 1
    from public.accounting_pay_periods p
    where p.status = 'locked'
      and accounting_time_entries.work_date between p.week_one_start and p.week_two_end
  )
  and job_match_status in ('manual', 'unmatched', 'not_applicable')
  and (
    (job_match_status = 'manual' and job_id is not null and job_matched_by = (select auth.uid()) and job_matched_at is not null)
    or (job_match_status = 'not_applicable' and job_id is null and job_matched_by = (select auth.uid()) and job_matched_at is not null)
    or (job_match_status = 'unmatched' and job_id is null)
  )
);

create policy "Approved admins read accounting workbook templates"
on public.accounting_workbook_templates for select to authenticated
using ((select public.is_admin()));
create policy "Approved admins add accounting workbook templates"
on public.accounting_workbook_templates for insert to authenticated
with check ((select public.is_admin()) and uploaded_by = (select auth.uid()));
create policy "Approved admins update accounting workbook templates"
on public.accounting_workbook_templates for update to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()) and uploaded_by = (select auth.uid()));

create policy "Approved admins read accounting exports"
on public.accounting_exports for select to authenticated
using ((select public.is_admin()));
create policy "Approved admins add accounting exports"
on public.accounting_exports for insert to authenticated
with check ((select public.is_admin()) and exported_by = (select auth.uid()));

create policy "Approved admins read accounting audit log"
on public.accounting_audit_log for select to authenticated
using ((select public.is_admin()));

revoke truncate, references, trigger on public.timesheet_entries from anon, authenticated;
revoke truncate, references, trigger on public.previous_timesheet_weeks from anon, authenticated;
revoke all on public.timesheet_entries from anon;
revoke all on public.previous_timesheet_weeks from anon;
grant select, insert, update, delete on public.timesheet_entries to authenticated;
grant select, insert, update, delete on public.previous_timesheet_weeks to authenticated;

drop policy if exists "Authenticated users can delete worker timesheet entries" on public.timesheet_entries;
drop policy if exists "Authenticated users can add valid timesheet entries" on public.timesheet_entries;
drop policy if exists "Authenticated users can read timesheet entries" on public.timesheet_entries;
drop policy if exists "Limited access can read own timesheet entries" on public.timesheet_entries;
drop policy if exists "Authenticated users can update worker timesheet entries" on public.timesheet_entries;

create policy "Owners and admins read live timesheet entries"
on public.timesheet_entries for select to authenticated
using (
  (select public.is_admin())
  or (profile_id = (select auth.uid()) and (select private.jgc_has_full_portal_access()))
  or (profile_id = (select auth.uid()) and (select private.jgc_limited_worker_matches(worker_name)))
);

create policy "Owners and admins add live timesheet entries"
on public.timesheet_entries for insert to authenticated
with check (
  (
    (select public.is_admin())
    or (profile_id = (select auth.uid()) and (select private.jgc_has_full_portal_access()))
  )
  and length(trim(worker_name)) between 1 and 100
  and length(trim(job_name)) between 1 and 150
  and length(trim(job_number)) <= 50
  and day_of_week in ('Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday')
  and hours between 0 and 24
);

create policy "Owners and admins update live timesheet entries"
on public.timesheet_entries for update to authenticated
using (
  (select public.is_admin())
  or (profile_id = (select auth.uid()) and (select private.jgc_has_full_portal_access()))
)
with check (
  (
    (select public.is_admin())
    or (profile_id = (select auth.uid()) and (select private.jgc_has_full_portal_access()))
  )
  and length(trim(worker_name)) between 1 and 100
  and length(trim(job_name)) between 1 and 150
  and length(trim(job_number)) <= 50
  and day_of_week in ('Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday')
  and hours between 0 and 24
);

create policy "Owners and admins delete live timesheet entries"
on public.timesheet_entries for delete to authenticated
using (
  (select public.is_admin())
  or (profile_id = (select auth.uid()) and (select private.jgc_has_full_portal_access()))
);

drop policy if exists "Authenticated users can delete previous timesheet weeks" on public.previous_timesheet_weeks;
drop policy if exists "Authenticated users can add previous timesheet weeks" on public.previous_timesheet_weeks;
drop policy if exists "Authenticated users can read previous timesheet weeks" on public.previous_timesheet_weeks;
drop policy if exists "Limited access can read own submitted timesheets" on public.previous_timesheet_weeks;

create policy "Owners and admins read submitted timesheet weeks"
on public.previous_timesheet_weeks for select to authenticated
using (
  (select public.is_admin())
  or (profile_id = (select auth.uid()) and (select private.jgc_has_full_portal_access()))
  or (profile_id = (select auth.uid()) and (select private.jgc_limited_worker_matches(worker_name)))
);

create policy "Owners and admins add submitted timesheet weeks"
on public.previous_timesheet_weeks for insert to authenticated
with check (
  (
    (select public.is_admin())
    or (profile_id = (select auth.uid()) and (select private.jgc_has_full_portal_access()))
  )
  and length(trim(worker_name)) between 1 and 100
  and length(trim(week_label)) between 1 and 100
  and jsonb_typeof(entries) = 'array'
  and total_hours >= 0
  and length(note) <= 2000
);

create policy "Approved admins update submitted timesheet weeks"
on public.previous_timesheet_weeks for update to authenticated
using ((select public.is_admin()))
with check (
  (select public.is_admin())
  and length(trim(worker_name)) between 1 and 100
  and length(trim(week_label)) between 1 and 100
  and jsonb_typeof(entries) = 'array'
  and total_hours >= 0
  and length(note) <= 2000
);

create policy "Owners and admins delete submitted timesheet weeks"
on public.previous_timesheet_weeks for delete to authenticated
using (
  (select public.is_admin())
  or (profile_id = (select auth.uid()) and (select private.jgc_has_full_portal_access()))
);
