create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  status text not null default 'open' check (status in ('open', 'in_progress', 'complete', 'archived')),
  priority text check (priority is null or priority in ('low', 'medium', 'high', 'urgent')),
  due_date date,
  assigned_to uuid references public.profiles(id) on delete set null,
  assigned_to_name text,
  assigned_to_ids uuid[] not null default '{}'::uuid[],
  assigned_to_names text[] not null default '{}'::text[],
  created_by uuid references auth.users(id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  completed_by uuid references auth.users(id) on delete set null,
  completed_by_name text,
  job_number text,
  job_name text,
  category text check (category is null or category in ('portal_fix', 'field_work', 'office', 'safety', 'equipment', 'job_follow_up', 'other'))
);

alter table public.tasks add column if not exists description text;
alter table public.tasks add column if not exists status text not null default 'open';
alter table public.tasks add column if not exists priority text;
alter table public.tasks add column if not exists due_date date;
alter table public.tasks add column if not exists assigned_to uuid references public.profiles(id) on delete set null;
alter table public.tasks add column if not exists assigned_to_name text;
alter table public.tasks add column if not exists assigned_to_ids uuid[] not null default '{}'::uuid[];
alter table public.tasks add column if not exists assigned_to_names text[] not null default '{}'::text[];
alter table public.tasks add column if not exists created_by uuid references auth.users(id) on delete set null;
alter table public.tasks add column if not exists created_by_name text;
alter table public.tasks add column if not exists completed_at timestamptz;
alter table public.tasks add column if not exists completed_by uuid references auth.users(id) on delete set null;
alter table public.tasks add column if not exists completed_by_name text;
alter table public.tasks add column if not exists job_number text;
alter table public.tasks add column if not exists job_name text;
alter table public.tasks add column if not exists category text;

create index if not exists tasks_status_idx on public.tasks (status);
create index if not exists tasks_due_date_idx on public.tasks (due_date);
create index if not exists tasks_assigned_to_idx on public.tasks (assigned_to);
create index if not exists tasks_assigned_to_ids_gin_idx on public.tasks using gin (assigned_to_ids);
create index if not exists tasks_job_number_idx on public.tasks (job_number);

update public.tasks
set assigned_to_ids = array[assigned_to]
where assigned_to is not null
  and coalesce(array_length(assigned_to_ids, 1), 0) = 0;

update public.tasks
set assigned_to_names = array[assigned_to_name]
where nullif(assigned_to_name, '') is not null
  and coalesce(array_length(assigned_to_names, 1), 0) = 0;

create or replace function public.set_tasks_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists tasks_updated_at on public.tasks;
create trigger tasks_updated_at
before update on public.tasks
for each row
execute function public.set_tasks_updated_at();

alter table public.tasks enable row level security;

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.tasks to authenticated;

drop policy if exists "Approved users can read tasks" on public.tasks;
create policy "Approved users can read tasks"
on public.tasks
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

drop policy if exists "Approved users can create tasks" on public.tasks;
create policy "Approved users can create tasks"
on public.tasks
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

drop policy if exists "Approved users can update tasks" on public.tasks;
create policy "Approved users can update tasks"
on public.tasks
for update
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
        or (
          public.tasks.assigned_to is null
          and coalesce(array_length(public.tasks.assigned_to_ids, 1), 0) = 0
        )
        or public.tasks.assigned_to = auth.uid()
        or auth.uid() = any(public.tasks.assigned_to_ids)
        or public.tasks.created_by = auth.uid()
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
        or (
          public.tasks.assigned_to is null
          and coalesce(array_length(public.tasks.assigned_to_ids, 1), 0) = 0
        )
        or public.tasks.assigned_to = auth.uid()
        or auth.uid() = any(public.tasks.assigned_to_ids)
        or public.tasks.created_by = auth.uid()
      )
  )
);

drop policy if exists "Admins can delete tasks" on public.tasks;
create policy "Admins can delete tasks"
on public.tasks
for delete
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
);
