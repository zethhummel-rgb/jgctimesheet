-- Admin-created JSA library items. Built-in presets stay in jsa-presets.js.
-- Any signed-in user can read active items (they appear in every JSA's library search);
-- only approved admins can create, edit, archive or restore, through the functions below.
-- JSAs store copies of the text, so changing an item never alters existing JSAs.

create table public.jsa_library_items (
  id uuid primary key default gen_random_uuid(),
  category text not null check (length(trim(category)) between 1 and 80),
  task text not null check (length(trim(task)) between 1 and 150),
  hazards text[] not null check (cardinality(hazards) between 1 and 30),
  controls text[] not null check (cardinality(controls) between 1 and 40),
  revision integer not null default 1 check (revision > 0),
  archived_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_by_name text not null default '',
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- No two active items with the same task name (case and spacing ignored).
create unique index jsa_library_items_active_task_idx on public.jsa_library_items (lower(regexp_replace(trim(task), '\s+', ' ', 'g'))) where archived_at is null;
create index jsa_library_items_created_by_idx on public.jsa_library_items(created_by);
create index jsa_library_items_updated_by_idx on public.jsa_library_items(updated_by);

alter table public.jsa_library_items enable row level security;
revoke all on public.jsa_library_items from public, anon, authenticated;
grant select on public.jsa_library_items to authenticated;
grant all on public.jsa_library_items to service_role;

create policy "Signed-in users read active JSA library items; admins read all" on public.jsa_library_items
  for select to authenticated
  using (archived_at is null or (select public.is_admin()));

create function private.jgc_save_jsa_library_item(p_id uuid, p_revision integer, p_category text, p_task text, p_hazards text[], p_controls text[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare item public.jsa_library_items; author public.profiles; v_hazards text[]; v_controls text[];
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Admin access required' using errcode = '42501'; end if;
  if p_id is null then raise exception 'Invalid library item'; end if;
  if coalesce(length(trim(p_category)), 0) not between 1 and 80 then raise exception 'Choose a category'; end if;
  if coalesce(length(trim(p_task)), 0) not between 1 and 150 then raise exception 'Enter the task name (150 characters or fewer)'; end if;
  select coalesce(array_agg(trim(h)), '{}') into v_hazards from unnest(coalesce(p_hazards, '{}')) h where length(trim(h)) > 0;
  select coalesce(array_agg(trim(c)), '{}') into v_controls from unnest(coalesce(p_controls, '{}')) c where length(trim(c)) > 0;
  if cardinality(v_hazards) not between 1 and 30 then raise exception 'Enter between 1 and 30 hazards'; end if;
  if cardinality(v_controls) not between 1 and 40 then raise exception 'Enter between 1 and 40 controls / PPE'; end if;
  if exists (select 1 from unnest(v_hazards || v_controls) v where length(v) > 500) then raise exception 'Keep each hazard and control under 500 characters'; end if;
  select * into author from public.profiles where id = auth.uid();
  perform pg_advisory_xact_lock(hashtextextended(p_id::text, 0));
  select * into item from public.jsa_library_items where id = p_id for update;
  if not found then
    if p_revision is distinct from 0 then raise exception 'Library item not found'; end if;
    insert into public.jsa_library_items(id, category, task, hazards, controls, created_by, created_by_name, updated_by)
    values (p_id, trim(p_category), trim(p_task), v_hazards, v_controls, auth.uid(), coalesce(nullif(author.display_name, ''), author.email, ''), auth.uid())
    returning * into item;
    return to_jsonb(item);
  end if;
  -- Retry of a save whose response was lost.
  if item.category = trim(p_category) and item.task = trim(p_task) and item.hazards = v_hazards and item.controls = v_controls then return to_jsonb(item); end if;
  if item.revision is distinct from p_revision then raise exception 'This library item changed elsewhere. Reopen it before saving.' using errcode = '40001'; end if;
  update public.jsa_library_items set category = trim(p_category), task = trim(p_task), hazards = v_hazards, controls = v_controls,
    revision = revision + 1, updated_by = auth.uid(), updated_at = now() where id = p_id returning * into item;
  return to_jsonb(item);
exception when unique_violation then
  raise exception 'An active library item already has this task name' using errcode = '23505';
end $$;

create function private.jgc_archive_jsa_library_item(p_id uuid, p_archived boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare item public.jsa_library_items;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Admin access required' using errcode = '42501'; end if;
  update public.jsa_library_items set archived_at = case when p_archived then coalesce(archived_at, now()) end,
    revision = revision + 1, updated_by = auth.uid(), updated_at = now() where id = p_id returning * into item;
  if not found then raise exception 'Library item not found'; end if;
  return to_jsonb(item);
exception when unique_violation then
  raise exception 'An active library item already has this task name. Rename one before restoring.' using errcode = '23505';
end $$;

revoke all on function private.jgc_save_jsa_library_item(uuid, integer, text, text, text[], text[]),
  private.jgc_archive_jsa_library_item(uuid, boolean) from public, anon;
grant execute on function private.jgc_save_jsa_library_item(uuid, integer, text, text, text[], text[]),
  private.jgc_archive_jsa_library_item(uuid, boolean) to authenticated;

create function public.save_jsa_library_item(p_id uuid, p_revision integer, p_category text, p_task text, p_hazards text[], p_controls text[])
returns jsonb language sql security invoker set search_path = '' as $$ select private.jgc_save_jsa_library_item(p_id, p_revision, p_category, p_task, p_hazards, p_controls) $$;
create function public.archive_jsa_library_item(p_id uuid, p_archived boolean)
returns jsonb language sql security invoker set search_path = '' as $$ select private.jgc_archive_jsa_library_item(p_id, p_archived) $$;

revoke all on function public.save_jsa_library_item(uuid, integer, text, text, text[], text[]),
  public.archive_jsa_library_item(uuid, boolean) from public, anon;
grant execute on function public.save_jsa_library_item(uuid, integer, text, text, text[], text[]),
  public.archive_jsa_library_item(uuid, boolean) to authenticated;
