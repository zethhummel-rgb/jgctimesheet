-- Keep the existing Work Order labour directory as the employee source of truth,
-- while allowing admins to choose which portal selectors each worker appears in.

create table if not exists public.employee_feature_access (
  worker_id uuid not null references public.work_order_labour_workers(id) on delete cascade,
  feature_key text not null check (
    feature_key in (
      'work_orders',
      'schedule',
      'jsa',
      'toolbox_talks',
      'job_notes',
      'tasks'
    )
  ),
  enabled boolean not null default true,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (worker_id, feature_key)
);

create index if not exists employee_feature_access_feature_enabled_idx
  on public.employee_feature_access(feature_key, enabled, worker_id);

create index if not exists employee_feature_access_updated_by_idx
  on public.employee_feature_access(updated_by);

alter table public.employee_feature_access enable row level security;

revoke all on table public.employee_feature_access from public;
revoke all on table public.employee_feature_access from anon;
revoke all on table public.employee_feature_access from authenticated;
grant select on table public.employee_feature_access to authenticated;
grant insert, update, delete on table public.employee_feature_access to authenticated;
grant all on table public.employee_feature_access to service_role;

drop policy if exists employee_feature_access_authenticated_read
  on public.employee_feature_access;
create policy employee_feature_access_authenticated_read
  on public.employee_feature_access
  for select
  to authenticated
  using (true);

drop policy if exists employee_feature_access_admin_insert
  on public.employee_feature_access;
create policy employee_feature_access_admin_insert
  on public.employee_feature_access
  for insert
  to authenticated
  with check (public.is_admin());

drop policy if exists employee_feature_access_admin_update
  on public.employee_feature_access;
create policy employee_feature_access_admin_update
  on public.employee_feature_access
  for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists employee_feature_access_admin_delete
  on public.employee_feature_access;
create policy employee_feature_access_admin_delete
  on public.employee_feature_access
  for delete
  to authenticated
  using (public.is_admin());

insert into public.employee_feature_access (worker_id, feature_key, enabled)
select worker.id, feature.feature_key, true
from public.work_order_labour_workers worker
cross join (
  values
    ('work_orders'),
    ('schedule'),
    ('jsa'),
    ('toolbox_talks'),
    ('job_notes'),
    ('tasks')
) as feature(feature_key)
on conflict (worker_id, feature_key) do nothing;

create or replace function private.jgc_seed_employee_feature_access()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.employee_feature_access (worker_id, feature_key, enabled)
  values
    (new.id, 'work_orders', true),
    (new.id, 'schedule', true),
    (new.id, 'jsa', true),
    (new.id, 'toolbox_talks', true),
    (new.id, 'job_notes', true),
    (new.id, 'tasks', true)
  on conflict (worker_id, feature_key) do nothing;

  return new;
end;
$$;

revoke all on function private.jgc_seed_employee_feature_access() from public;

drop trigger if exists work_order_labour_workers_seed_feature_access
  on public.work_order_labour_workers;
create trigger work_order_labour_workers_seed_feature_access
after insert on public.work_order_labour_workers
for each row
execute function private.jgc_seed_employee_feature_access();

create or replace function private.jgc_add_job_list_creator()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_worker public.work_order_labour_workers%rowtype;
begin
  select w.*
  into v_worker
  from public.work_order_labour_workers w
  where w.profile_id = new.created_by
    and w.approved = true
    and exists (
      select 1
      from public.employee_feature_access feature_access
      where feature_access.worker_id = w.id
        and feature_access.feature_key = 'job_notes'
        and feature_access.enabled = true
    )
  order by w.updated_at desc
  limit 1;

  if v_worker.profile_id is not null then
    insert into public.job_list_members
      (list_id, profile_id, display_name, worker_key, added_by)
    values
      (new.id, v_worker.profile_id, v_worker.display_name, v_worker.worker_key, new.created_by)
    on conflict (list_id, profile_id) do nothing;
  end if;

  return new;
end;
$$;

revoke all on function private.jgc_add_job_list_creator() from public;

create or replace function private.jgc_prepare_job_list_member()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_worker public.work_order_labour_workers%rowtype;
begin
  select w.*
  into v_worker
  from public.work_order_labour_workers w
  where w.profile_id = new.profile_id
    and w.approved = true
    and exists (
      select 1
      from public.employee_feature_access feature_access
      where feature_access.worker_id = w.id
        and feature_access.feature_key = 'job_notes'
        and feature_access.enabled = true
    )
  order by w.updated_at desc
  limit 1;

  if v_worker.profile_id is null then
    raise exception 'This employee is not approved for Job Notes.';
  end if;

  new.display_name := v_worker.display_name;
  new.worker_key := v_worker.worker_key;
  new.added_by := coalesce(new.added_by, (select auth.uid()));
  return new;
end;
$$;

revoke all on function private.jgc_prepare_job_list_member() from public;
