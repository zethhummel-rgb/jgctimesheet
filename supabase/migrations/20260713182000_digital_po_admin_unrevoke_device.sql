create or replace function public.digital_po_admin_unrevoke_device(p_device_id uuid, p_lease_days integer default 30)
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
      select 1 from public.profiles p
      where p.id = d.profile_id
        and p.account_status = 'approved'
        and p.can_create_digital_pos
    )
    and exists (
      select 1 from public.digital_po_number_blocks b
      where b.device_id = d.id and b.status in ('active', 'exhausted')
    )
  returning * into v_device;

  if not found then
    raise exception 'Device cannot be restored until its user is approved and it has a number block.' using errcode = 'P0002';
  end if;

  return v_device;
end;
$$;

revoke all on function public.digital_po_admin_unrevoke_device(uuid, integer) from public, anon;
grant execute on function public.digital_po_admin_unrevoke_device(uuid, integer) to authenticated, service_role;
