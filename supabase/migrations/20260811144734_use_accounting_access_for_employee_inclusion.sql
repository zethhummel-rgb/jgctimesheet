-- Repurpose the Accounting employee feature as the single payroll-inclusion
-- control. Accounting page authorization remains available to every approved
-- administrator and is enforced independently by RLS.

drop trigger if exists employee_feature_access_preserve_accounting_admin
  on public.employee_feature_access;
drop function if exists private.jgc_preserve_accounting_admin_access();

create or replace function private.jgc_has_accounting_access()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles profile
    where profile.id = (select auth.uid())
      and profile.role = 'admin'
      and profile.account_status = 'approved'
  );
$$;

revoke all on function private.jgc_has_accounting_access() from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.jgc_has_accounting_access() to authenticated;

-- Preserve the payroll choices already made on Employee Rates. These values
-- become the initial state of the Accounting column on Employee Page Access.
insert into public.employee_feature_access (worker_id, feature_key, enabled)
select
  worker.id,
  'accounting',
  coalesce(setting.include_in_payroll, false)
from public.work_order_labour_workers worker
left join public.accounting_employee_settings setting
  on setting.profile_id = worker.profile_id
on conflict (worker_id, feature_key) do update
set
  enabled = excluded.enabled,
  updated_at = now();

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
    (new.id, 'tasks', true),
    (new.id, 'accounting', false)
  on conflict (worker_id, feature_key) do nothing;

  return new;
end;
$$;

revoke all on function private.jgc_seed_employee_feature_access() from public, anon, authenticated;

drop policy if exists employee_feature_access_admin_insert
  on public.employee_feature_access;
create policy employee_feature_access_admin_insert
  on public.employee_feature_access
  for insert
  to authenticated
  with check ((select public.is_admin()));

drop policy if exists employee_feature_access_admin_update
  on public.employee_feature_access;
create policy employee_feature_access_admin_update
  on public.employee_feature_access
  for update
  to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

drop policy if exists employee_feature_access_admin_delete
  on public.employee_feature_access;
create policy employee_feature_access_admin_delete
  on public.employee_feature_access
  for delete
  to authenticated
  using ((select public.is_admin()));

comment on column public.employee_feature_access.feature_key is
  'Employee-directory destination. Accounting controls Employee Rates and spreadsheet inclusion; it does not grant Accounting page access.';
