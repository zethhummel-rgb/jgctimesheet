create table if not exists public.schedule_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null default 'work',
  event_date date not null,
  start_time time,
  end_time time,
  job_id uuid,
  title text,
  job_name text not null,
  job_number text,
  equipment_id uuid,
  maintenance_reason text,
  location text,
  notes text,
  employee_names jsonb not null default '[]'::jsonb,
  employee_keys jsonb not null default '[]'::jsonb,
  employee_emails jsonb not null default '[]'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_by_name text,
  one_day_reminder_sent_at timestamptz,
  two_hour_reminder_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.schedule_events
  add column if not exists event_type text not null default 'work';

alter table public.schedule_events
  add column if not exists title text;

alter table public.schedule_events
  add column if not exists equipment_id uuid;

alter table public.schedule_events
  add column if not exists maintenance_reason text;

alter table public.schedule_events
  add column if not exists one_day_reminder_sent_at timestamptz;

alter table public.schedule_events
  add column if not exists two_hour_reminder_sent_at timestamptz;

create index if not exists schedule_events_event_date_idx
  on public.schedule_events (event_date);

create or replace function public.set_schedule_events_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists schedule_events_updated_at on public.schedule_events;
create trigger schedule_events_updated_at
before update on public.schedule_events
for each row
execute function public.set_schedule_events_updated_at();

alter table public.schedule_events enable row level security;

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.schedule_events to authenticated;

drop policy if exists "Approved users can read schedule events" on public.schedule_events;
create policy "Approved users can read schedule events"
on public.schedule_events
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.account_status = 'approved'
  )
);

drop policy if exists "Admins can manage schedule events" on public.schedule_events;
create policy "Admins can manage schedule events"
on public.schedule_events
for all
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.account_status = 'approved'
      and (
        p.role = 'admin'
        or lower(p.email) in ('zeth@johngordonconstruction.com', 'jeff@johngordonconstruction.com')
      )
  )
)
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.account_status = 'approved'
      and (
        p.role = 'admin'
        or lower(p.email) in ('zeth@johngordonconstruction.com', 'jeff@johngordonconstruction.com')
      )
  )
);

drop policy if exists "Approved users can create schedule events" on public.schedule_events;
create policy "Approved users can create schedule events"
on public.schedule_events
for insert
to authenticated
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.account_status = 'approved'
  )
);

drop policy if exists "Approved users can update schedule events" on public.schedule_events;
create policy "Approved users can update schedule events"
on public.schedule_events
for update
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.account_status = 'approved'
  )
)
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.account_status = 'approved'
  )
);

drop policy if exists "Approved users can delete own schedule events" on public.schedule_events;
create policy "Approved users can delete own schedule events"
on public.schedule_events
for delete
to authenticated
using (
  created_by = auth.uid()
  and exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.account_status = 'approved'
  )
);
