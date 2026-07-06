-- JGC Portal notification center setup.
--
-- Run this once in Supabase SQL Editor after deploying the matching website files.
-- It adds:
-- 1. Supervisor as an allowed profile role value.
-- 2. Notification records with click/clear tracking.
-- 3. Admin-managed notification settings for employee/supervisor/admin audiences.

alter table public.profiles
  add column if not exists role text default 'worker';

create table if not exists public.notification_settings (
  id uuid primary key default gen_random_uuid(),
  notification_type text not null unique,
  label text not null,
  description text default '',
  employee_enabled boolean not null default true,
  supervisor_enabled boolean not null default true,
  admin_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  notification_type text not null,
  title text not null,
  message text default '',
  link_url text default '',
  target_profile_id uuid references public.profiles(id) on delete cascade,
  target_worker_key text default '',
  target_worker_email text default '',
  target_role text default '',
  source_table text default '',
  source_id text default '',
  dedupe_key text default '',
  metadata jsonb not null default '{}'::jsonb,
  clicked_at timestamptz,
  cleared_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_by_name text default '',
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.notifications
  add column if not exists dedupe_key text default '';

create index if not exists idx_notifications_target_profile
  on public.notifications (target_profile_id, cleared_at, created_at desc);

create index if not exists idx_notifications_target_email
  on public.notifications (lower(target_worker_email), cleared_at, created_at desc);

create index if not exists idx_notifications_target_worker_key
  on public.notifications (lower(target_worker_key), cleared_at, created_at desc);

create index if not exists idx_notifications_target_role
  on public.notifications (lower(target_role), cleared_at, created_at desc);

create index if not exists idx_notifications_type
  on public.notifications (notification_type, created_at desc);

create unique index if not exists idx_notifications_dedupe_key
  on public.notifications (dedupe_key)
  where dedupe_key is not null and dedupe_key <> '';

create index if not exists idx_notification_settings_type
  on public.notification_settings (notification_type);

alter table public.notification_settings enable row level security;
alter table public.notifications enable row level security;

grant select on public.notification_settings to authenticated;
grant insert, update, delete on public.notification_settings to authenticated;

grant select on public.notifications to authenticated;
grant insert, update on public.notifications to authenticated;

drop policy if exists "notification_settings_select_authenticated" on public.notification_settings;
create policy "notification_settings_select_authenticated"
on public.notification_settings
for select
to authenticated
using (true);

drop policy if exists "notification_settings_admin_write" on public.notification_settings;
create policy "notification_settings_admin_write"
on public.notification_settings
for all
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'admin'
  )
)
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'admin'
  )
);

drop policy if exists "notifications_select_own_role_or_admin" on public.notifications;
create policy "notifications_select_own_role_or_admin"
on public.notifications
for select
to authenticated
using (
  target_profile_id = (select auth.uid())
  or lower(coalesce(target_worker_email, '')) = lower(coalesce((select auth.jwt() ->> 'email'), ''))
  or exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and (
        p.role = 'admin'
        or lower(coalesce(public.notifications.target_worker_key, '')) = lower(coalesce(p.worker_key, ''))
        or lower(coalesce(public.notifications.target_worker_key, '')) = lower(coalesce(p.display_name, ''))
      )
  )
);

drop policy if exists "notifications_update_own_role_or_admin" on public.notifications;
create policy "notifications_update_own_role_or_admin"
on public.notifications
for update
to authenticated
using (
  target_profile_id = (select auth.uid())
  or lower(coalesce(target_worker_email, '')) = lower(coalesce((select auth.jwt() ->> 'email'), ''))
  or exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and (
        p.role = 'admin'
        or lower(coalesce(public.notifications.target_worker_key, '')) = lower(coalesce(p.worker_key, ''))
        or lower(coalesce(public.notifications.target_worker_key, '')) = lower(coalesce(p.display_name, ''))
      )
  )
)
with check (
  target_profile_id = (select auth.uid())
  or lower(coalesce(target_worker_email, '')) = lower(coalesce((select auth.jwt() ->> 'email'), ''))
  or exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and (
        p.role = 'admin'
        or lower(coalesce(public.notifications.target_worker_key, '')) = lower(coalesce(p.worker_key, ''))
        or lower(coalesce(public.notifications.target_worker_key, '')) = lower(coalesce(p.display_name, ''))
      )
  )
);

drop policy if exists "notifications_admin_insert" on public.notifications;
drop policy if exists "notifications_insert_admin_or_creator" on public.notifications;
create policy "notifications_insert_admin_or_creator"
on public.notifications
for insert
to authenticated
with check (
  created_by = (select auth.uid())
  or exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'admin'
  )
);

insert into public.notification_settings
  (notification_type, label, description, employee_enabled, supervisor_enabled, admin_enabled)
values
  ('wo_hours_requested', 'WO requested hours', 'Employees receive requested Work Order hour reminders.', true, true, true),
  ('timesheet_missing', 'Timesheet reminders', 'Missing or unsubmitted timesheet items.', true, true, true),
  ('jsa_acknowledgement', 'JSA acknowledgement required', 'Employees or site crew need to acknowledge a JSA or toolbox talk.', true, true, true),
  ('schedule_update', 'Schedule updates', 'Schedule events assigned to employees.', true, true, true),
  ('certificate_expiring', 'Certificate expiring', 'Certificate expiry notices.', true, true, true),
  ('inspection_issue', 'Inspection or equipment issue', 'Inspection defects, equipment expiry, or maintenance attention.', true, true, true),
  ('vacation_request', 'Vacation requests', 'Vacation requests waiting for review.', false, true, true),
  ('admin_account_pending', 'Pending accounts', 'Accounts waiting for admin approval.', false, false, true)
on conflict (notification_type) do update
set
  label = excluded.label,
  description = excluded.description,
  updated_at = now();
