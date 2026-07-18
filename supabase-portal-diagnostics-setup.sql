begin;

create table if not exists public.portal_diagnostics (
  id uuid primary key default gen_random_uuid(),
  client_event_id text,
  created_at timestamptz not null default now(),
  occurred_at timestamptz not null default now(),
  severity text not null default 'info'
    check (severity in ('info', 'warning', 'error')),
  category text not null default 'system'
    check (category in ('sync', 'email', 'pdf', 'storage', 'backup', 'save', 'admin', 'system')),
  event_type text not null,
  source text not null default 'portal',
  message text not null,
  details jsonb not null default '{}'::jsonb,
  profile_id uuid references auth.users(id) on delete set null,
  actor_name text,
  page_url text,
  record_table text,
  record_id text,
  related_url text,
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null
);

create unique index if not exists portal_diagnostics_client_event_id_key
  on public.portal_diagnostics (client_event_id)
  where client_event_id is not null;

create index if not exists portal_diagnostics_created_at_idx
  on public.portal_diagnostics (created_at desc);

create index if not exists portal_diagnostics_open_issues_idx
  on public.portal_diagnostics (severity, category, created_at desc)
  where resolved_at is null;

create index if not exists portal_diagnostics_record_idx
  on public.portal_diagnostics (record_table, record_id);

create index if not exists portal_diagnostics_profile_id_idx
  on public.portal_diagnostics (profile_id)
  where profile_id is not null;

create index if not exists portal_diagnostics_resolved_by_idx
  on public.portal_diagnostics (resolved_by)
  where resolved_by is not null;

alter table public.portal_diagnostics enable row level security;

revoke all on table public.portal_diagnostics from anon;
revoke all on table public.portal_diagnostics from authenticated;
grant insert, select, update on table public.portal_diagnostics to authenticated;
grant all on table public.portal_diagnostics to service_role;

drop policy if exists "Authenticated users can record their diagnostics" on public.portal_diagnostics;
create policy "Authenticated users can record their diagnostics"
  on public.portal_diagnostics
  for insert
  to authenticated
  with check (
    (select auth.uid()) is not null
    and profile_id = (select auth.uid())
  );

drop policy if exists "Approved admins can view diagnostics" on public.portal_diagnostics;
create policy "Approved admins can view diagnostics"
  on public.portal_diagnostics
  for select
  to authenticated
  using ((select public.is_admin()));

drop policy if exists "Approved admins can resolve diagnostics" on public.portal_diagnostics;
create policy "Approved admins can resolve diagnostics"
  on public.portal_diagnostics
  for update
  to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create or replace function public.record_portal_save_activity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  payload jsonb := to_jsonb(new);
  actor_text text;
  actor_id uuid;
  actor_label text;
  record_label text;
  table_label text;
  status_label text;
  related_link text;
begin
  if tg_op = 'UPDATE'
     and (payload - 'updated_at') = (to_jsonb(old) - 'updated_at') then
    return new;
  end if;

  actor_text := coalesce(
    (select auth.uid())::text,
    nullif(payload ->> 'submitted_by_profile_id', ''),
    nullif(payload ->> 'last_edited_by_profile_id', ''),
    nullif(payload ->> 'creator_profile_id', ''),
    nullif(payload ->> 'created_by', ''),
    nullif(payload ->> 'receipt_uploaded_by', '')
  );

  if actor_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    actor_id := actor_text::uuid;
  end if;

  actor_label := coalesce(
    nullif(payload ->> 'submitted_by_name', ''),
    nullif(payload ->> 'last_edited_by_name', ''),
    nullif(payload ->> 'creator_name', ''),
    nullif(payload ->> 'created_by_name', ''),
    nullif(payload ->> 'worker_display_name', ''),
    nullif(payload ->> 'worker_name', ''),
    nullif(payload ->> 'driver_name', '')
  );

  table_label := case tg_table_name
    when 'previous_timesheet_weeks' then 'Timesheet'
    when 'work_orders' then 'Work order'
    when 'digital_purchase_orders' then 'Purchase order'
    when 'inspection_records' then 'Inspection'
    when 'vehicle_inspection_records' then 'Vehicle inspection'
    when 'vacation_requests' then 'Vacation request'
    when 'tasks' then 'Task'
    when 'daily_site_reports' then 'Daily site report'
    else initcap(replace(tg_table_name, '_', ' '))
  end;

  record_label := coalesce(
    case when payload ? 'po_number' then 'PO-' || nullif(payload ->> 'po_number', '') end,
    nullif(payload ->> 'wo_number', ''),
    nullif(payload ->> 'week_label', ''),
    nullif(payload ->> 'title', ''),
    nullif(payload ->> 'inspection_type', ''),
    nullif(payload ->> 'job_name', ''),
    nullif(payload ->> 'project', ''),
    nullif(payload ->> 'id', '')
  );

  status_label := coalesce(
    nullif(payload ->> 'workflow_status', ''),
    nullif(payload ->> 'status', ''),
    case when tg_op = 'INSERT' then 'created' else 'saved' end
  );

  related_link := case tg_table_name
    when 'digital_purchase_orders' then 'purchase-orders-admin.html?po=' || coalesce(payload ->> 'id', '')
    when 'work_orders' then 'work-orders.html?wo=' || coalesce(payload ->> 'id', '')
    when 'previous_timesheet_weeks' then 'admin.html?tab=timesheets'
    when 'inspection_records' then 'admin.html?tab=inspections'
    when 'vehicle_inspection_records' then 'admin.html?tab=inspections'
    when 'vacation_requests' then 'admin.html?tab=vacation'
    when 'tasks' then 'admin.html?tab=tasks'
    when 'daily_site_reports' then 'admin.html?tab=reports'
    else null
  end;

  insert into public.portal_diagnostics (
    occurred_at,
    severity,
    category,
    event_type,
    source,
    message,
    details,
    profile_id,
    actor_name,
    record_table,
    record_id,
    related_url
  ) values (
    now(),
    'info',
    'save',
    tg_table_name || '_' || lower(tg_op),
    'database',
    table_label || case when tg_op = 'INSERT' then ' created' else ' saved' end ||
      case when record_label is not null then ': ' || record_label else '' end,
    jsonb_strip_nulls(jsonb_build_object(
      'operation', lower(tg_op),
      'status', status_label,
      'job_number', nullif(payload ->> 'job_number', ''),
      'job_name', nullif(payload ->> 'job_name', ''),
      'record_date', coalesce(
        nullif(payload ->> 'order_date', ''),
        nullif(payload ->> 'work_order_date', ''),
        nullif(payload ->> 'inspection_date', ''),
        nullif(payload ->> 'report_date', ''),
        nullif(payload ->> 'request_date', '')
      )
    )),
    actor_id,
    actor_label,
    tg_table_name,
    payload ->> 'id',
    related_link
  );

  return new;
exception
  when others then
    -- Diagnostics must never block the business save that produced the event.
    return new;
end;
$$;

revoke execute on function public.record_portal_save_activity() from public, anon, authenticated;
grant execute on function public.record_portal_save_activity() to service_role;

do $$
declare
  target_table text;
  trigger_name text;
begin
  foreach target_table in array array[
    'previous_timesheet_weeks',
    'work_orders',
    'digital_purchase_orders',
    'inspection_records',
    'vehicle_inspection_records',
    'vacation_requests',
    'tasks',
    'daily_site_reports'
  ] loop
    trigger_name := 'portal_diagnostics_' || target_table || '_save';
    execute format('drop trigger if exists %I on public.%I', trigger_name, target_table);
    execute format(
      'create trigger %I after insert or update on public.%I for each row execute function public.record_portal_save_activity()',
      trigger_name,
      target_table
    );
  end loop;
end;
$$;

comment on table public.portal_diagnostics is
  'Admin-only operational diagnostics and recent portal save activity. Business records are never deleted through this table.';

commit;
