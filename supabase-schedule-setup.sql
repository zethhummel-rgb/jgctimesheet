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
  location text,
  notes text,
  employee_names jsonb not null default '[]'::jsonb,
  employee_keys jsonb not null default '[]'::jsonb,
  employee_emails jsonb not null default '[]'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.schedule_events
  add column if not exists event_type text not null default 'work';

alter table public.schedule_events
  add column if not exists title text;

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
      and (
        p.role = 'admin'
        or lower(p.email) in ('zeth@johngordonconstruction.com', 'jeff@johngordonconstruction.com')
        or schedule_events.employee_keys ? coalesce(p.worker_key, '')
        or schedule_events.employee_names ? coalesce(p.display_name, '')
        or schedule_events.employee_emails ? coalesce(p.email, '')
      )
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
  created_by = auth.uid()
  and exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.account_status = 'approved'
  )
);
