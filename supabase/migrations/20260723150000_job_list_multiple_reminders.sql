begin;

create table if not exists public.job_list_reminders (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.job_lists(id) on delete cascade,
  reminder_at timestamptz not null,
  sent_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_by_name text not null default '',
  created_at timestamptz not null default now(),
  unique (list_id, reminder_at)
);

create index if not exists job_list_reminders_due_idx
  on public.job_list_reminders (reminder_at)
  where sent_at is null;

create index if not exists job_list_reminders_created_by_idx
  on public.job_list_reminders (created_by);

create or replace function private.jgc_prepare_job_list_reminder()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_user uuid := (select auth.uid());
  v_name text := coalesce(private.jgc_job_list_profile_name(v_user), 'Portal user');
begin
  if v_user is not null and new.reminder_at <= now() then
    raise exception 'Choose a reminder time in the future.';
  end if;

  if v_user is not null then
    new.created_by := v_user;
    new.created_by_name := v_name;
  else
    new.created_by_name := coalesce(nullif(trim(new.created_by_name), ''), v_name);
  end if;
  return new;
end;
$$;

revoke all on function private.jgc_prepare_job_list_reminder() from public;

drop trigger if exists job_list_reminders_prepare_write on public.job_list_reminders;
create trigger job_list_reminders_prepare_write
before insert on public.job_list_reminders
for each row
execute function private.jgc_prepare_job_list_reminder();

drop trigger if exists job_lists_sync_legacy_reminder on public.job_lists;

insert into public.job_list_reminders (
  list_id,
  reminder_at,
  sent_at,
  created_by,
  created_by_name,
  created_at
)
select
  l.id,
  l.reminder_at,
  l.reminder_sent_at,
  l.created_by,
  l.created_by_name,
  l.created_at
from public.job_lists l
where l.reminder_at is not null
  and l.reminder_at > now()
on conflict (list_id, reminder_at) do nothing;

update public.job_lists
set reminder_at = null,
    reminder_sent_at = null
where reminder_at is not null
   or reminder_sent_at is not null;

create or replace function private.jgc_sync_legacy_job_list_reminder()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_user uuid := coalesce((select auth.uid()), new.last_edited_by, new.created_by);
  v_name text := coalesce(
    private.jgc_job_list_profile_name(v_user),
    nullif(trim(new.last_edited_by_name), ''),
    nullif(trim(new.created_by_name), ''),
    'Portal user'
  );
begin
  if new.status <> 'open' or new.deleted_at is not null then
    delete from public.job_list_reminders
    where list_id = new.id
      and sent_at is null;
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.reminder_at is not null and new.reminder_at > now() then
      insert into public.job_list_reminders (
        list_id,
        reminder_at,
        created_by,
        created_by_name
      ) values (
        new.id,
        new.reminder_at,
        v_user,
        v_name
      )
      on conflict (list_id, reminder_at) do nothing;
    end if;
    return new;
  end if;

  if new.reminder_at is distinct from old.reminder_at then
    if old.reminder_at is not null then
      delete from public.job_list_reminders
      where list_id = new.id
        and reminder_at = old.reminder_at
        and sent_at is null;
    end if;

    if new.reminder_at is not null and new.reminder_at > now() then
      insert into public.job_list_reminders (
        list_id,
        reminder_at,
        created_by,
        created_by_name
      ) values (
        new.id,
        new.reminder_at,
        v_user,
        v_name
      )
      on conflict (list_id, reminder_at) do nothing;
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.jgc_sync_legacy_job_list_reminder() from public;

drop trigger if exists job_lists_sync_legacy_reminder on public.job_lists;
create trigger job_lists_sync_legacy_reminder
after insert or update on public.job_lists
for each row
execute function private.jgc_sync_legacy_job_list_reminder();

drop trigger if exists job_list_reminders_touch_list on public.job_list_reminders;
create trigger job_list_reminders_touch_list
after insert or delete on public.job_list_reminders
for each row
execute function private.jgc_touch_job_list();

create or replace function private.jgc_dispatch_due_job_list_reminders()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_entry record;
  v_recipient record;
  v_remaining integer;
  v_inserted integer := 0;
  v_setting public.notification_settings%rowtype;
begin
  select *
  into v_setting
  from public.notification_settings
  where notification_type = 'job_list_reminder'
  limit 1;

  for v_entry in
    select
      r.id as reminder_id,
      r.reminder_at,
      l.*
    from public.job_list_reminders r
    join public.job_lists l on l.id = r.list_id
    where l.status = 'open'
      and l.deleted_at is null
      and r.sent_at is null
      and r.reminder_at <= now()
    order by r.reminder_at
    for update of r skip locked
  loop
    select count(*)
    into v_remaining
    from public.job_list_items i
    where i.list_id = v_entry.id
      and i.completed = false;

    for v_recipient in
      select distinct
        p.id,
        p.email,
        p.display_name,
        p.worker_key,
        p.role
      from public.job_list_members m
      join public.profiles p on p.id = m.profile_id
      where m.list_id = v_entry.id
        and p.account_status = 'approved'
        and (
          v_setting.id is null
          or (p.role = 'admin' and v_setting.admin_enabled)
          or (p.role = 'supervisor' and v_setting.supervisor_enabled)
          or (p.role not in ('admin', 'supervisor') and v_setting.employee_enabled)
        )
    loop
      insert into public.notifications (
        notification_type,
        title,
        message,
        link_url,
        target_profile_id,
        target_worker_key,
        target_worker_email,
        target_role,
        source_table,
        source_id,
        dedupe_key,
        metadata,
        created_by,
        created_by_name,
        expires_at,
        updated_at
      ) values (
        'job_list_reminder',
        'Job note reminder: ' || v_entry.title,
        v_entry.job_number || ' - ' || v_entry.job_name || ' | '
          || v_remaining::text || case when v_remaining = 1 then ' item remaining' else ' items remaining' end,
        'job-lists.html?list=' || v_entry.id::text,
        v_recipient.id,
        v_recipient.worker_key,
        v_recipient.email,
        v_recipient.role,
        'job_list_reminders',
        v_entry.reminder_id::text,
        'job-list-reminder:' || v_entry.reminder_id::text || ':' || v_recipient.id::text,
        jsonb_build_object(
          'list_id', v_entry.id,
          'reminder_id', v_entry.reminder_id,
          'job_number', v_entry.job_number,
          'job_name', v_entry.job_name,
          'remaining_items', v_remaining,
          'reminder_at', v_entry.reminder_at
        ),
        v_entry.created_by,
        v_entry.created_by_name,
        now() + interval '7 days',
        now()
      )
      on conflict (dedupe_key) do nothing;

      if found then
        v_inserted := v_inserted + 1;
      end if;
    end loop;

    update public.job_list_reminders
    set sent_at = now()
    where id = v_entry.reminder_id;
  end loop;

  return v_inserted;
end;
$$;

revoke all on function private.jgc_dispatch_due_job_list_reminders() from public;

alter table public.job_list_reminders enable row level security;

revoke all on public.job_list_reminders from anon, authenticated;
grant select, insert, delete on public.job_list_reminders to authenticated;

drop policy if exists job_list_reminders_read_approved on public.job_list_reminders;
create policy job_list_reminders_read_approved
on public.job_list_reminders
for select
to authenticated
using (
  private.jgc_has_full_portal_access()
  and exists (
    select 1
    from public.job_lists l
    where l.id = job_list_reminders.list_id
      and (
        l.deleted_at is null
        or public.is_admin()
        or private.jgc_job_list_is_controller(l.id)
      )
  )
);

drop policy if exists job_list_reminders_create_controllers on public.job_list_reminders;
create policy job_list_reminders_create_controllers
on public.job_list_reminders
for insert
to authenticated
with check (
  private.jgc_has_full_portal_access()
  and created_by = (select auth.uid())
  and private.jgc_job_list_is_controller(list_id)
  and exists (
    select 1
    from public.job_lists l
    where l.id = job_list_reminders.list_id
      and l.status = 'open'
      and l.deleted_at is null
  )
);

drop policy if exists job_list_reminders_delete_controllers on public.job_list_reminders;
create policy job_list_reminders_delete_controllers
on public.job_list_reminders
for delete
to authenticated
using (
  private.jgc_has_full_portal_access()
  and private.jgc_job_list_is_controller(list_id)
);

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1
       from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'job_list_reminders'
     ) then
    alter publication supabase_realtime add table public.job_list_reminders;
  end if;
end
$$;

commit;
