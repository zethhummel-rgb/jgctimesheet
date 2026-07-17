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

revoke all on function public.digital_po_link_work_orders(uuid, uuid[]) from public, anon;
grant execute on function public.digital_po_link_work_orders(uuid, uuid[]) to authenticated;
