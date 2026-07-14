create or replace function public.digital_po_work_order_counts(p_work_order_ids uuid[])
returns table (
  work_order_id uuid,
  po_count bigint
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if not jgc_private.digital_po_is_work_order_manager() then
    raise exception 'Supervisor or admin access is required to review digital PO counts.' using errcode = '42501';
  end if;

  return query
  select
    link.work_order_id,
    count(*)::bigint as po_count
  from public.digital_po_work_order_links as link
  where link.work_order_id = any(coalesce(p_work_order_ids, array[]::uuid[]))
  group by link.work_order_id;
end;
$$;

revoke all on function public.digital_po_work_order_counts(uuid[]) from public, anon;
grant execute on function public.digital_po_work_order_counts(uuid[]) to authenticated;
