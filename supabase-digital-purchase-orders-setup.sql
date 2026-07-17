-- JGC Digital Purchase Orders
-- Apply once to the JGC Portal Supabase project.
-- Digital PO numbers are reserved per registered browser/device so offline
-- devices never share a number block.

create schema if not exists jgc_private;
revoke all on schema jgc_private from public, anon;
grant usage on schema jgc_private to authenticated, service_role;

alter table public.profiles
  add column if not exists can_create_digital_pos boolean not null default false;

create table if not exists public.digital_po_devices (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete restrict,
  device_token uuid not null unique,
  device_label text not null default 'Portal device',
  status text not null default 'pending'
    check (status in ('pending', 'active', 'revoked')),
  lease_expires_at timestamptz,
  last_seen_at timestamptz,
  requested_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by uuid references public.profiles(id) on delete set null,
  revoked_at timestamptz,
  revoked_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_id, device_token)
);

create table if not exists public.digital_po_number_blocks (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete restrict,
  device_id uuid not null references public.digital_po_devices(id) on delete restrict,
  range_start bigint not null check (range_start >= 30000),
  range_end bigint not null check (range_end >= range_start),
  next_number bigint not null,
  status text not null default 'active'
    check (status in ('active', 'exhausted', 'revoked')),
  assigned_at timestamptz not null default now(),
  assigned_by uuid not null references public.profiles(id) on delete restrict,
  revoked_at timestamptz,
  revoked_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint digital_po_number_blocks_cursor_check
    check (next_number >= range_start and next_number <= range_end + 1),
  constraint digital_po_number_blocks_no_overlap
    exclude using gist (int8range(range_start, range_end, '[]') with &&)
);

create table if not exists public.digital_purchase_orders (
  id uuid primary key,
  po_number bigint not null unique check (po_number >= 30000),
  number_block_id uuid not null references public.digital_po_number_blocks(id) on delete restrict,
  device_id uuid not null references public.digital_po_devices(id) on delete restrict,
  creator_profile_id uuid not null references public.profiles(id) on delete restrict,
  creator_name text not null,
  assigned_profile_id uuid references public.profiles(id) on delete restrict,
  assigned_name text,
  assigned_at timestamptz,
  opened_by_assignee_at timestamptz,
  submitted_by_profile_id uuid references public.profiles(id) on delete restrict,
  submitted_by_name text,
  job_id uuid not null references public.jobs(id) on delete restrict,
  job_number text not null,
  job_name text not null,
  supplier_id uuid references public.subcontractors_suppliers(id) on delete set null,
  supplier_name text not null default '',
  order_date date not null,
  notes text not null default '',
  workflow_status text not null default 'draft'
    check (workflow_status in (
      'draft', 'assigned', 'opened', 'ready_to_submit', 'submitted',
      'partially_received', 'fully_received', 'closed', 'cancelled'
    )),
  email_status text not null default 'not_ready'
    check (email_status in ('not_ready', 'pending', 'sending', 'emailed', 'failed')),
  receipt_status text not null default 'none'
    check (receipt_status in ('none', 'uploaded_temp', 'emailed', 'deleted', 'cleanup_failed')),
  origin text not null default 'online' check (origin in ('online', 'offline')),
  revision integer not null default 1 check (revision > 0),
  submission_sequence integer not null default 0 check (submission_sequence >= 0),
  pdf_storage_path text,
  receipt_storage_path text,
  receipt_attached boolean not null default false,
  receipt_uploaded_at timestamptz,
  receipt_uploaded_by uuid references public.profiles(id) on delete set null,
  receipt_uploaded_by_name text,
  receipt_original_filename text,
  email_last_error text,
  email_sent_at timestamptz,
  submitted_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles(id) on delete set null,
  closed_at timestamptz,
  closed_by uuid references public.profiles(id) on delete set null,
  client_created_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.digital_po_items (
  id uuid primary key,
  po_id uuid not null references public.digital_purchase_orders(id) on delete cascade,
  quantity_ordered numeric(12, 3) check (quantity_ordered is null or quantity_ordered >= 0),
  quantity_received numeric(12, 3) check (quantity_received is null or quantity_received >= 0),
  stock_number text not null default '',
  description text not null,
  notes text not null default '',
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.digital_po_work_order_links (
  id uuid primary key default gen_random_uuid(),
  po_id uuid not null unique references public.digital_purchase_orders(id) on delete restrict,
  work_order_id uuid not null references public.work_orders(id) on delete restrict,
  linked_by uuid not null references public.profiles(id) on delete restrict,
  linked_by_name text not null,
  linked_at timestamptz not null default now(),
  unique (po_id, work_order_id)
);

create table if not exists public.digital_po_audit_log (
  id bigint generated always as identity primary key,
  po_id uuid not null references public.digital_purchase_orders(id) on delete restrict,
  event_type text not null,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  actor_name text not null default 'System',
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.digital_po_email_outbox (
  id uuid primary key default gen_random_uuid(),
  po_id uuid not null references public.digital_purchase_orders(id) on delete restrict,
  submission_sequence integer not null,
  idempotency_key text not null unique,
  delivery_status text not null default 'pending'
    check (delivery_status in ('pending', 'processing', 'failed', 'sent', 'cleanup_pending', 'cleanup_failed', 'completed', 'cancelled')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  locked_until timestamptz,
  lock_token uuid,
  provider_message_id text,
  last_error text,
  sent_at timestamptz,
  cleaned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (po_id, submission_sequence)
);

create index if not exists digital_po_devices_profile_status_idx
  on public.digital_po_devices (profile_id, status);
create index if not exists digital_po_devices_status_requested_idx
  on public.digital_po_devices (status, requested_at desc);
create index if not exists digital_po_blocks_profile_status_idx
  on public.digital_po_number_blocks (profile_id, status);
create index if not exists digital_po_blocks_device_status_idx
  on public.digital_po_number_blocks (device_id, status);
create index if not exists digital_po_creator_created_idx
  on public.digital_purchase_orders (creator_profile_id, created_at desc);
create index if not exists digital_po_assigned_created_idx
  on public.digital_purchase_orders (assigned_profile_id, created_at desc)
  where assigned_profile_id is not null;
create index if not exists digital_po_job_date_idx
  on public.digital_purchase_orders (job_id, order_date desc);
create index if not exists digital_po_status_date_idx
  on public.digital_purchase_orders (workflow_status, order_date desc);
create index if not exists digital_po_supplier_date_idx
  on public.digital_purchase_orders (supplier_id, order_date desc)
  where supplier_id is not null;
create index if not exists digital_po_items_po_sort_idx
  on public.digital_po_items (po_id, sort_order);
create index if not exists digital_po_links_work_order_idx
  on public.digital_po_work_order_links (work_order_id);
create index if not exists digital_po_audit_po_created_idx
  on public.digital_po_audit_log (po_id, created_at desc);
create index if not exists digital_po_outbox_claim_idx
  on public.digital_po_email_outbox (next_attempt_at, created_at)
  where delivery_status in ('pending', 'failed', 'processing', 'cleanup_pending', 'cleanup_failed');
create index if not exists digital_po_audit_actor_idx
  on public.digital_po_audit_log (actor_profile_id)
  where actor_profile_id is not null;
create index if not exists digital_po_devices_approved_by_idx
  on public.digital_po_devices (approved_by)
  where approved_by is not null;
create index if not exists digital_po_devices_revoked_by_idx
  on public.digital_po_devices (revoked_by)
  where revoked_by is not null;
create index if not exists digital_po_blocks_assigned_by_idx
  on public.digital_po_number_blocks (assigned_by)
  where assigned_by is not null;
create index if not exists digital_po_blocks_revoked_by_idx
  on public.digital_po_number_blocks (revoked_by)
  where revoked_by is not null;
create index if not exists digital_po_links_linked_by_idx
  on public.digital_po_work_order_links (linked_by)
  where linked_by is not null;

alter table public.digital_po_devices enable row level security;
alter table public.digital_po_number_blocks enable row level security;
alter table public.digital_purchase_orders enable row level security;
alter table public.digital_po_items enable row level security;
alter table public.digital_po_work_order_links enable row level security;
alter table public.digital_po_audit_log enable row level security;
alter table public.digital_po_email_outbox enable row level security;

create or replace function jgc_private.digital_po_is_active_user()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.account_status = 'approved'
  );
$$;

create or replace function jgc_private.digital_po_is_admin()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'admin'
      and p.account_status = 'approved'
  );
$$;

create or replace function jgc_private.digital_po_is_work_order_manager()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.role in ('admin', 'supervisor')
      and p.account_status = 'approved'
  );
$$;

create or replace function jgc_private.digital_po_has_access(p_po_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.digital_purchase_orders po
    where po.id = p_po_id
      and jgc_private.digital_po_is_active_user()
      and (
        po.creator_profile_id = (select auth.uid())
        or po.assigned_profile_id = (select auth.uid())
        or jgc_private.digital_po_is_admin()
      )
  );
$$;

create or replace function jgc_private.digital_po_require_active_actor()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if (select auth.uid()) is null or (select auth.role()) = 'service_role' then
    return new;
  end if;
  if not jgc_private.digital_po_is_active_user() then
    raise exception 'This portal account is not active.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists digital_po_require_active_actor_trigger on public.digital_purchase_orders;
create trigger digital_po_require_active_actor_trigger
before insert or update on public.digital_purchase_orders
for each row execute function jgc_private.digital_po_require_active_actor();

revoke all on function jgc_private.digital_po_is_active_user() from public, anon;
revoke all on function jgc_private.digital_po_is_admin() from public, anon;
revoke all on function jgc_private.digital_po_is_work_order_manager() from public, anon;
revoke all on function jgc_private.digital_po_has_access(uuid) from public, anon;
revoke all on function jgc_private.digital_po_require_active_actor() from public, anon, authenticated;
grant execute on function jgc_private.digital_po_is_active_user() to authenticated, service_role;
grant execute on function jgc_private.digital_po_is_admin() to authenticated, service_role;
grant execute on function jgc_private.digital_po_is_work_order_manager() to authenticated, service_role;
grant execute on function jgc_private.digital_po_has_access(uuid) to authenticated, service_role;

drop policy if exists "digital po devices owner or admin read" on public.digital_po_devices;
create policy "digital po devices owner or admin read"
on public.digital_po_devices for select to authenticated
using (
  jgc_private.digital_po_is_active_user()
  and (profile_id = (select auth.uid()) or jgc_private.digital_po_is_admin())
);

drop policy if exists "digital po blocks owner or admin read" on public.digital_po_number_blocks;
create policy "digital po blocks owner or admin read"
on public.digital_po_number_blocks for select to authenticated
using (
  jgc_private.digital_po_is_active_user()
  and (profile_id = (select auth.uid()) or jgc_private.digital_po_is_admin())
);

drop policy if exists "digital po participants or admin read" on public.digital_purchase_orders;
create policy "digital po participants or admin read"
on public.digital_purchase_orders for select to authenticated
using (jgc_private.digital_po_has_access(id));

drop policy if exists "digital po participant items read" on public.digital_po_items;
create policy "digital po participant items read"
on public.digital_po_items for select to authenticated
using (jgc_private.digital_po_has_access(po_id));

drop policy if exists "digital po participant links read" on public.digital_po_work_order_links;
create policy "digital po participant links read"
on public.digital_po_work_order_links for select to authenticated
using (
  jgc_private.digital_po_has_access(po_id)
  or jgc_private.digital_po_is_work_order_manager()
);

drop policy if exists "digital po participant audit read" on public.digital_po_audit_log;
create policy "digital po participant audit read"
on public.digital_po_audit_log for select to authenticated
using (jgc_private.digital_po_has_access(po_id));

revoke all on public.digital_po_devices from anon, authenticated;
revoke all on public.digital_po_number_blocks from anon, authenticated;
revoke all on public.digital_purchase_orders from anon, authenticated;
revoke all on public.digital_po_items from anon, authenticated;
revoke all on public.digital_po_work_order_links from anon, authenticated;
revoke all on public.digital_po_audit_log from anon, authenticated;
revoke all on public.digital_po_email_outbox from anon, authenticated;

grant select on public.digital_po_devices to authenticated;
grant select on public.digital_po_number_blocks to authenticated;
grant select on public.digital_purchase_orders to authenticated;
grant select on public.digital_po_items to authenticated;
grant select on public.digital_po_work_order_links to authenticated;
grant select on public.digital_po_audit_log to authenticated;
grant all on public.digital_po_devices to service_role;
grant all on public.digital_po_number_blocks to service_role;
grant all on public.digital_purchase_orders to service_role;
grant all on public.digital_po_items to service_role;
grant all on public.digital_po_work_order_links to service_role;
grant all on public.digital_po_audit_log to service_role;
grant all on public.digital_po_email_outbox to service_role;
grant usage, select on sequence public.digital_po_audit_log_id_seq to service_role;

create or replace function public.digital_po_register_device(
  p_device_token uuid,
  p_device_label text default 'Portal device'
)
returns public.digital_po_devices
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_profile public.profiles%rowtype;
  v_device public.digital_po_devices%rowtype;
begin
  if v_user_id is null then
    raise exception 'Sign in is required.' using errcode = '28000';
  end if;

  select * into v_profile from public.profiles where id = v_user_id;
  if not found or v_profile.account_status <> 'approved' then
    raise exception 'This portal account is not active.' using errcode = '42501';
  end if;
  if not v_profile.can_create_digital_pos then
    raise exception 'This account is not approved to create digital POs.' using errcode = '42501';
  end if;

  select * into v_device
  from public.digital_po_devices
  where device_token = p_device_token
  for update;

  if found then
    if v_device.profile_id <> v_user_id then
      raise exception 'This device registration belongs to another account.' using errcode = '42501';
    end if;
    if v_device.status = 'revoked' then
      raise exception 'This PO device was revoked. Ask an admin to register a new device.' using errcode = '42501';
    end if;

    update public.digital_po_devices
    set device_label = left(coalesce(nullif(trim(p_device_label), ''), device_label), 120),
        last_seen_at = now()
    where id = v_device.id
    returning * into v_device;
    return v_device;
  end if;

  insert into public.digital_po_devices (
    profile_id,
    device_token,
    device_label,
    status,
    last_seen_at
  ) values (
    v_user_id,
    p_device_token,
    left(coalesce(nullif(trim(p_device_label), ''), 'Portal device'), 120),
    'pending',
    now()
  ) returning * into v_device;

  return v_device;
end;
$$;

create or replace function public.digital_po_get_device_context(p_device_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_profile public.profiles%rowtype;
  v_device public.digital_po_devices%rowtype;
  v_blocks jsonb := '[]'::jsonb;
begin
  if v_user_id is null then
    raise exception 'Sign in is required.' using errcode = '28000';
  end if;

  select * into v_profile from public.profiles where id = v_user_id;
  if not found or v_profile.account_status <> 'approved' then
    raise exception 'This portal account is not active.' using errcode = '42501';
  end if;

  select * into v_device
  from public.digital_po_devices
  where device_token = p_device_token
    and profile_id = v_user_id
  for update;

  if not found then
    return jsonb_build_object(
      'registered', false,
      'can_create', v_profile.can_create_digital_pos,
      'profile_id', v_profile.id,
      'profile_name', v_profile.display_name
    );
  end if;

  if v_device.status = 'active' and v_profile.can_create_digital_pos then
    update public.digital_po_devices
    set last_seen_at = now(),
        lease_expires_at = greatest(coalesce(lease_expires_at, now()), now() + interval '30 days')
    where id = v_device.id
    returning * into v_device;
  else
    update public.digital_po_devices
    set last_seen_at = now()
    where id = v_device.id
    returning * into v_device;
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', b.id,
      'range_start', b.range_start,
      'range_end', b.range_end,
      'next_number', b.next_number,
      'status', b.status,
      'remaining', greatest(b.range_end - b.next_number + 1, 0),
      'assigned_at', b.assigned_at
    ) order by b.range_start
  ), '[]'::jsonb)
  into v_blocks
  from public.digital_po_number_blocks b
  where b.device_id = v_device.id
    and b.status in ('active', 'exhausted');

  return jsonb_build_object(
    'registered', true,
    'can_create', v_profile.can_create_digital_pos,
    'profile_id', v_profile.id,
    'profile_name', v_profile.display_name,
    'device_id', v_device.id,
    'device_status', v_device.status,
    'device_label', v_device.device_label,
    'lease_expires_at', v_device.lease_expires_at,
    'blocks', v_blocks
  );
end;
$$;

create or replace function public.digital_po_admin_assign_block(
  p_device_id uuid,
  p_range_start bigint,
  p_range_end bigint,
  p_lease_days integer default 30
)
returns public.digital_po_number_blocks
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_admin_id uuid := (select auth.uid());
  v_device public.digital_po_devices%rowtype;
  v_block public.digital_po_number_blocks%rowtype;
begin
  if not jgc_private.digital_po_is_admin() then
    raise exception 'Admin access is required.' using errcode = '42501';
  end if;
  if p_range_start < 30000 or p_range_end < p_range_start then
    raise exception 'Digital PO ranges must begin at 30000 or higher and have a valid end.' using errcode = '22023';
  end if;
  if p_range_end - p_range_start > 99999 then
    raise exception 'Assign smaller PO blocks so device exposure stays limited.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('jgc-digital-po-number-blocks', 0));

  select * into v_device
  from public.digital_po_devices
  where id = p_device_id
  for update;
  if not found then
    raise exception 'PO device was not found.' using errcode = 'P0002';
  end if;
  if v_device.status = 'revoked' then
    raise exception 'A revoked device cannot receive another number block.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = v_device.profile_id
      and p.account_status = 'approved'
      and p.can_create_digital_pos
  ) then
    raise exception 'The device owner is not approved to create digital POs.' using errcode = '42501';
  end if;
  if exists (
    select 1
    from public.digital_po_number_blocks b
    where int8range(b.range_start, b.range_end, '[]') && int8range(p_range_start, p_range_end, '[]')
  ) then
    raise exception 'That PO number range overlaps an existing or historic block.' using errcode = '23P01';
  end if;

  insert into public.digital_po_number_blocks (
    profile_id,
    device_id,
    range_start,
    range_end,
    next_number,
    status,
    assigned_by
  ) values (
    v_device.profile_id,
    v_device.id,
    p_range_start,
    p_range_end,
    p_range_start,
    'active',
    v_admin_id
  ) returning * into v_block;

  update public.digital_po_devices
  set status = 'active',
      lease_expires_at = now() + make_interval(days => greatest(1, least(coalesce(p_lease_days, 30), 90))),
      approved_at = coalesce(approved_at, now()),
      approved_by = coalesce(approved_by, v_admin_id),
      revoked_at = null,
      revoked_by = null
  where id = v_device.id;

  return v_block;
end;
$$;

create or replace function public.digital_po_admin_renew_device(
  p_device_id uuid,
  p_lease_days integer default 30
)
returns public.digital_po_devices
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_device public.digital_po_devices%rowtype;
begin
  if not jgc_private.digital_po_is_admin() then
    raise exception 'Admin access is required.' using errcode = '42501';
  end if;

  update public.digital_po_devices d
  set status = 'active',
      lease_expires_at = now() + make_interval(days => greatest(1, least(coalesce(p_lease_days, 30), 90))),
      approved_at = coalesce(d.approved_at, now()),
      approved_by = coalesce(d.approved_by, (select auth.uid())),
      revoked_at = null,
      revoked_by = null
  where d.id = p_device_id
    and exists (
      select 1 from public.profiles p
      where p.id = d.profile_id
        and p.account_status = 'approved'
        and p.can_create_digital_pos
    )
    and exists (
      select 1 from public.digital_po_number_blocks b
      where b.device_id = d.id and b.status = 'active'
    )
  returning * into v_device;

  if not found then
    raise exception 'Device cannot be renewed until its user is approved and it has an active number block.' using errcode = 'P0002';
  end if;
  return v_device;
end;
$$;

create or replace function public.digital_po_admin_revoke_device(p_device_id uuid)
returns public.digital_po_devices
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_admin_id uuid := (select auth.uid());
  v_device public.digital_po_devices%rowtype;
begin
  if not jgc_private.digital_po_is_admin() then
    raise exception 'Admin access is required.' using errcode = '42501';
  end if;

  update public.digital_po_devices
  set status = 'revoked',
      lease_expires_at = now(),
      revoked_at = now(),
      revoked_by = v_admin_id
  where id = p_device_id
  returning * into v_device;

  if not found then
    raise exception 'PO device was not found.' using errcode = 'P0002';
  end if;

  update public.digital_po_number_blocks
  set status = case when next_number > range_end then 'exhausted' else 'revoked' end,
      revoked_at = case when next_number <= range_end then now() else revoked_at end,
      revoked_by = case when next_number <= range_end then v_admin_id else revoked_by end
  where device_id = p_device_id
    and status = 'active';

  return v_device;
end;
$$;

revoke all on function public.digital_po_register_device(uuid, text) from public, anon;
revoke all on function public.digital_po_get_device_context(uuid) from public, anon;
revoke all on function public.digital_po_admin_assign_block(uuid, bigint, bigint, integer) from public, anon;
revoke all on function public.digital_po_admin_renew_device(uuid, integer) from public, anon;
revoke all on function public.digital_po_admin_revoke_device(uuid) from public, anon;
grant execute on function public.digital_po_register_device(uuid, text) to authenticated;
grant execute on function public.digital_po_get_device_context(uuid) to authenticated;
grant execute on function public.digital_po_admin_assign_block(uuid, bigint, bigint, integer) to authenticated;
grant execute on function public.digital_po_admin_renew_device(uuid, integer) to authenticated;
grant execute on function public.digital_po_admin_revoke_device(uuid) to authenticated;

create or replace function jgc_private.digital_po_actor_profile_id()
returns uuid
language plpgsql
stable
set search_path = pg_catalog, public
as $$
declare
  v_claim text;
begin
  if (select auth.uid()) is not null then
    return (select auth.uid());
  end if;

  v_claim := current_setting('jgc.actor_profile_id', true);
  if v_claim ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return v_claim::uuid;
  end if;
  return null;
end;
$$;

create or replace function jgc_private.digital_po_actor_name()
returns text
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor_id uuid := jgc_private.digital_po_actor_profile_id();
  v_name text;
begin
  v_name := nullif(current_setting('jgc.actor_name', true), '');
  if v_name is not null then
    return v_name;
  end if;

  select p.display_name into v_name
  from public.profiles p
  where p.id = v_actor_id;

  return coalesce(nullif(v_name, ''), 'System');
end;
$$;

create or replace function jgc_private.digital_po_write_audit(
  p_po_id uuid,
  p_event_type text,
  p_details jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  insert into public.digital_po_audit_log (
    po_id,
    event_type,
    actor_profile_id,
    actor_name,
    details
  ) values (
    p_po_id,
    p_event_type,
    jgc_private.digital_po_actor_profile_id(),
    jgc_private.digital_po_actor_name(),
    coalesce(p_details, '{}'::jsonb)
  );
end;
$$;

create or replace function jgc_private.digital_po_touch_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists digital_po_devices_touch_updated_at on public.digital_po_devices;
create trigger digital_po_devices_touch_updated_at
before update on public.digital_po_devices
for each row execute function jgc_private.digital_po_touch_updated_at();

drop trigger if exists digital_po_blocks_touch_updated_at on public.digital_po_number_blocks;
create trigger digital_po_blocks_touch_updated_at
before update on public.digital_po_number_blocks
for each row execute function jgc_private.digital_po_touch_updated_at();

drop trigger if exists digital_purchase_orders_touch_updated_at on public.digital_purchase_orders;
create trigger digital_purchase_orders_touch_updated_at
before update on public.digital_purchase_orders
for each row execute function jgc_private.digital_po_touch_updated_at();

drop trigger if exists digital_po_items_touch_updated_at on public.digital_po_items;
create trigger digital_po_items_touch_updated_at
before update on public.digital_po_items
for each row execute function jgc_private.digital_po_touch_updated_at();

drop trigger if exists digital_po_outbox_touch_updated_at on public.digital_po_email_outbox;
create trigger digital_po_outbox_touch_updated_at
before update on public.digital_po_email_outbox
for each row execute function jgc_private.digital_po_touch_updated_at();

create or replace function jgc_private.digital_po_audit_order_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_block public.digital_po_number_blocks%rowtype;
  v_event text;
begin
  if tg_op = 'INSERT' then
    select * into v_block
    from public.digital_po_number_blocks
    where id = new.number_block_id;

    perform jgc_private.digital_po_write_audit(
      new.id,
      'number_issued',
      jsonb_build_object(
        'po_number', new.po_number,
        'number_block_id', new.number_block_id,
        'range_start', v_block.range_start,
        'range_end', v_block.range_end,
        'device_id', new.device_id,
        'origin', new.origin,
        'client_created_at', new.client_created_at
      )
    );
    perform jgc_private.digital_po_write_audit(
      new.id,
      'po_created',
      jsonb_build_object(
        'creator_profile_id', new.creator_profile_id,
        'creator_name', new.creator_name,
        'job_id', new.job_id,
        'job_number', new.job_number,
        'job_name', new.job_name,
        'order_date', new.order_date
      )
    );
    return new;
  end if;

  if old.assigned_profile_id is distinct from new.assigned_profile_id then
    perform jgc_private.digital_po_write_audit(
      new.id,
      case when new.assigned_profile_id is null then 'assignment_removed' else 'assignment_changed' end,
      jsonb_build_object(
        'previous_profile_id', old.assigned_profile_id,
        'previous_name', old.assigned_name,
        'assigned_profile_id', new.assigned_profile_id,
        'assigned_name', new.assigned_name
      )
    );
  end if;

  if old.job_id is distinct from new.job_id then
    perform jgc_private.digital_po_write_audit(
      new.id,
      'job_changed',
      jsonb_build_object(
        'previous_job_id', old.job_id,
        'previous_job_number', old.job_number,
        'job_id', new.job_id,
        'job_number', new.job_number
      )
    );
  end if;

  if old.supplier_id is distinct from new.supplier_id
     or old.supplier_name is distinct from new.supplier_name then
    perform jgc_private.digital_po_write_audit(
      new.id,
      'supplier_changed',
      jsonb_build_object(
        'previous_supplier_id', old.supplier_id,
        'previous_supplier_name', old.supplier_name,
        'supplier_id', new.supplier_id,
        'supplier_name', new.supplier_name
      )
    );
  end if;

  if old.receipt_storage_path is distinct from new.receipt_storage_path
     or old.receipt_status is distinct from new.receipt_status then
    v_event := case
      when new.receipt_status = 'uploaded_temp' then 'receipt_uploaded'
      when new.receipt_status = 'deleted' then 'receipt_deleted_after_email'
      when new.receipt_status = 'cleanup_failed' then 'receipt_cleanup_failed'
      else 'receipt_status_changed'
    end;
    perform jgc_private.digital_po_write_audit(
      new.id,
      v_event,
      jsonb_build_object(
        'previous_status', old.receipt_status,
        'status', new.receipt_status,
        'attached', new.receipt_attached,
        'original_filename', new.receipt_original_filename
      )
    );
  end if;

  if old.workflow_status is distinct from new.workflow_status then
    v_event := case new.workflow_status
      when 'opened' then 'opened_by_assignee'
      when 'submitted' then 'submitted'
      when 'cancelled' then 'cancelled'
      when 'closed' then 'closed'
      when 'partially_received' then 'partially_received'
      when 'fully_received' then 'fully_received'
      when 'draft' then 'reopened'
      else 'workflow_status_changed'
    end;
    perform jgc_private.digital_po_write_audit(
      new.id,
      v_event,
      jsonb_build_object(
        'previous_status', old.workflow_status,
        'status', new.workflow_status,
        'submitted_by_profile_id', new.submitted_by_profile_id,
        'submitted_by_name', new.submitted_by_name
      )
    );
  end if;

  if old.email_status is distinct from new.email_status then
    v_event := case new.email_status
      when 'pending' then 'email_queued'
      when 'sending' then 'email_sending'
      when 'emailed' then 'email_sent'
      when 'failed' then 'email_failed'
      else 'email_status_changed'
    end;
    perform jgc_private.digital_po_write_audit(
      new.id,
      v_event,
      jsonb_build_object(
        'previous_status', old.email_status,
        'status', new.email_status,
        'error', new.email_last_error,
        'sent_at', new.email_sent_at
      )
    );
  end if;

  if old.notes is distinct from new.notes
     or old.order_date is distinct from new.order_date then
    perform jgc_private.digital_po_write_audit(
      new.id,
      'po_details_changed',
      jsonb_build_object(
        'order_date', new.order_date,
        'notes_changed', old.notes is distinct from new.notes
      )
    );
  end if;

  return new;
end;
$$;

drop trigger if exists digital_purchase_orders_audit on public.digital_purchase_orders;
create trigger digital_purchase_orders_audit
after insert or update on public.digital_purchase_orders
for each row execute function jgc_private.digital_po_audit_order_change();

create or replace function jgc_private.digital_po_audit_item_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_po_id uuid;
  v_item_id uuid;
  v_description text;
  v_quantity_ordered numeric;
  v_quantity_received numeric;
  v_sort_order integer;
begin
  if tg_op = 'DELETE' then
    v_po_id := old.po_id;
    v_item_id := old.id;
    v_description := old.description;
    v_quantity_ordered := old.quantity_ordered;
    v_quantity_received := old.quantity_received;
    v_sort_order := old.sort_order;
  else
    v_po_id := new.po_id;
    v_item_id := new.id;
    v_description := new.description;
    v_quantity_ordered := new.quantity_ordered;
    v_quantity_received := new.quantity_received;
    v_sort_order := new.sort_order;
  end if;

  perform jgc_private.digital_po_write_audit(
    v_po_id,
    case tg_op
      when 'INSERT' then 'material_added'
      when 'UPDATE' then 'material_changed'
      else 'material_removed'
    end,
    jsonb_build_object(
      'item_id', v_item_id,
      'description', v_description,
      'quantity_ordered', v_quantity_ordered,
      'quantity_received', v_quantity_received,
      'sort_order', v_sort_order
    )
  );
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists digital_po_items_audit on public.digital_po_items;
create trigger digital_po_items_audit
after insert or update or delete on public.digital_po_items
for each row execute function jgc_private.digital_po_audit_item_change();

create or replace function jgc_private.digital_po_audit_link_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'INSERT' then
    perform jgc_private.digital_po_write_audit(
      new.po_id,
      'work_order_linked',
      jsonb_build_object(
        'work_order_id', new.work_order_id,
        'linked_by', new.linked_by,
        'linked_by_name', new.linked_by_name
      )
    );
    return new;
  end if;

  perform jgc_private.digital_po_write_audit(
    old.po_id,
    'work_order_unlinked',
    jsonb_build_object(
      'work_order_id', old.work_order_id,
      'linked_by', old.linked_by,
      'linked_by_name', old.linked_by_name
    )
  );
  return old;
end;
$$;

drop trigger if exists digital_po_work_order_links_audit on public.digital_po_work_order_links;
create trigger digital_po_work_order_links_audit
after insert or delete on public.digital_po_work_order_links
for each row execute function jgc_private.digital_po_audit_link_change();

create or replace function jgc_private.digital_po_protect_audit()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if current_user <> 'postgres' then
    raise exception 'Digital PO audit history is immutable.' using errcode = '42501';
  end if;
  return old;
end;
$$;

drop trigger if exists digital_po_audit_immutable on public.digital_po_audit_log;
create trigger digital_po_audit_immutable
before update or delete on public.digital_po_audit_log
for each row execute function jgc_private.digital_po_protect_audit();

revoke all on function jgc_private.digital_po_actor_profile_id() from public, anon, authenticated;
revoke all on function jgc_private.digital_po_actor_name() from public, anon, authenticated;
revoke all on function jgc_private.digital_po_write_audit(uuid, text, jsonb) from public, anon, authenticated;

create or replace function public.digital_po_save(
  p_order jsonb,
  p_items jsonb default '[]'::jsonb,
  p_expected_revision integer default null
)
returns public.digital_purchase_orders
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_profile public.profiles%rowtype;
  v_existing public.digital_purchase_orders%rowtype;
  v_saved public.digital_purchase_orders%rowtype;
  v_device public.digital_po_devices%rowtype;
  v_block public.digital_po_number_blocks%rowtype;
  v_job public.jobs%rowtype;
  v_supplier public.subcontractors_suppliers%rowtype;
  v_po_id uuid;
  v_device_token uuid;
  v_block_id uuid;
  v_job_id uuid;
  v_supplier_id uuid;
  v_po_number bigint;
  v_client_created_at timestamptz;
  v_order_date date;
  v_supplier_name text;
  v_is_admin boolean := jgc_private.digital_po_is_admin();
  v_is_assignee boolean := false;
  v_item jsonb;
  v_item_id uuid;
  v_item_count integer := 0;
begin
  if v_user_id is null then
    raise exception 'Sign in is required.' using errcode = '28000';
  end if;
  if p_order is null or jsonb_typeof(p_order) <> 'object' then
    raise exception 'PO details are required.' using errcode = '22023';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Material rows must be an array.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) > 100 then
    raise exception 'A PO can contain at most 100 material rows.' using errcode = '22023';
  end if;

  begin
    v_po_id := (p_order->>'id')::uuid;
  exception when others then
    raise exception 'A valid PO ID is required.' using errcode = '22023';
  end;

  select * into v_profile from public.profiles where id = v_user_id;
  if not found or v_profile.account_status <> 'approved' then
    raise exception 'This portal account is not active.' using errcode = '42501';
  end if;

  select * into v_existing
  from public.digital_purchase_orders
  where id = v_po_id
  for update;

  if not found then
    if not v_profile.can_create_digital_pos then
      raise exception 'This account is not approved to create digital POs.' using errcode = '42501';
    end if;

    begin
      v_device_token := (p_order->>'device_token')::uuid;
      v_block_id := (p_order->>'number_block_id')::uuid;
      v_job_id := (p_order->>'job_id')::uuid;
      v_po_number := (p_order->>'po_number')::bigint;
      v_client_created_at := (p_order->>'client_created_at')::timestamptz;
      v_order_date := (p_order->>'order_date')::date;
      v_supplier_id := nullif(p_order->>'supplier_id', '')::uuid;
    exception when others then
      raise exception 'PO number, device, job, date, and creation time are required.' using errcode = '22023';
    end;

    select * into v_device
    from public.digital_po_devices
    where device_token = v_device_token
      and profile_id = v_user_id
    for update;
    if not found or v_device.status <> 'active' then
      raise exception 'This device is not approved to issue digital POs.' using errcode = '42501';
    end if;
    if v_device.lease_expires_at is null
       or v_client_created_at > v_device.lease_expires_at
       or v_client_created_at > now() + interval '10 minutes' then
      raise exception 'The offline PO authorization lease was not valid when this number was issued.' using errcode = '42501';
    end if;

    select * into v_block
    from public.digital_po_number_blocks
    where id = v_block_id
      and device_id = v_device.id
      and profile_id = v_user_id
      and status in ('active', 'exhausted')
    for update;
    if not found then
      raise exception 'The assigned PO number block is not valid for this device.' using errcode = '42501';
    end if;
    if v_client_created_at < v_block.assigned_at - interval '10 minutes'
       or v_po_number < v_block.range_start
       or v_po_number > v_block.range_end then
      raise exception 'The PO number is outside this device number block.' using errcode = '42501';
    end if;

    select * into v_job from public.jobs where id = v_job_id;
    if not found then
      raise exception 'The selected job no longer exists.' using errcode = '23503';
    end if;

    if v_supplier_id is not null then
      select * into v_supplier
      from public.subcontractors_suppliers
      where id = v_supplier_id;
      if not found then
        raise exception 'The selected supplier no longer exists.' using errcode = '23503';
      end if;
      v_supplier_name := v_supplier.company_name;
    else
      v_supplier_name := left(coalesce(trim(p_order->>'supplier_name'), ''), 240);
    end if;

    insert into public.digital_purchase_orders (
      id,
      po_number,
      number_block_id,
      device_id,
      creator_profile_id,
      creator_name,
      job_id,
      job_number,
      job_name,
      supplier_id,
      supplier_name,
      order_date,
      notes,
      workflow_status,
      email_status,
      receipt_status,
      origin,
      client_created_at
    ) values (
      v_po_id,
      v_po_number,
      v_block.id,
      v_device.id,
      v_user_id,
      v_profile.display_name,
      v_job.id,
      v_job.job_number,
      v_job.job_name,
      v_supplier_id,
      v_supplier_name,
      v_order_date,
      left(coalesce(p_order->>'notes', ''), 5000),
      'draft',
      'not_ready',
      'none',
      case when coalesce((p_order->>'origin')::text, 'online') = 'offline' then 'offline' else 'online' end,
      v_client_created_at
    ) returning * into v_saved;

    update public.digital_po_number_blocks
    set next_number = greatest(next_number, v_po_number + 1),
        status = case when greatest(next_number, v_po_number + 1) > range_end then 'exhausted' else status end
    where id = v_block.id;
  else
    if not (
      v_existing.creator_profile_id = v_user_id
      or v_existing.assigned_profile_id = v_user_id
      or v_is_admin
    ) then
      raise exception 'You do not have access to edit this PO.' using errcode = '42501';
    end if;
    if v_existing.workflow_status not in ('draft', 'assigned', 'opened', 'ready_to_submit') then
      raise exception 'This PO is locked. An admin must reopen it before changes can be made.' using errcode = '55000';
    end if;
    if p_expected_revision is null or p_expected_revision <> v_existing.revision then
      raise exception 'This PO changed on another device. Reload it before saving.' using errcode = '40001';
    end if;

    v_is_assignee := v_existing.assigned_profile_id = v_user_id
      and v_existing.creator_profile_id <> v_user_id
      and not v_is_admin;

    if v_is_assignee then
      v_job_id := v_existing.job_id;
      if nullif(p_order->>'job_id', '') is not null
         and (p_order->>'job_id')::uuid <> v_existing.job_id then
        raise exception 'The assigned employee cannot change the PO job.' using errcode = '42501';
      end if;
    else
      begin
        v_job_id := coalesce(nullif(p_order->>'job_id', '')::uuid, v_existing.job_id);
      exception when others then
        raise exception 'A valid job is required.' using errcode = '22023';
      end;
    end if;

    select * into v_job from public.jobs where id = v_job_id;
    if not found then
      raise exception 'The selected job no longer exists.' using errcode = '23503';
    end if;

    begin
      v_supplier_id := nullif(p_order->>'supplier_id', '')::uuid;
      v_order_date := coalesce(nullif(p_order->>'order_date', '')::date, v_existing.order_date);
    exception when others then
      raise exception 'A valid supplier and order date are required.' using errcode = '22023';
    end;

    if v_supplier_id is not null then
      select * into v_supplier
      from public.subcontractors_suppliers
      where id = v_supplier_id;
      if not found then
        raise exception 'The selected supplier no longer exists.' using errcode = '23503';
      end if;
      v_supplier_name := v_supplier.company_name;
    else
      v_supplier_name := left(coalesce(trim(p_order->>'supplier_name'), ''), 240);
    end if;

    update public.digital_purchase_orders
    set job_id = v_job.id,
        job_number = v_job.job_number,
        job_name = v_job.job_name,
        supplier_id = v_supplier_id,
        supplier_name = v_supplier_name,
        order_date = v_order_date,
        notes = left(coalesce(p_order->>'notes', ''), 5000),
        revision = revision + 1
    where id = v_existing.id
    returning * into v_saved;

    delete from public.digital_po_items where po_id = v_existing.id;
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    if nullif(trim(v_item->>'description'), '') is null then
      continue;
    end if;
    begin
      v_item_id := coalesce(nullif(v_item->>'id', '')::uuid, gen_random_uuid());
    exception when others then
      v_item_id := gen_random_uuid();
    end;

    insert into public.digital_po_items (
      id,
      po_id,
      quantity_ordered,
      quantity_received,
      stock_number,
      description,
      notes,
      sort_order
    ) values (
      v_item_id,
      v_saved.id,
      nullif(v_item->>'quantity_ordered', '')::numeric,
      nullif(v_item->>'quantity_received', '')::numeric,
      left(coalesce(v_item->>'stock_number', ''), 120),
      left(trim(v_item->>'description'), 1000),
      left(coalesce(v_item->>'notes', ''), 2000),
      v_item_count
    );
    v_item_count := v_item_count + 1;
  end loop;

  select * into v_saved
  from public.digital_purchase_orders
  where id = v_saved.id;
  return v_saved;
end;
$$;

create or replace function public.digital_po_assign(
  p_po_id uuid,
  p_assigned_profile_id uuid,
  p_expected_revision integer
)
returns public.digital_purchase_orders
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_po public.digital_purchase_orders%rowtype;
  v_target public.profiles%rowtype;
  v_saved public.digital_purchase_orders%rowtype;
begin
  select * into v_po
  from public.digital_purchase_orders
  where id = p_po_id
  for update;
  if not found then
    raise exception 'PO was not found.' using errcode = 'P0002';
  end if;
  if v_po.creator_profile_id <> v_user_id and not jgc_private.digital_po_is_admin() then
    raise exception 'Only the creator or an admin can reassign this PO.' using errcode = '42501';
  end if;
  if v_po.workflow_status not in ('draft', 'assigned', 'opened', 'ready_to_submit') then
    raise exception 'A submitted, closed, or cancelled PO cannot be reassigned.' using errcode = '55000';
  end if;
  if p_expected_revision <> v_po.revision then
    raise exception 'This PO changed on another device. Reload it before assigning.' using errcode = '40001';
  end if;

  update public.notifications
  set cleared_at = coalesce(cleared_at, now()), updated_at = now()
  where notification_type = 'digital_po_assigned'
    and source_table = 'digital_purchase_orders'
    and source_id = p_po_id::text
    and cleared_at is null;

  if p_assigned_profile_id is null then
    update public.digital_purchase_orders
    set assigned_profile_id = null,
        assigned_name = null,
        assigned_at = null,
        opened_by_assignee_at = null,
        workflow_status = 'draft',
        revision = revision + 1
    where id = p_po_id
    returning * into v_saved;
    return v_saved;
  end if;

  select * into v_target
  from public.profiles p
  where p.id = p_assigned_profile_id
    and p.account_status = 'approved'
    and exists (
      select 1
      from public.work_order_labour_workers w
      where w.profile_id = p.id
        and w.approved = true
    );
  if not found then
    raise exception 'The assigned employee must be active on the Work Order approved employee list.' using errcode = '42501';
  end if;

  update public.digital_purchase_orders
  set assigned_profile_id = v_target.id,
      assigned_name = v_target.display_name,
      assigned_at = now(),
      opened_by_assignee_at = null,
      workflow_status = 'assigned',
      revision = revision + 1
  where id = p_po_id
  returning * into v_saved;

  insert into public.notifications (
    notification_type,
    title,
    message,
    link_url,
    target_profile_id,
    target_worker_key,
    target_worker_email,
    source_table,
    source_id,
    metadata,
    created_by,
    created_by_name,
    dedupe_key
  ) values (
    'digital_po_assigned',
    'Digital PO assigned',
    'PO-' || v_po.po_number || ' for job ' || v_po.job_number || ' was assigned to you.',
    'purchase-orders.html?po=' || p_po_id,
    v_target.id,
    v_target.worker_key,
    v_target.email,
    'digital_purchase_orders',
    p_po_id::text,
    jsonb_build_object('po_number', v_po.po_number, 'job_number', v_po.job_number),
    v_user_id,
    jgc_private.digital_po_actor_name(),
    'digital-po-assigned:' || p_po_id || ':' || v_target.id || ':' || v_saved.revision
  );

  return v_saved;
end;
$$;

create or replace function public.digital_po_mark_opened(p_po_id uuid)
returns public.digital_purchase_orders
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_saved public.digital_purchase_orders%rowtype;
begin
  update public.digital_purchase_orders
  set opened_by_assignee_at = coalesce(opened_by_assignee_at, now()),
      workflow_status = case when workflow_status = 'assigned' then 'opened' else workflow_status end,
      revision = case when opened_by_assignee_at is null then revision + 1 else revision end
  where id = p_po_id
    and assigned_profile_id = v_user_id
    and workflow_status in ('assigned', 'opened', 'ready_to_submit')
  returning * into v_saved;

  if not found then
    select * into v_saved
    from public.digital_purchase_orders
    where id = p_po_id
      and (creator_profile_id = v_user_id or jgc_private.digital_po_is_admin());
  end if;
  if not found then
    raise exception 'You do not have access to open this PO.' using errcode = '42501';
  end if;
  return v_saved;
end;
$$;

create or replace function public.digital_po_submit(
  p_po_id uuid,
  p_expected_revision integer,
  p_pdf_storage_path text,
  p_receipt_storage_path text default null,
  p_receipt_original_filename text default null
)
returns public.digital_purchase_orders
language plpgsql
security definer
set search_path = pg_catalog, public, storage
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_profile public.profiles%rowtype;
  v_po public.digital_purchase_orders%rowtype;
  v_saved public.digital_purchase_orders%rowtype;
  v_sequence integer;
begin
  select * into v_profile
  from public.profiles
  where id = v_user_id and account_status = 'approved';
  if not found then
    raise exception 'This portal account is not active.' using errcode = '42501';
  end if;

  select * into v_po
  from public.digital_purchase_orders
  where id = p_po_id
  for update;
  if not found then
    raise exception 'PO was not found.' using errcode = 'P0002';
  end if;
  if not (
    v_po.creator_profile_id = v_user_id
    or v_po.assigned_profile_id = v_user_id
    or jgc_private.digital_po_is_admin()
  ) then
    raise exception 'You do not have access to submit this PO.' using errcode = '42501';
  end if;
  if v_po.workflow_status not in ('draft', 'assigned', 'opened', 'ready_to_submit') then
    raise exception 'This PO is already locked.' using errcode = '55000';
  end if;
  if p_expected_revision <> v_po.revision then
    raise exception 'This PO changed on another device. Reload it before submitting.' using errcode = '40001';
  end if;
  if nullif(trim(v_po.supplier_name), '') is null then
    raise exception 'Supplier is required before submission.' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.digital_po_items i
    where i.po_id = v_po.id and nullif(trim(i.description), '') is not null
  ) then
    raise exception 'At least one material row is required before submission.' using errcode = '23514';
  end if;
  if p_pdf_storage_path is null
     or p_pdf_storage_path !~ ('^' || p_po_id::text || '/[a-zA-Z0-9._/-]+$')
     or not exists (
       select 1 from storage.objects o
       where o.bucket_id = 'digital-po-temp' and o.name = p_pdf_storage_path
     ) then
    raise exception 'The temporary PO PDF upload could not be verified.' using errcode = '23514';
  end if;
  if p_receipt_storage_path is not null and (
    p_receipt_storage_path !~ ('^' || p_po_id::text || '/[a-zA-Z0-9._/-]+$')
    or not exists (
      select 1 from storage.objects o
      where o.bucket_id = 'digital-po-temp' and o.name = p_receipt_storage_path
    )
  ) then
    raise exception 'The temporary receipt upload could not be verified.' using errcode = '23514';
  end if;

  v_sequence := v_po.submission_sequence + 1;
  perform set_config('jgc.actor_name', v_profile.display_name, true);

  update public.digital_purchase_orders
  set workflow_status = 'submitted',
      email_status = 'pending',
      receipt_status = case when p_receipt_storage_path is null then 'none' else 'uploaded_temp' end,
      receipt_attached = p_receipt_storage_path is not null,
      pdf_storage_path = p_pdf_storage_path,
      receipt_storage_path = p_receipt_storage_path,
      receipt_uploaded_at = case when p_receipt_storage_path is null then null else now() end,
      receipt_uploaded_by = case when p_receipt_storage_path is null then null else v_user_id end,
      receipt_uploaded_by_name = case when p_receipt_storage_path is null then null else v_profile.display_name end,
      receipt_original_filename = case when p_receipt_storage_path is null then null else left(coalesce(p_receipt_original_filename, 'receipt.jpg'), 240) end,
      submitted_by_profile_id = v_user_id,
      submitted_by_name = v_profile.display_name,
      submitted_at = now(),
      submission_sequence = v_sequence,
      email_last_error = null,
      revision = revision + 1
  where id = p_po_id
  returning * into v_saved;

  insert into public.digital_po_email_outbox (
    po_id,
    submission_sequence,
    idempotency_key,
    delivery_status,
    next_attempt_at
  ) values (
    p_po_id,
    v_sequence,
    'jgc-digital-po-' || p_po_id || '-' || v_sequence,
    'pending',
    now()
  );

  return v_saved;
end;
$$;

create or replace function public.digital_po_cancel(
  p_po_id uuid,
  p_expected_revision integer
)
returns public.digital_purchase_orders
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_po public.digital_purchase_orders%rowtype;
  v_saved public.digital_purchase_orders%rowtype;
begin
  select * into v_po from public.digital_purchase_orders where id = p_po_id for update;
  if not found then
    raise exception 'PO was not found.' using errcode = 'P0002';
  end if;
  if v_po.creator_profile_id <> v_user_id and not jgc_private.digital_po_is_admin() then
    raise exception 'Only the creator or an admin can cancel this PO.' using errcode = '42501';
  end if;
  if v_po.workflow_status in ('closed', 'cancelled') then
    raise exception 'This PO is already closed or cancelled.' using errcode = '55000';
  end if;
  if p_expected_revision <> v_po.revision then
    raise exception 'This PO changed on another device. Reload it before cancelling.' using errcode = '40001';
  end if;
  if v_po.email_status = 'sending' then
    raise exception 'Email delivery is already in progress. Refresh the PO before cancelling.' using errcode = '55000';
  end if;

  if v_po.email_status in ('pending', 'failed') then
    update public.digital_po_email_outbox
    set delivery_status = 'cleanup_pending',
        next_attempt_at = now(),
        locked_until = null,
        lock_token = null,
        last_error = 'PO cancelled before email delivery.'
    where po_id = p_po_id
      and delivery_status in ('pending', 'failed');
  end if;

  update public.digital_purchase_orders
  set workflow_status = 'cancelled',
      email_status = case when email_status in ('pending', 'failed') then 'not_ready' else email_status end,
      email_last_error = case when email_status in ('pending', 'failed') then 'PO cancelled before email delivery.' else email_last_error end,
      cancelled_at = now(),
      cancelled_by = v_user_id,
      revision = revision + 1
  where id = p_po_id
  returning * into v_saved;
  return v_saved;
end;
$$;

create or replace function public.digital_po_admin_reopen(p_po_id uuid)
returns public.digital_purchase_orders
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_po public.digital_purchase_orders%rowtype;
  v_saved public.digital_purchase_orders%rowtype;
begin
  if not jgc_private.digital_po_is_admin() then
    raise exception 'Admin access is required.' using errcode = '42501';
  end if;

  select * into v_po
  from public.digital_purchase_orders
  where id = p_po_id
  for update;
  if not found or v_po.workflow_status not in ('submitted', 'partially_received', 'fully_received', 'closed', 'cancelled') then
    raise exception 'PO is already editable or was not found.' using errcode = 'P0002';
  end if;
  if v_po.email_status in ('pending', 'sending', 'failed')
     or v_po.pdf_storage_path is not null
     or v_po.receipt_storage_path is not null then
    raise exception 'Finish email delivery and temporary file cleanup before reopening this PO.' using errcode = '55000';
  end if;

  update public.digital_purchase_orders
  set workflow_status = 'draft',
      email_status = 'not_ready',
      receipt_status = 'none',
      receipt_attached = false,
      pdf_storage_path = null,
      receipt_storage_path = null,
      receipt_uploaded_at = null,
      receipt_uploaded_by = null,
      receipt_uploaded_by_name = null,
      receipt_original_filename = null,
      email_last_error = null,
      cancelled_at = null,
      cancelled_by = null,
      closed_at = null,
      closed_by = null,
      revision = revision + 1
  where id = p_po_id
    and workflow_status in ('submitted', 'partially_received', 'fully_received', 'closed', 'cancelled')
  returning * into v_saved;

  return v_saved;
end;
$$;

create or replace function public.digital_po_set_completion_status(
  p_po_id uuid,
  p_status text
)
returns public.digital_purchase_orders
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_saved public.digital_purchase_orders%rowtype;
begin
  if p_status not in ('partially_received', 'fully_received', 'closed') then
    raise exception 'Invalid PO completion status.' using errcode = '22023';
  end if;
  if p_status = 'closed' and not jgc_private.digital_po_is_admin() then
    raise exception 'Only an admin can close a PO.' using errcode = '42501';
  end if;

  update public.digital_purchase_orders
  set workflow_status = p_status,
      closed_at = case when p_status = 'closed' then now() else closed_at end,
      closed_by = case when p_status = 'closed' then v_user_id else closed_by end,
      revision = revision + 1
  where id = p_po_id
    and workflow_status in ('submitted', 'partially_received', 'fully_received')
    and (
      creator_profile_id = v_user_id
      or assigned_profile_id = v_user_id
      or jgc_private.digital_po_is_admin()
    )
  returning * into v_saved;

  if not found then
    raise exception 'PO status could not be changed.' using errcode = '42501';
  end if;
  return v_saved;
end;
$$;

create or replace function public.digital_po_link_work_orders(
  p_work_order_id uuid,
  p_po_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_actor_name text := jgc_private.digital_po_actor_name();
  v_work_order public.work_orders%rowtype;
  v_po_id uuid;
  v_po public.digital_purchase_orders%rowtype;
  v_linked integer := 0;
  v_skipped integer := 0;
begin
  if not jgc_private.digital_po_is_work_order_manager() then
    raise exception 'Supervisor or admin access is required to link digital POs.' using errcode = '42501';
  end if;

  select * into v_work_order
  from public.work_orders
  where id = p_work_order_id
  for update;
  if not found then
    raise exception 'Work Order was not found.' using errcode = 'P0002';
  end if;

  foreach v_po_id in array coalesce(p_po_ids, array[]::uuid[])
  loop
    select * into v_po
    from public.digital_purchase_orders
    where id = v_po_id
    for update;

    if not found
       or not (
         v_po.job_id = v_work_order.job_id
         or (
           v_po.job_id is null
           and upper(regexp_replace(coalesce(v_po.job_number, ''), '[^A-Za-z0-9]', '', 'g'))
             = upper(regexp_replace(coalesce(v_work_order.job_number, ''), '[^A-Za-z0-9]', '', 'g'))
         )
       )
       or v_po.order_date is distinct from v_work_order.work_order_date
       or v_po.workflow_status = 'cancelled'
       or exists (select 1 from public.digital_po_work_order_links l where l.po_id = v_po_id) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    insert into public.digital_po_work_order_links (
      po_id,
      work_order_id,
      linked_by,
      linked_by_name
    ) values (
      v_po_id,
      p_work_order_id,
      v_user_id,
      v_actor_name
    );
    v_linked := v_linked + 1;
  end loop;

  return jsonb_build_object('linked', v_linked, 'skipped', v_skipped);
end;
$$;

create or replace function public.digital_po_unlink_work_order(p_po_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if not jgc_private.digital_po_is_work_order_manager() then
    raise exception 'Supervisor or admin access is required to unlink digital POs.' using errcode = '42501';
  end if;

  delete from public.digital_po_work_order_links where po_id = p_po_id;
  return found;
end;
$$;

revoke all on function public.digital_po_save(jsonb, jsonb, integer) from public, anon;
revoke all on function public.digital_po_assign(uuid, uuid, integer) from public, anon;
revoke all on function public.digital_po_mark_opened(uuid) from public, anon;
revoke all on function public.digital_po_submit(uuid, integer, text, text, text) from public, anon;
revoke all on function public.digital_po_cancel(uuid, integer) from public, anon;
revoke all on function public.digital_po_admin_reopen(uuid) from public, anon;
revoke all on function public.digital_po_set_completion_status(uuid, text) from public, anon;
revoke all on function public.digital_po_link_work_orders(uuid, uuid[]) from public, anon;
revoke all on function public.digital_po_unlink_work_order(uuid) from public, anon;
grant execute on function public.digital_po_save(jsonb, jsonb, integer) to authenticated;
grant execute on function public.digital_po_assign(uuid, uuid, integer) to authenticated;
grant execute on function public.digital_po_mark_opened(uuid) to authenticated;
grant execute on function public.digital_po_submit(uuid, integer, text, text, text) to authenticated;
grant execute on function public.digital_po_cancel(uuid, integer) to authenticated;
grant execute on function public.digital_po_admin_reopen(uuid) to authenticated;
grant execute on function public.digital_po_set_completion_status(uuid, text) to authenticated;
grant execute on function public.digital_po_link_work_orders(uuid, uuid[]) to authenticated;
grant execute on function public.digital_po_unlink_work_order(uuid) to authenticated;

create or replace function public.digital_po_claim_email_jobs(p_limit integer default 5)
returns table (
  outbox_id uuid,
  po_id uuid,
  action text,
  lock_token uuid
)
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  return query
  with candidates as (
    select o.id, o.po_id, o.delivery_status
    from public.digital_po_email_outbox o
    where (
      o.delivery_status in ('pending', 'failed')
      and o.next_attempt_at <= now()
    ) or (
      o.delivery_status = 'processing'
      and coalesce(o.locked_until, '-infinity'::timestamptz) <= now()
    ) or (
      o.delivery_status in ('cleanup_pending', 'cleanup_failed')
      and o.next_attempt_at <= now()
      and coalesce(o.locked_until, '-infinity'::timestamptz) <= now()
    )
    order by o.next_attempt_at, o.created_at
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 5), 20))
  ), claimed as (
    update public.digital_po_email_outbox o
    set delivery_status = case
          when c.delivery_status in ('cleanup_pending', 'cleanup_failed') then 'cleanup_pending'
          else 'processing'
        end,
        attempts = case
          when c.delivery_status in ('cleanup_pending', 'cleanup_failed') then o.attempts
          else o.attempts + 1
        end,
        lock_token = gen_random_uuid(),
        locked_until = now() + interval '10 minutes',
        last_error = case
          when c.delivery_status in ('cleanup_pending', 'cleanup_failed') then o.last_error
          else null
        end
    from candidates c
    where o.id = c.id
      and o.delivery_status = c.delivery_status
    returning o.id, o.po_id, o.lock_token, c.delivery_status
  ), marked_sending as (
    update public.digital_purchase_orders po
    set email_status = 'sending'
    from claimed c
    where po.id = c.po_id
      and c.delivery_status not in ('cleanup_pending', 'cleanup_failed')
    returning po.id
  )
  select
    c.id,
    c.po_id,
    case when c.delivery_status in ('cleanup_pending', 'cleanup_failed') then 'cleanup' else 'send' end,
    c.lock_token
  from claimed c;
end;
$$;

create or replace function public.digital_po_complete_email_delivery(
  p_outbox_id uuid,
  p_lock_token uuid,
  p_provider_message_id text
)
returns boolean
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_po_id uuid;
begin
  perform set_config('jgc.actor_name', 'Digital PO email worker', true);

  update public.digital_po_email_outbox
  set delivery_status = 'cleanup_pending',
      provider_message_id = left(coalesce(p_provider_message_id, ''), 500),
      sent_at = now(),
      next_attempt_at = now(),
      last_error = null
  where id = p_outbox_id
    and lock_token = p_lock_token
    and delivery_status = 'processing'
  returning po_id into v_po_id;

  if not found then
    return false;
  end if;

  update public.digital_purchase_orders
  set email_status = 'emailed',
      email_sent_at = now(),
      email_last_error = null,
      receipt_status = case when receipt_attached then 'emailed' else receipt_status end
  where id = v_po_id;

  return true;
end;
$$;

create or replace function public.digital_po_complete_temp_cleanup(
  p_outbox_id uuid,
  p_lock_token uuid,
  p_success boolean,
  p_error text default null
)
returns boolean
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_po_id uuid;
begin
  perform set_config('jgc.actor_name', 'Digital PO email worker', true);

  update public.digital_po_email_outbox
  set delivery_status = case when p_success then 'completed' else 'cleanup_failed' end,
      cleaned_at = case when p_success then now() else null end,
      next_attempt_at = case when p_success then now() else now() + interval '30 minutes' end,
      locked_until = null,
      lock_token = null,
      last_error = case when p_success then null else left(coalesce(p_error, 'Temporary file cleanup failed.'), 2000) end
  where id = p_outbox_id
    and lock_token = p_lock_token
    and delivery_status = 'cleanup_pending'
  returning po_id into v_po_id;

  if not found then
    return false;
  end if;

  if p_success then
    update public.digital_purchase_orders
    set pdf_storage_path = null,
        receipt_storage_path = null,
        receipt_status = case when receipt_attached then 'deleted' else 'none' end
    where id = v_po_id;
  else
    update public.digital_purchase_orders
    set receipt_status = case when receipt_attached then 'cleanup_failed' else receipt_status end,
        email_last_error = left(coalesce(p_error, 'Email was delivered, but temporary file cleanup failed.'), 2000)
    where id = v_po_id;
  end if;

  return true;
end;
$$;

create or replace function public.digital_po_fail_email_job(
  p_outbox_id uuid,
  p_lock_token uuid,
  p_error text
)
returns boolean
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_po_id uuid;
  v_attempts integer;
begin
  perform set_config('jgc.actor_name', 'Digital PO email worker', true);

  update public.digital_po_email_outbox
  set delivery_status = 'failed',
      next_attempt_at = now() + make_interval(mins => least(1440, greatest(5, (power(2, least(attempts, 8)) * 5)::integer))),
      locked_until = null,
      lock_token = null,
      last_error = left(coalesce(p_error, 'Email delivery failed.'), 2000)
  where id = p_outbox_id
    and lock_token = p_lock_token
    and delivery_status = 'processing'
  returning po_id, attempts into v_po_id, v_attempts;

  if not found then
    return false;
  end if;

  update public.digital_purchase_orders
  set email_status = 'failed',
      email_last_error = left(coalesce(p_error, 'Email delivery failed.'), 2000)
  where id = v_po_id;

  return true;
end;
$$;

create or replace function public.digital_po_admin_retry_email(p_po_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_status text;
begin
  if not jgc_private.digital_po_is_admin() then
    raise exception 'Admin access is required.' using errcode = '42501';
  end if;

  select delivery_status into v_status
  from public.digital_po_email_outbox
  where po_id = p_po_id
  order by submission_sequence desc
  limit 1
  for update;
  if not found then
    raise exception 'No email delivery record exists for this PO.' using errcode = 'P0002';
  end if;
  if v_status not in ('failed', 'cleanup_failed') then
    raise exception 'Only failed email or cleanup jobs can be retried manually.' using errcode = '55000';
  end if;

  update public.digital_po_email_outbox
  set delivery_status = case when v_status = 'cleanup_failed' then 'cleanup_pending' else 'pending' end,
      next_attempt_at = now(),
      locked_until = null,
      lock_token = null,
      last_error = null
  where po_id = p_po_id
    and submission_sequence = (
      select max(submission_sequence)
      from public.digital_po_email_outbox
      where po_id = p_po_id
    );

  if v_status <> 'cleanup_failed' then
    update public.digital_purchase_orders
    set email_status = 'pending', email_last_error = null
    where id = p_po_id;
  end if;
  return true;
end;
$$;

revoke all on function public.digital_po_claim_email_jobs(integer) from public, anon, authenticated;
revoke all on function public.digital_po_complete_email_delivery(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.digital_po_complete_temp_cleanup(uuid, uuid, boolean, text) from public, anon, authenticated;
revoke all on function public.digital_po_fail_email_job(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.digital_po_admin_retry_email(uuid) from public, anon;
grant execute on function public.digital_po_claim_email_jobs(integer) to service_role;
grant execute on function public.digital_po_complete_email_delivery(uuid, uuid, text) to service_role;
grant execute on function public.digital_po_complete_temp_cleanup(uuid, uuid, boolean, text) to service_role;
grant execute on function public.digital_po_fail_email_job(uuid, uuid, text) to service_role;
grant execute on function public.digital_po_admin_retry_email(uuid) to authenticated;

create or replace function jgc_private.digital_po_storage_po_id(p_name text)
returns uuid
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  v_id text := split_part(coalesce(p_name, ''), '/', 1);
begin
  if v_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return v_id::uuid;
  end if;
  return null;
end;
$$;

create or replace function jgc_private.digital_po_storage_can_write(p_name text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.digital_purchase_orders po
    where po.id = jgc_private.digital_po_storage_po_id(p_name)
      and po.workflow_status in ('draft', 'assigned', 'opened', 'ready_to_submit')
      and (
        po.creator_profile_id = (select auth.uid())
        or po.assigned_profile_id = (select auth.uid())
        or jgc_private.digital_po_is_admin()
      )
  );
$$;

revoke all on function jgc_private.digital_po_storage_po_id(text) from public, anon;
revoke all on function jgc_private.digital_po_storage_can_write(text) from public, anon;
grant execute on function jgc_private.digital_po_storage_po_id(text) to authenticated, service_role;
grant execute on function jgc_private.digital_po_storage_can_write(text) to authenticated, service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'digital-po-temp',
  'digital-po-temp',
  false,
  12582912,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "digital po temp participant read" on storage.objects;
create policy "digital po temp participant read"
on storage.objects for select to authenticated
using (
  bucket_id = 'digital-po-temp'
  and jgc_private.digital_po_has_access(jgc_private.digital_po_storage_po_id(name))
);

drop policy if exists "digital po temp participant insert" on storage.objects;
create policy "digital po temp participant insert"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'digital-po-temp'
  and jgc_private.digital_po_storage_can_write(name)
);

drop policy if exists "digital po temp participant update" on storage.objects;
create policy "digital po temp participant update"
on storage.objects for update to authenticated
using (
  bucket_id = 'digital-po-temp'
  and jgc_private.digital_po_storage_can_write(name)
)
with check (
  bucket_id = 'digital-po-temp'
  and jgc_private.digital_po_storage_can_write(name)
);

insert into public.notification_settings (
  notification_type,
  label,
  description,
  employee_enabled,
  supervisor_enabled,
  admin_enabled
) values (
  'digital_po_assigned',
  'Digital PO assignments',
  'A digital purchase order was assigned or reassigned to you.',
  true,
  true,
  true
)
on conflict (notification_type) do update
set label = excluded.label,
    description = excluded.description,
    employee_enabled = true,
    supervisor_enabled = true,
    admin_enabled = true,
    updated_at = now();

create or replace function public.digital_po_work_order_options(
  p_job_id uuid,
  p_order_date date,
  p_work_order_id uuid default null
)
returns table (
  id uuid,
  po_number bigint,
  supplier_name text,
  order_date date,
  creator_name text,
  assigned_name text,
  material_count bigint,
  receipt_attached boolean,
  workflow_status text,
  email_status text,
  linked_work_order_id uuid
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_job_number text;
begin
  if not jgc_private.digital_po_is_work_order_manager() then
    raise exception 'Supervisor or admin access is required to review digital POs for Work Orders.' using errcode = '42501';
  end if;
  if p_job_id is null or p_order_date is null then
    return;
  end if;

  select j.job_number into v_job_number
  from public.jobs j
  where j.id = p_job_id;
  if not found then
    raise exception 'The selected job was not found.' using errcode = 'P0002';
  end if;

  if p_work_order_id is not null and not exists (
    select 1 from public.work_orders w
    where w.id = p_work_order_id and w.job_id = p_job_id
  ) then
    raise exception 'The Work Order does not belong to the selected job.' using errcode = '23514';
  end if;

  return query
  select
    po.id,
    po.po_number,
    po.supplier_name,
    po.order_date,
    po.creator_name,
    po.assigned_name,
    count(i.id)::bigint,
    po.receipt_attached,
    po.workflow_status,
    po.email_status,
    l.work_order_id
  from public.digital_purchase_orders po
  left join public.digital_po_items i on i.po_id = po.id
  left join public.digital_po_work_order_links l on l.po_id = po.id
  where (
      po.job_id = p_job_id
      or (
        po.job_id is null
        and upper(regexp_replace(coalesce(po.job_number, ''), '[^A-Za-z0-9]', '', 'g'))
          = upper(regexp_replace(coalesce(v_job_number, ''), '[^A-Za-z0-9]', '', 'g'))
      )
    )
    and po.order_date = p_order_date
    and po.workflow_status <> 'cancelled'
    and (l.work_order_id is null or l.work_order_id = p_work_order_id)
  group by po.id, l.work_order_id
  order by po.po_number;
end;
$$;

revoke all on function public.digital_po_work_order_options(uuid, date, uuid) from public, anon;
grant execute on function public.digital_po_work_order_options(uuid, date, uuid) to authenticated;

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

select cron.unschedule(jobid)
from cron.job
where jobname = 'jgc-digital-po-email-worker';

select cron.schedule(
  'jgc-digital-po-email-worker',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'jgc_project_url') || '/functions/v1/send-digital-po-email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'jgc_publishable_key'),
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'jgc_publishable_key')
    ),
    body := jsonb_build_object('source', 'pg_cron', 'scheduled_at', now())
  ) as request_id;
  $$
);
