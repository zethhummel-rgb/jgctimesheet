-- JGC Portal Job Notes module.
--
-- This creates shared job-linked material/check lists with:
-- - approved WO employees as collaborators;
-- - read/check access for every approved portal employee;
-- - full editing access for collaborators and admins;
-- - soft deletion with admin restore/permanent deletion;
-- - scheduled Bell/push reminders for collaborators only.

create table if not exists public.job_lists (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references public.jobs(id) on delete set null,
  job_number text not null,
  job_name text not null,
  title text not null,
  status text not null default 'open'
    check (status in ('open', 'completed')),
  reminder_at timestamptz,
  reminder_sent_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_by_name text not null default '',
  last_edited_by uuid references public.profiles(id) on delete set null,
  last_edited_by_name text not null default '',
  completed_at timestamptz,
  completed_by uuid references public.profiles(id) on delete set null,
  completed_by_name text not null default '',
  deleted_at timestamptz,
  deleted_by uuid references public.profiles(id) on delete set null,
  deleted_by_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.job_list_members (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.job_lists(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  display_name text not null default '',
  worker_key text not null default '',
  added_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (list_id, profile_id)
);

create table if not exists public.job_list_items (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.job_lists(id) on delete cascade,
  item_text text not null,
  quantity numeric check (quantity is null or quantity >= 0),
  position integer not null default 0,
  completed boolean not null default false,
  completed_at timestamptz,
  completed_by uuid references public.profiles(id) on delete set null,
  completed_by_name text not null default '',
  created_by uuid references public.profiles(id) on delete set null,
  created_by_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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

create table if not exists public.job_list_activity (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.job_lists(id) on delete cascade,
  item_id uuid references public.job_list_items(id) on delete set null,
  action text not null,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  actor_name text not null default '',
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists job_lists_job_idx
  on public.job_lists (job_number, updated_at desc);
create index if not exists job_lists_status_idx
  on public.job_lists (status, deleted_at, updated_at desc);
create index if not exists job_lists_reminder_idx
  on public.job_lists (reminder_at)
  where reminder_at is not null and reminder_sent_at is null and deleted_at is null;
create index if not exists job_list_members_profile_idx
  on public.job_list_members (profile_id, list_id);
create index if not exists job_list_items_list_idx
  on public.job_list_items (list_id, position, created_at);
create index if not exists job_list_reminders_due_idx
  on public.job_list_reminders (reminder_at)
  where sent_at is null;

create index if not exists job_list_reminders_created_by_idx
  on public.job_list_reminders (created_by);
create index if not exists job_list_activity_list_idx
  on public.job_list_activity (list_id, created_at desc);

create or replace function private.jgc_job_list_is_controller(p_list_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select public.is_admin()
    or exists (
      select 1
      from public.job_lists l
      where l.id = p_list_id
        and l.created_by = (select auth.uid())
    )
    or exists (
      select 1
      from public.job_list_members m
      where m.list_id = p_list_id
        and m.profile_id = (select auth.uid())
    );
$$;

revoke all on function private.jgc_job_list_is_controller(uuid) from public;
grant execute on function private.jgc_job_list_is_controller(uuid) to authenticated;

create or replace function private.jgc_job_list_profile_name(p_profile_id uuid)
returns text
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce(nullif(trim(p.display_name), ''), nullif(trim(p.email), ''), 'Portal user')
  from public.profiles p
  where p.id = p_profile_id;
$$;

revoke all on function private.jgc_job_list_profile_name(uuid) from public;

create or replace function private.jgc_prepare_job_list()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_user uuid := (select auth.uid());
  v_name text := coalesce(private.jgc_job_list_profile_name(v_user), 'Portal user');
begin
  new.title := trim(coalesce(new.title, ''));
  new.job_number := trim(coalesce(new.job_number, ''));
  new.job_name := trim(coalesce(new.job_name, ''));

  if new.title = '' then
    raise exception 'A list title is required.';
  end if;

  if new.job_number = '' or new.job_name = '' then
    raise exception 'A job is required.';
  end if;

  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, v_user);
    new.created_by_name := coalesce(nullif(trim(new.created_by_name), ''), v_name);
    new.last_edited_by := v_user;
    new.last_edited_by_name := v_name;
  else
    if new.id is distinct from old.id
       or new.created_by is distinct from old.created_by
       or new.created_at is distinct from old.created_at then
      raise exception 'List ownership cannot be changed.';
    end if;

    if old.deleted_at is not null and not public.is_admin() then
      raise exception 'Only an admin can restore or change a deleted list.';
    end if;

    if new.reminder_at is distinct from old.reminder_at then
      new.reminder_sent_at := null;
    elsif v_user is not null and not public.is_admin() then
      new.reminder_sent_at := old.reminder_sent_at;
    end if;

    if old.status is distinct from new.status then
      if new.status = 'completed' then
        new.completed_at := now();
        new.completed_by := v_user;
        new.completed_by_name := v_name;
        new.reminder_at := null;
        new.reminder_sent_at := null;
      else
        new.completed_at := null;
        new.completed_by := null;
        new.completed_by_name := '';
      end if;
    end if;

    if old.deleted_at is null and new.deleted_at is not null then
      new.deleted_at := now();
      new.deleted_by := v_user;
      new.deleted_by_name := v_name;
      new.reminder_at := null;
      new.reminder_sent_at := null;
    elsif old.deleted_at is not null and new.deleted_at is null then
      new.deleted_by := null;
      new.deleted_by_name := '';
    end if;

    if v_user is not null then
      new.last_edited_by := v_user;
      new.last_edited_by_name := v_name;
    else
      new.last_edited_by := old.last_edited_by;
      new.last_edited_by_name := old.last_edited_by_name;
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

revoke all on function private.jgc_prepare_job_list() from public;

drop trigger if exists job_lists_prepare_write on public.job_lists;
create trigger job_lists_prepare_write
before insert or update on public.job_lists
for each row
execute function private.jgc_prepare_job_list();

create or replace function private.jgc_add_job_list_creator()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_worker public.work_order_labour_workers%rowtype;
begin
  select *
  into v_worker
  from public.work_order_labour_workers w
  where w.profile_id = new.created_by
    and w.approved = true
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

drop trigger if exists job_lists_add_creator on public.job_lists;
create trigger job_lists_add_creator
after insert on public.job_lists
for each row
execute function private.jgc_add_job_list_creator();

create or replace function private.jgc_prepare_job_list_member()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_worker public.work_order_labour_workers%rowtype;
begin
  select *
  into v_worker
  from public.work_order_labour_workers w
  where w.profile_id = new.profile_id
    and w.approved = true
  order by w.updated_at desc
  limit 1;

  if v_worker.profile_id is null then
    raise exception 'Only approved Work Order employees can be added to a job note.';
  end if;

  new.display_name := v_worker.display_name;
  new.worker_key := v_worker.worker_key;
  new.added_by := coalesce(new.added_by, (select auth.uid()));
  return new;
end;
$$;

revoke all on function private.jgc_prepare_job_list_member() from public;

drop trigger if exists job_list_members_prepare_write on public.job_list_members;
create trigger job_list_members_prepare_write
before insert or update on public.job_list_members
for each row
execute function private.jgc_prepare_job_list_member();

create or replace function private.jgc_prepare_job_list_item()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_user uuid := (select auth.uid());
  v_name text := coalesce(private.jgc_job_list_profile_name(v_user), 'Portal user');
begin
  new.item_text := trim(coalesce(new.item_text, ''));
  if new.item_text = '' then
    raise exception 'An item description is required.';
  end if;

  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, v_user);
    new.created_by_name := coalesce(nullif(trim(new.created_by_name), ''), v_name);
  else
    if new.id is distinct from old.id
       or new.list_id is distinct from old.list_id
       or new.created_by is distinct from old.created_by
       or new.created_at is distinct from old.created_at then
      raise exception 'Item ownership cannot be changed.';
    end if;

    if new.completed is distinct from old.completed then
      if new.completed then
        new.completed_at := now();
        new.completed_by := v_user;
        new.completed_by_name := v_name;
      else
        new.completed_at := null;
        new.completed_by := null;
        new.completed_by_name := '';
      end if;
    elsif not public.is_admin() then
      new.completed_at := old.completed_at;
      new.completed_by := old.completed_by;
      new.completed_by_name := old.completed_by_name;
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

revoke all on function private.jgc_prepare_job_list_item() from public;

drop trigger if exists job_list_items_prepare_write on public.job_list_items;
create trigger job_list_items_prepare_write
before insert or update on public.job_list_items
for each row
execute function private.jgc_prepare_job_list_item();

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

create or replace function private.jgc_touch_job_list()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_list_id uuid := case when tg_op = 'DELETE' then old.list_id else new.list_id end;
begin
  update public.job_lists
  set updated_at = now()
  where id = v_list_id;
  return coalesce(new, old);
end;
$$;

revoke all on function private.jgc_touch_job_list() from public;

drop trigger if exists job_list_items_touch_list on public.job_list_items;
create trigger job_list_items_touch_list
after insert or update or delete on public.job_list_items
for each row
execute function private.jgc_touch_job_list();

drop trigger if exists job_list_members_touch_list on public.job_list_members;
create trigger job_list_members_touch_list
after insert or update or delete on public.job_list_members
for each row
execute function private.jgc_touch_job_list();

drop trigger if exists job_list_reminders_touch_list on public.job_list_reminders;
create trigger job_list_reminders_touch_list
after insert or delete on public.job_list_reminders
for each row
execute function private.jgc_touch_job_list();

create or replace function public.toggle_job_list_item(p_item_id uuid, p_completed boolean)
returns public.job_list_items
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_item public.job_list_items%rowtype;
  v_list public.job_lists%rowtype;
  v_name text;
begin
  if not private.jgc_has_full_portal_access() then
    raise exception 'Approved portal access is required.';
  end if;

  select *
  into v_item
  from public.job_list_items i
  where i.id = p_item_id
  for update;

  if v_item.id is not null then
    select *
    into v_list
    from public.job_lists l
    where l.id = v_item.list_id;
  end if;

  if v_item.id is null or v_list.id is null or v_list.deleted_at is not null then
    raise exception 'This note item is no longer available.';
  end if;

  if v_list.status <> 'open' then
    raise exception 'Reopen this completed list before changing its items.';
  end if;

  v_name := coalesce(private.jgc_job_list_profile_name((select auth.uid())), 'Portal user');

  update public.job_list_items
  set completed = coalesce(p_completed, false)
  where id = p_item_id
  returning * into v_item;

  insert into public.job_list_activity
    (list_id, item_id, action, actor_profile_id, actor_name, details)
  values
    (
      v_item.list_id,
      v_item.id,
      case when v_item.completed then 'item_completed' else 'item_reopened' end,
      (select auth.uid()),
      v_name,
      jsonb_build_object('item_text', v_item.item_text, 'completed', v_item.completed)
    );

  return v_item;
end;
$$;

revoke all on function public.toggle_job_list_item(uuid, boolean) from public;
grant execute on function public.toggle_job_list_item(uuid, boolean) to authenticated;

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

alter table public.job_lists enable row level security;
alter table public.job_list_members enable row level security;
alter table public.job_list_items enable row level security;
alter table public.job_list_reminders enable row level security;
alter table public.job_list_activity enable row level security;

revoke all on public.job_lists from anon, authenticated;
revoke all on public.job_list_members from anon, authenticated;
revoke all on public.job_list_items from anon, authenticated;
revoke all on public.job_list_reminders from anon, authenticated;
revoke all on public.job_list_activity from anon, authenticated;

grant select, insert, update, delete on public.job_lists to authenticated;
grant select, insert, update, delete on public.job_list_members to authenticated;
grant select, insert, update, delete on public.job_list_items to authenticated;
grant select, insert, delete on public.job_list_reminders to authenticated;
grant select, insert on public.job_list_activity to authenticated;

drop policy if exists job_lists_read_approved on public.job_lists;
create policy job_lists_read_approved
on public.job_lists
for select
to authenticated
using (
  private.jgc_has_full_portal_access()
  and (
    deleted_at is null
    or public.is_admin()
    or private.jgc_job_list_is_controller(id)
  )
);

drop policy if exists job_lists_create_approved on public.job_lists;
create policy job_lists_create_approved
on public.job_lists
for insert
to authenticated
with check (
  private.jgc_has_full_portal_access()
  and created_by = (select auth.uid())
);

drop policy if exists job_lists_update_controllers on public.job_lists;
create policy job_lists_update_controllers
on public.job_lists
for update
to authenticated
using (
  private.jgc_has_full_portal_access()
  and private.jgc_job_list_is_controller(id)
)
with check (
  private.jgc_has_full_portal_access()
  and private.jgc_job_list_is_controller(id)
);

drop policy if exists job_lists_delete_admin on public.job_lists;
create policy job_lists_delete_admin
on public.job_lists
for delete
to authenticated
using (
  private.jgc_has_full_portal_access()
  and public.is_admin()
);

drop policy if exists job_list_members_read_approved on public.job_list_members;
create policy job_list_members_read_approved
on public.job_list_members
for select
to authenticated
using (private.jgc_has_full_portal_access());

drop policy if exists job_list_members_create_controllers on public.job_list_members;
create policy job_list_members_create_controllers
on public.job_list_members
for insert
to authenticated
with check (
  private.jgc_has_full_portal_access()
  and private.jgc_job_list_is_controller(list_id)
);

drop policy if exists job_list_members_update_controllers on public.job_list_members;
create policy job_list_members_update_controllers
on public.job_list_members
for update
to authenticated
using (
  private.jgc_has_full_portal_access()
  and private.jgc_job_list_is_controller(list_id)
)
with check (
  private.jgc_has_full_portal_access()
  and private.jgc_job_list_is_controller(list_id)
);

drop policy if exists job_list_members_delete_controllers on public.job_list_members;
create policy job_list_members_delete_controllers
on public.job_list_members
for delete
to authenticated
using (
  private.jgc_has_full_portal_access()
  and private.jgc_job_list_is_controller(list_id)
);

drop policy if exists job_list_items_read_approved on public.job_list_items;
create policy job_list_items_read_approved
on public.job_list_items
for select
to authenticated
using (
  private.jgc_has_full_portal_access()
  and exists (
    select 1
    from public.job_lists l
    where l.id = job_list_items.list_id
      and (
        l.deleted_at is null
        or public.is_admin()
        or private.jgc_job_list_is_controller(l.id)
      )
  )
);

drop policy if exists job_list_items_create_controllers on public.job_list_items;
create policy job_list_items_create_controllers
on public.job_list_items
for insert
to authenticated
with check (
  private.jgc_has_full_portal_access()
  and private.jgc_job_list_is_controller(list_id)
);

drop policy if exists job_list_items_update_controllers on public.job_list_items;
create policy job_list_items_update_controllers
on public.job_list_items
for update
to authenticated
using (
  private.jgc_has_full_portal_access()
  and private.jgc_job_list_is_controller(list_id)
)
with check (
  private.jgc_has_full_portal_access()
  and private.jgc_job_list_is_controller(list_id)
);

drop policy if exists job_list_items_delete_controllers on public.job_list_items;
create policy job_list_items_delete_controllers
on public.job_list_items
for delete
to authenticated
using (
  private.jgc_has_full_portal_access()
  and private.jgc_job_list_is_controller(list_id)
);

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

drop policy if exists job_list_activity_read_approved on public.job_list_activity;
create policy job_list_activity_read_approved
on public.job_list_activity
for select
to authenticated
using (
  private.jgc_has_full_portal_access()
  and exists (
    select 1
    from public.job_lists l
    where l.id = job_list_activity.list_id
      and (
        l.deleted_at is null
        or public.is_admin()
        or private.jgc_job_list_is_controller(l.id)
      )
  )
);

drop policy if exists job_list_activity_create_approved on public.job_list_activity;
create policy job_list_activity_create_approved
on public.job_list_activity
for insert
to authenticated
with check (
  private.jgc_has_full_portal_access()
  and actor_profile_id = (select auth.uid())
);

insert into public.notification_settings (
  notification_type,
  label,
  description,
  employee_enabled,
  supervisor_enabled,
  admin_enabled
) values (
  'job_list_reminder',
  'Job Note Reminders',
  'Reminds tagged employees about a shared job note at the selected time.',
  true,
  true,
  true
)
on conflict (notification_type) do update
set
  label = excluded.label,
  description = excluded.description,
  updated_at = now();

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'job_lists'
    ) then
      alter publication supabase_realtime add table public.job_lists;
    end if;

    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'job_list_members'
    ) then
      alter publication supabase_realtime add table public.job_list_members;
    end if;

    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'job_list_items'
    ) then
      alter publication supabase_realtime add table public.job_list_items;
    end if;

    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'job_list_reminders'
    ) then
      alter publication supabase_realtime add table public.job_list_reminders;
    end if;
  end if;
end
$$;

do $$
declare
  v_job_id bigint;
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    select jobid
    into v_job_id
    from cron.job
    where jobname = 'jgc-job-list-reminders'
    limit 1;

    if v_job_id is not null then
      perform cron.unschedule(v_job_id);
    end if;

    perform cron.schedule(
      'jgc-job-list-reminders',
      '* * * * *',
      'select private.jgc_dispatch_due_job_list_reminders();'
    );
  end if;
end
$$;
