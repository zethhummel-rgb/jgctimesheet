alter table public.schedule_events
  add column if not exists equipment_id uuid,
  add column if not exists maintenance_reason text;

create table if not exists public.equipment_maintenance_logs (
  id uuid primary key default gen_random_uuid(),
  equipment_id uuid,
  schedule_event_id uuid unique references public.schedule_events(id) on delete cascade,
  equipment_name text,
  maintenance_reason text not null,
  scheduled_date date,
  scheduled_time time,
  status text not null default 'scheduled',
  completed_at timestamptz,
  completed_by text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.equipment_maintenance_logs enable row level security;

grant select, insert, update, delete on public.equipment_maintenance_logs to authenticated;

drop policy if exists "Approved users can read equipment maintenance logs" on public.equipment_maintenance_logs;
create policy "Approved users can read equipment maintenance logs"
on public.equipment_maintenance_logs
for select
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.account_status = 'approved'
  )
);

drop policy if exists "Approved users can manage equipment maintenance logs" on public.equipment_maintenance_logs;
create policy "Approved users can manage equipment maintenance logs"
on public.equipment_maintenance_logs
for all
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.account_status = 'approved'
  )
)
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.account_status = 'approved'
  )
);
