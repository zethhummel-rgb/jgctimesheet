-- Add Accounting to the employee access grid and enforce that setting at the
-- database layer. Existing approved admins start enabled so this migration does
-- not interrupt the current workflow; admins can then remove access explicitly.

alter table public.employee_feature_access
  drop constraint if exists employee_feature_access_feature_key_check;

alter table public.employee_feature_access
  add constraint employee_feature_access_feature_key_check
  check (
    feature_key in (
      'work_orders',
      'schedule',
      'jsa',
      'toolbox_talks',
      'job_notes',
      'tasks',
      'accounting'
    )
  );

insert into public.employee_feature_access (worker_id, feature_key, enabled)
select
  worker.id,
  'accounting',
  coalesce(profile.role = 'admin' and profile.account_status = 'approved', false)
from public.work_order_labour_workers worker
left join public.profiles profile on profile.id = worker.profile_id
on conflict (worker_id, feature_key) do nothing;

create or replace function private.jgc_seed_employee_feature_access()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_accounting_enabled boolean := false;
begin
  select exists (
    select 1
    from public.profiles profile
    where profile.id = new.profile_id
      and profile.role = 'admin'
      and profile.account_status = 'approved'
  )
  into v_accounting_enabled;

  insert into public.employee_feature_access (worker_id, feature_key, enabled)
  values
    (new.id, 'work_orders', true),
    (new.id, 'schedule', true),
    (new.id, 'jsa', true),
    (new.id, 'toolbox_talks', true),
    (new.id, 'job_notes', true),
    (new.id, 'tasks', true),
    (new.id, 'accounting', v_accounting_enabled)
  on conflict (worker_id, feature_key) do nothing;

  return new;
end;
$$;

revoke all on function private.jgc_seed_employee_feature_access() from public, anon, authenticated;

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
    join public.work_order_labour_workers worker
      on worker.profile_id = profile.id
    join public.employee_feature_access feature_access
      on feature_access.worker_id = worker.id
     and feature_access.feature_key = 'accounting'
     and feature_access.enabled = true
    where profile.id = (select auth.uid())
      and profile.role = 'admin'
      and profile.account_status = 'approved'
  );
$$;

revoke all on function private.jgc_has_accounting_access() from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.jgc_has_accounting_access() to authenticated;

create or replace function private.jgc_preserve_accounting_admin_access()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_removal boolean := false;
  v_other_admins integer := 0;
begin
  if old.feature_key <> 'accounting' or old.enabled = false then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    v_is_removal := true;
  else
    v_is_removal := new.enabled = false;
  end if;

  if not v_is_removal then
    return new;
  end if;

  select count(*)
  into v_other_admins
  from public.employee_feature_access feature_access
  join public.work_order_labour_workers worker
    on worker.id = feature_access.worker_id
  join public.profiles profile
    on profile.id = worker.profile_id
  where feature_access.feature_key = 'accounting'
    and feature_access.enabled = true
    and feature_access.worker_id <> old.worker_id
    and profile.role = 'admin'
    and profile.account_status = 'approved';

  if v_other_admins = 0 then
    raise exception 'At least one approved administrator must retain Accounting access.';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function private.jgc_preserve_accounting_admin_access() from public, anon, authenticated;

drop trigger if exists employee_feature_access_preserve_accounting_admin
  on public.employee_feature_access;
create trigger employee_feature_access_preserve_accounting_admin
before update of enabled or delete on public.employee_feature_access
for each row
execute function private.jgc_preserve_accounting_admin_access();

drop policy if exists employee_feature_access_admin_insert
  on public.employee_feature_access;
create policy employee_feature_access_admin_insert
  on public.employee_feature_access
  for insert
  to authenticated
  with check (
    (select public.is_admin())
    and (
      feature_key <> 'accounting'
      or (select private.jgc_has_accounting_access())
    )
  );

drop policy if exists employee_feature_access_admin_update
  on public.employee_feature_access;
create policy employee_feature_access_admin_update
  on public.employee_feature_access
  for update
  to authenticated
  using (
    (select public.is_admin())
    and (
      feature_key <> 'accounting'
      or (select private.jgc_has_accounting_access())
    )
  )
  with check (
    (select public.is_admin())
    and (
      feature_key <> 'accounting'
      or (select private.jgc_has_accounting_access())
    )
  );

drop policy if exists employee_feature_access_admin_delete
  on public.employee_feature_access;
create policy employee_feature_access_admin_delete
  on public.employee_feature_access
  for delete
  to authenticated
  using (
    (select public.is_admin())
    and (
      feature_key <> 'accounting'
      or (select private.jgc_has_accounting_access())
    )
  );

drop policy if exists "Approved admins read accounting employee settings"
  on public.accounting_employee_settings;
create policy "Approved admins read accounting employee settings"
on public.accounting_employee_settings for select to authenticated
using ((select private.jgc_has_accounting_access()));

drop policy if exists "Approved admins add accounting employee settings"
  on public.accounting_employee_settings;
create policy "Approved admins add accounting employee settings"
on public.accounting_employee_settings for insert to authenticated
with check ((select private.jgc_has_accounting_access()));

drop policy if exists "Approved admins update accounting employee settings"
  on public.accounting_employee_settings;
create policy "Approved admins update accounting employee settings"
on public.accounting_employee_settings for update to authenticated
using ((select private.jgc_has_accounting_access()))
with check ((select private.jgc_has_accounting_access()));

drop policy if exists "Approved admins read accounting rates"
  on public.accounting_employee_rates;
create policy "Approved admins read accounting rates"
on public.accounting_employee_rates for select to authenticated
using ((select private.jgc_has_accounting_access()));

drop policy if exists "Approved admins add accounting rates"
  on public.accounting_employee_rates;
create policy "Approved admins add accounting rates"
on public.accounting_employee_rates for insert to authenticated
with check (
  (select private.jgc_has_accounting_access())
  and created_by = (select auth.uid())
);

drop policy if exists "Approved admins read accounting pay periods"
  on public.accounting_pay_periods;
create policy "Approved admins read accounting pay periods"
on public.accounting_pay_periods for select to authenticated
using ((select private.jgc_has_accounting_access()));

drop policy if exists "Approved admins add accounting pay periods"
  on public.accounting_pay_periods;
create policy "Approved admins add accounting pay periods"
on public.accounting_pay_periods for insert to authenticated
with check (
  (select private.jgc_has_accounting_access())
  and created_by = (select auth.uid())
);

drop policy if exists "Approved admins lock draft accounting pay periods"
  on public.accounting_pay_periods;
create policy "Approved admins lock draft accounting pay periods"
on public.accounting_pay_periods for update to authenticated
using ((select private.jgc_has_accounting_access()) and status = 'draft')
with check (
  (select private.jgc_has_accounting_access())
  and updated_by = (select auth.uid())
  and status in ('draft', 'locked')
);

drop policy if exists "Approved admins read accounting period inputs"
  on public.accounting_period_employee_inputs;
create policy "Approved admins read accounting period inputs"
on public.accounting_period_employee_inputs for select to authenticated
using ((select private.jgc_has_accounting_access()));

drop policy if exists "Approved admins add draft accounting period inputs"
  on public.accounting_period_employee_inputs;
create policy "Approved admins add draft accounting period inputs"
on public.accounting_period_employee_inputs for insert to authenticated
with check (
  (select private.jgc_has_accounting_access())
  and updated_by = (select auth.uid())
  and exists (
    select 1 from public.accounting_pay_periods period
    where period.id = pay_period_id and period.status = 'draft'
  )
);

drop policy if exists "Approved admins update draft accounting period inputs"
  on public.accounting_period_employee_inputs;
create policy "Approved admins update draft accounting period inputs"
on public.accounting_period_employee_inputs for update to authenticated
using (
  (select private.jgc_has_accounting_access())
  and exists (
    select 1 from public.accounting_pay_periods period
    where period.id = pay_period_id and period.status = 'draft'
  )
)
with check (
  (select private.jgc_has_accounting_access())
  and updated_by = (select auth.uid())
  and exists (
    select 1 from public.accounting_pay_periods period
    where period.id = pay_period_id and period.status = 'draft'
  )
);

drop policy if exists "Approved admins read captured accounting submissions"
  on public.accounting_timesheet_submissions;
create policy "Approved admins read captured accounting submissions"
on public.accounting_timesheet_submissions for select to authenticated
using ((select private.jgc_has_accounting_access()));

drop policy if exists "Approved admins read captured accounting entries"
  on public.accounting_time_entries;
create policy "Approved admins read captured accounting entries"
on public.accounting_time_entries for select to authenticated
using ((select private.jgc_has_accounting_access()));

drop policy if exists "Approved admins match accounting entries to jobs"
  on public.accounting_time_entries;
create policy "Approved admins match accounting entries to jobs"
on public.accounting_time_entries for update to authenticated
using (
  (select private.jgc_has_accounting_access())
  and not exists (
    select 1
    from public.accounting_pay_periods period
    where period.status = 'locked'
      and accounting_time_entries.work_date between period.week_one_start and period.week_two_end
  )
)
with check (
  (select private.jgc_has_accounting_access())
  and not exists (
    select 1
    from public.accounting_pay_periods period
    where period.status = 'locked'
      and accounting_time_entries.work_date between period.week_one_start and period.week_two_end
  )
  and job_match_status in ('manual', 'unmatched', 'not_applicable')
  and (
    (job_match_status = 'manual' and job_id is not null and job_matched_by = (select auth.uid()) and job_matched_at is not null)
    or (job_match_status = 'not_applicable' and job_id is null and job_matched_by = (select auth.uid()) and job_matched_at is not null)
    or (job_match_status = 'unmatched' and job_id is null)
  )
);

drop policy if exists "Approved admins read accounting workbook templates"
  on public.accounting_workbook_templates;
create policy "Approved admins read accounting workbook templates"
on public.accounting_workbook_templates for select to authenticated
using ((select private.jgc_has_accounting_access()));

drop policy if exists "Approved admins add accounting workbook templates"
  on public.accounting_workbook_templates;
create policy "Approved admins add accounting workbook templates"
on public.accounting_workbook_templates for insert to authenticated
with check (
  (select private.jgc_has_accounting_access())
  and uploaded_by = (select auth.uid())
);

drop policy if exists "Approved admins update accounting workbook templates"
  on public.accounting_workbook_templates;
create policy "Approved admins update accounting workbook templates"
on public.accounting_workbook_templates for update to authenticated
using ((select private.jgc_has_accounting_access()))
with check (
  (select private.jgc_has_accounting_access())
  and uploaded_by = (select auth.uid())
);

drop policy if exists "Approved admins read accounting exports"
  on public.accounting_exports;
create policy "Approved admins read accounting exports"
on public.accounting_exports for select to authenticated
using ((select private.jgc_has_accounting_access()));

drop policy if exists "Approved admins add accounting exports"
  on public.accounting_exports;
create policy "Approved admins add accounting exports"
on public.accounting_exports for insert to authenticated
with check (
  (select private.jgc_has_accounting_access())
  and exported_by = (select auth.uid())
);

drop policy if exists "Approved admins read accounting audit log"
  on public.accounting_audit_log;
create policy "Approved admins read accounting audit log"
on public.accounting_audit_log for select to authenticated
using ((select private.jgc_has_accounting_access()));
