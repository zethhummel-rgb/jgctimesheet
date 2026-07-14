-- Used only by the server-side PO testing delete action. Browser roles have no access.
create or replace function public.digital_po_admin_delete_test(p_po_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  delete from public.digital_po_work_order_links where po_id = p_po_id;
  delete from public.digital_po_email_outbox where po_id = p_po_id;
  delete from public.digital_po_items where po_id = p_po_id;
  delete from public.digital_po_audit_log where po_id = p_po_id;
  delete from public.digital_purchase_orders where id = p_po_id;

  if not found then
    raise exception 'Purchase order not found.';
  end if;
end;
$$;

alter function public.digital_po_admin_delete_test(uuid) owner to postgres;
revoke all on function public.digital_po_admin_delete_test(uuid) from public, anon, authenticated;
grant execute on function public.digital_po_admin_delete_test(uuid) to service_role;
