-- Keep the employee selector directory synchronized with portal account status.
-- Existing directory-only employees remain independently managed.

-- Accounts that were intentionally hidden before this migration keep all page
-- permissions disabled when the account lifecycle becomes the source of truth.
update public.employee_feature_access as access
set enabled = false,
    updated_at = now()
from public.work_order_labour_workers as worker
join public.profiles as profile
  on profile.id = worker.profile_id
where access.worker_id = worker.id
  and profile.account_status = 'approved'
  and worker.approved = false
  and access.enabled = true;

create or replace function private.jgc_sync_worker_from_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  directory_worker_id uuid;
  directory_profile_id uuid;
begin
  if coalesce(btrim(new.display_name), '') = ''
     or coalesce(btrim(new.worker_key), '') = '' then
    return new;
  end if;

  select worker.id, worker.profile_id
    into directory_worker_id, directory_profile_id
  from public.work_order_labour_workers as worker
  where worker.profile_id = new.id
     or worker.worker_key = new.worker_key
  order by (worker.profile_id = new.id) desc
  limit 1
  for update;

  if directory_worker_id is null then
    insert into public.work_order_labour_workers (
      profile_id,
      display_name,
      worker_key,
      approved,
      updated_at
    )
    values (
      new.id,
      btrim(new.display_name),
      btrim(new.worker_key),
      (new.account_status = 'approved'),
      now()
    );
  else
    if directory_profile_id is not null and directory_profile_id <> new.id then
      raise exception 'Employee directory key is already linked to another account.';
    end if;

    update public.work_order_labour_workers
    set profile_id = new.id,
        display_name = btrim(new.display_name),
        worker_key = btrim(new.worker_key),
        approved = (new.account_status = 'approved'),
        updated_at = now()
    where id = directory_worker_id;
  end if;

  return new;
end;
$$;

revoke all on function private.jgc_sync_worker_from_profile() from public;
revoke all on function private.jgc_sync_worker_from_profile() from anon;
revoke all on function private.jgc_sync_worker_from_profile() from authenticated;

drop trigger if exists sync_work_order_labour_worker_from_profile_trigger
  on public.profiles;

create trigger sync_work_order_labour_worker_from_profile_trigger
after insert or update of account_status, display_name, worker_key
on public.profiles
for each row
execute function private.jgc_sync_worker_from_profile();

drop function if exists public.sync_work_order_labour_worker_from_profile();

-- Backfill every existing account through the new lifecycle trigger.
update public.profiles
set account_status = account_status;
