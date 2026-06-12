do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'wo_confirmation_status'
  ) then
    create type public.wo_confirmation_status as enum (
      'no_wo_required',
      'wo_required',
      'awaiting_wo_confirmation',
      'confirmed',
      'denied_needs_correction',
      'admin_overridden'
    );
  end if;
end $$;

alter table public.timesheet_entries
  add column if not exists wo_id uuid references public.work_orders(id) on delete set null,
  add column if not exists wo_number text,
  add column if not exists wo_confirmation_status public.wo_confirmation_status not null default 'no_wo_required',
  add column if not exists wo_locked boolean not null default false,
  add column if not exists wo_denial_reason text,
  add column if not exists wo_confirmed_by uuid references auth.users(id) on delete set null,
  add column if not exists wo_confirmed_at timestamptz,
  add column if not exists wo_denied_by uuid references auth.users(id) on delete set null,
  add column if not exists wo_denied_at timestamptz,
  add column if not exists wo_admin_override_reason text;

alter table public.work_order_labour
  add column if not exists confirmation_status public.wo_confirmation_status not null default 'wo_required',
  add column if not exists confirmed_by uuid references auth.users(id) on delete set null,
  add column if not exists confirmed_at timestamptz,
  add column if not exists denied_by uuid references auth.users(id) on delete set null,
  add column if not exists denied_at timestamptz,
  add column if not exists denial_reason text,
  add column if not exists locked boolean not null default false;

create table if not exists public.work_order_labour_timesheet_links (
  id uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references public.work_orders(id) on delete cascade,
  work_order_labour_id uuid not null references public.work_order_labour(id) on delete cascade,
  timesheet_entry_id uuid not null references public.timesheet_entries(id) on delete cascade,
  employee_key text,
  employee_display_name text,
  job_number text,
  job_name text,
  work_date date,
  submitted_hours numeric,
  status public.wo_confirmation_status not null default 'awaiting_wo_confirmation',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (work_order_labour_id, timesheet_entry_id)
);

create index if not exists timesheet_entries_wo_status_idx on public.timesheet_entries (wo_confirmation_status);
create index if not exists timesheet_entries_wo_id_idx on public.timesheet_entries (wo_id);
create index if not exists work_order_labour_confirmation_status_idx on public.work_order_labour (confirmation_status);
create index if not exists wo_labour_links_work_order_idx on public.work_order_labour_timesheet_links (work_order_id);
create index if not exists wo_labour_links_labour_idx on public.work_order_labour_timesheet_links (work_order_labour_id);
create index if not exists wo_labour_links_timesheet_idx on public.work_order_labour_timesheet_links (timesheet_entry_id);
create index if not exists wo_labour_links_status_idx on public.work_order_labour_timesheet_links (status);

update public.work_order_labour
set confirmation_status = case
  when confirmation_status in ('confirmed', 'denied_needs_correction', 'admin_overridden') then confirmation_status
  when complete is true then 'awaiting_wo_confirmation'::public.wo_confirmation_status
  else 'wo_required'::public.wo_confirmation_status
end;

update public.work_order_labour wol
set complete = false,
    updated_at = now()
from public.work_orders wo
where wol.work_order_id = wo.id
  and coalesce(wo.status, '') <> 'submitted'
  and coalesce(wo.locked, false) is false
  and wol.confirmation_status in ('wo_required', 'awaiting_wo_confirmation')
  and wol.complete is true;

update public.work_orders
set labour_complete = false,
    updated_at = now()
where coalesce(status, '') <> 'submitted'
  and coalesce(locked, false) is false
  and labour_complete is true;

create or replace function public.set_wo_labour_timesheet_links_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists wo_labour_timesheet_links_updated_at on public.work_order_labour_timesheet_links;
create trigger wo_labour_timesheet_links_updated_at
before update on public.work_order_labour_timesheet_links
for each row
execute function public.set_wo_labour_timesheet_links_updated_at();

alter table public.work_order_labour_timesheet_links enable row level security;

grant select, insert, update, delete on public.work_order_labour_timesheet_links to authenticated;

drop policy if exists "Authenticated users can manage WO labour timesheet links" on public.work_order_labour_timesheet_links;
create policy "Authenticated users can manage WO labour timesheet links"
on public.work_order_labour_timesheet_links
for all
to authenticated
using (true)
with check (true);
