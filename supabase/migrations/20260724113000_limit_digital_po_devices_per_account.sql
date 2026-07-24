-- Digital PO numbers are reserved per device so offline devices cannot issue
-- duplicate numbers. Admins may use two devices (desktop and phone); other
-- accounts may use one. A device may only hold one live range at a time.

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
  v_device_limit integer;
  v_active_slot_count integer;
begin
  if v_user_id is null then
    raise exception 'Sign in is required.' using errcode = '28000';
  end if;

  select * into v_profile
  from public.profiles
  where id = v_user_id;

  if not found or v_profile.account_status <> 'approved' then
    raise exception 'This portal account is not active.' using errcode = '42501';
  end if;
  if not v_profile.can_create_digital_pos then
    raise exception 'This account is not approved to create digital POs.' using errcode = '42501';
  end if;

  -- Serialize new-device registrations for one account.
  perform pg_advisory_xact_lock(hashtextextended('jgc-digital-po-device-slots:' || v_user_id::text, 0));

  select * into v_device
  from public.digital_po_devices
  where device_token = p_device_token
  for update;

  if found then
    if v_device.profile_id <> v_user_id then
      raise exception 'This device registration belongs to another account.' using errcode = '42501';
    end if;
    if v_device.status = 'revoked' then
      raise exception 'This PO device was revoked. An admin must restore or replace it before it can create POs.' using errcode = '42501';
    end if;

    update public.digital_po_devices
    set device_label = left(coalesce(nullif(trim(p_device_label), ''), device_label), 120),
        last_seen_at = now()
    where id = v_device.id
    returning * into v_device;

    return v_device;
  end if;

  v_device_limit := case when lower(coalesce(v_profile.role::text, '')) = 'admin' then 2 else 1 end;

  select count(*) into v_active_slot_count
  from public.digital_po_devices d
  where d.profile_id = v_user_id
    and d.status = 'active'
    and exists (
      select 1
      from public.digital_po_number_blocks b
      where b.device_id = d.id
        and b.status in ('active', 'exhausted')
    );

  if v_active_slot_count >= v_device_limit then
    raise exception 'This account already has its maximum active PO devices (% for admins, 1 for other accounts). Revoke or replace an existing PO device before registering another.', v_device_limit
      using errcode = '42501';
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
  v_profile public.profiles%rowtype;
  v_block public.digital_po_number_blocks%rowtype;
  v_device_limit integer;
  v_active_slot_count integer;
  v_device_has_slot boolean;
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

  select * into v_profile
  from public.profiles
  where id = v_device.profile_id;

  if not found or v_profile.account_status <> 'approved' or not v_profile.can_create_digital_pos then
    raise exception 'The device owner is not approved to create digital POs.' using errcode = '42501';
  end if;

  -- A device keeps its live range until it is exhausted or revoked.
  if exists (
    select 1
    from public.digital_po_number_blocks b
    where b.device_id = v_device.id
      and b.status = 'active'
  ) then
    raise exception 'This device already has an active PO number block. Use or revoke that range before assigning another.' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('jgc-digital-po-device-slots:' || v_device.profile_id::text, 0));

  v_device_limit := case when lower(coalesce(v_profile.role::text, '')) = 'admin' then 2 else 1 end;

  select exists (
    select 1
    from public.digital_po_number_blocks b
    where b.device_id = v_device.id
      and b.status in ('active', 'exhausted')
  ) into v_device_has_slot;

  select count(*) into v_active_slot_count
  from public.digital_po_devices d
  where d.profile_id = v_device.profile_id
    and d.status = 'active'
    and exists (
      select 1
      from public.digital_po_number_blocks b
      where b.device_id = d.id
        and b.status in ('active', 'exhausted')
    );

  if not v_device_has_slot and v_active_slot_count >= v_device_limit then
    raise exception 'This account already has its maximum active PO devices (% for admins, 1 for other accounts). Revoke an existing PO device before assigning another block.', v_device_limit
      using errcode = '42501';
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

create or replace function public.digital_po_admin_unrevoke_device(
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
  v_profile public.profiles%rowtype;
  v_device_limit integer;
  v_active_slot_count integer;
begin
  if not jgc_private.digital_po_is_admin() then
    raise exception 'Admin access is required.' using errcode = '42501';
  end if;

  select * into v_device
  from public.digital_po_devices
  where id = p_device_id
  for update;

  if not found then
    raise exception 'PO device was not found.' using errcode = 'P0002';
  end if;

  select * into v_profile
  from public.profiles
  where id = v_device.profile_id;

  if not found or v_profile.account_status <> 'approved' or not v_profile.can_create_digital_pos then
    raise exception 'Device cannot be restored until its user is approved and can create digital POs.' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('jgc-digital-po-device-slots:' || v_device.profile_id::text, 0));

  v_device_limit := case when lower(coalesce(v_profile.role::text, '')) = 'admin' then 2 else 1 end;

  select count(*) into v_active_slot_count
  from public.digital_po_devices d
  where d.profile_id = v_device.profile_id
    and d.id <> v_device.id
    and d.status = 'active'
    and exists (
      select 1
      from public.digital_po_number_blocks b
      where b.device_id = d.id
        and b.status in ('active', 'exhausted')
    );

  if v_active_slot_count >= v_device_limit then
    raise exception 'This account already has its maximum active PO devices (% for admins, 1 for other accounts). Revoke an existing PO device before restoring this one.', v_device_limit
      using errcode = '42501';
  end if;

  update public.digital_po_number_blocks
  set status = case when next_number > range_end then 'exhausted' else 'active' end,
      revoked_at = null,
      revoked_by = null
  where device_id = p_device_id
    and status = 'revoked';

  update public.digital_po_devices d
  set status = 'active',
      lease_expires_at = now() + make_interval(days => greatest(1, least(coalesce(p_lease_days, 30), 90))),
      approved_at = coalesce(d.approved_at, now()),
      approved_by = coalesce(d.approved_by, (select auth.uid())),
      revoked_at = null,
      revoked_by = null
  where d.id = p_device_id
    and exists (
      select 1
      from public.digital_po_number_blocks b
      where b.device_id = d.id and b.status in ('active', 'exhausted')
    )
  returning * into v_device;

  if not found then
    raise exception 'Device cannot be restored until it has a number block.' using errcode = 'P0002';
  end if;

  return v_device;
end;
$$;
