-- Adds covering indexes for Digital Purchase Order audit and administration
-- foreign keys. The full setup script also includes these indexes for fresh
-- installations.

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
