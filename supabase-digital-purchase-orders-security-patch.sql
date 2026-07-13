-- Immediately removes Digital Purchase Order access from deactivated accounts.
-- The mutation trigger also protects SECURITY DEFINER RPCs from stale sessions.

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
revoke all on function jgc_private.digital_po_has_access(uuid) from public, anon;
revoke all on function jgc_private.digital_po_require_active_actor() from public, anon, authenticated;
grant execute on function jgc_private.digital_po_is_active_user() to authenticated, service_role;
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
