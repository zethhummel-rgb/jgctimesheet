-- Work Order labour must be tied to a portal account so the selected employee
-- can submit timesheet hours. Manual directory names remain available to the
-- other employee selectors.

update public.employee_feature_access access
set enabled = false,
    updated_at = now()
from public.work_order_labour_workers worker
where access.worker_id = worker.id
  and access.feature_key = 'work_orders'
  and worker.profile_id is null
  and access.enabled = true;

create or replace function private.jgc_seed_employee_feature_access()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.employee_feature_access (worker_id, feature_key, enabled)
  values
    (new.id, 'work_orders', new.profile_id is not null),
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

create or replace function private.jgc_enforce_employee_feature_eligibility()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.feature_key = 'work_orders'
     and new.enabled = true
     and exists (
       select 1
       from public.work_order_labour_workers worker
       where worker.id = new.worker_id
         and worker.profile_id is null
     ) then
    new.enabled := false;
  end if;

  return new;
end;
$$;

revoke all on function private.jgc_enforce_employee_feature_eligibility() from public;

drop trigger if exists employee_feature_access_enforce_eligibility
  on public.employee_feature_access;
create trigger employee_feature_access_enforce_eligibility
before insert or update of worker_id, feature_key, enabled
on public.employee_feature_access
for each row
execute function private.jgc_enforce_employee_feature_eligibility();
