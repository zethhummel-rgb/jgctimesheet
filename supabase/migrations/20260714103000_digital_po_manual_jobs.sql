-- Manual PO jobs are intentionally not linked to the portal job list or Work Orders.
alter table public.digital_purchase_orders
  alter column job_id drop not null;

create or replace function public.digital_po_save_manual(
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
  v_po_id uuid;
  v_device_token uuid;
  v_block_id uuid;
  v_po_number bigint;
  v_client_created_at timestamptz;
  v_order_date date;
  v_job_number text;
  v_job_name text;
  v_supplier_name text;
  v_item jsonb;
  v_item_id uuid;
  v_item_count integer := 0;
begin
  if v_user_id is null then
    raise exception 'Sign in is required.' using errcode = '28000';
  end if;
  if p_order is null or jsonb_typeof(p_order) <> 'object' or p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'PO details and material rows are required.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) > 100 then
    raise exception 'A PO can contain at most 100 material rows.' using errcode = '22023';
  end if;
  if nullif(p_order->>'job_id', '') is not null then
    raise exception 'Use the standard PO save function for a listed job.' using errcode = '22023';
  end if;

  begin
    v_po_id := (p_order->>'id')::uuid;
    v_order_date := (p_order->>'order_date')::date;
  exception when others then
    raise exception 'A valid PO and order date are required.' using errcode = '22023';
  end;
  v_job_number := left(coalesce(trim(p_order->>'job_number'), ''), 120);
  v_job_name := left(coalesce(trim(p_order->>'job_name'), ''), 240);
  v_supplier_name := left(coalesce(trim(p_order->>'supplier_name'), ''), 240);
  if v_job_number = '' or v_job_name = '' then
    raise exception 'Both a manual job number and job name are required.' using errcode = '23514';
  end if;

  select * into v_profile from public.profiles where id = v_user_id and account_status = 'approved';
  if not found then
    raise exception 'This portal account is not active.' using errcode = '42501';
  end if;
  select * into v_existing from public.digital_purchase_orders where id = v_po_id for update;

  if not found then
    if not v_profile.can_create_digital_pos then
      raise exception 'This account is not approved to create digital POs.' using errcode = '42501';
    end if;
    begin
      v_device_token := (p_order->>'device_token')::uuid;
      v_block_id := (p_order->>'number_block_id')::uuid;
      v_po_number := (p_order->>'po_number')::bigint;
      v_client_created_at := (p_order->>'client_created_at')::timestamptz;
    exception when others then
      raise exception 'PO number, device, and creation time are required.' using errcode = '22023';
    end;
    select * into v_device from public.digital_po_devices
      where device_token = v_device_token and profile_id = v_user_id for update;
    if not found or v_device.status <> 'active' then
      raise exception 'This device is not approved to issue digital POs.' using errcode = '42501';
    end if;
    if v_device.lease_expires_at is null or v_client_created_at > v_device.lease_expires_at or v_client_created_at > now() + interval '10 minutes' then
      raise exception 'The offline PO authorization lease was not valid when this number was issued.' using errcode = '42501';
    end if;
    select * into v_block from public.digital_po_number_blocks
      where id = v_block_id and device_id = v_device.id and profile_id = v_user_id and status in ('active', 'exhausted') for update;
    if not found or v_client_created_at < v_block.assigned_at - interval '10 minutes' or v_po_number < v_block.range_start or v_po_number > v_block.range_end then
      raise exception 'The assigned PO number block is not valid for this device.' using errcode = '42501';
    end if;
    perform set_config('jgc.actor_name', v_profile.display_name, true);
    insert into public.digital_purchase_orders (
      id, po_number, number_block_id, device_id, creator_profile_id, creator_name,
      job_id, job_number, job_name, supplier_id, supplier_name, order_date, notes,
      workflow_status, email_status, receipt_status, origin, client_created_at
    ) values (
      v_po_id, v_po_number, v_block.id, v_device.id, v_user_id, v_profile.display_name,
      null, v_job_number, v_job_name, null, v_supplier_name, v_order_date, left(coalesce(p_order->>'notes', ''), 5000),
      'draft', 'not_ready', 'none', case when coalesce(p_order->>'origin', 'online') = 'offline' then 'offline' else 'online' end, v_client_created_at
    ) returning * into v_saved;
    update public.digital_po_number_blocks
      set next_number = greatest(next_number, v_po_number + 1),
          status = case when greatest(next_number, v_po_number + 1) > range_end then 'exhausted' else status end
      where id = v_block.id;
  else
    if v_existing.creator_profile_id <> v_user_id and not jgc_private.digital_po_is_admin() then
      raise exception 'You do not have access to edit this PO.' using errcode = '42501';
    end if;
    if v_existing.workflow_status not in ('draft', 'assigned', 'opened', 'ready_to_submit') then
      raise exception 'This PO is locked. An admin must reopen it before changes can be made.' using errcode = '55000';
    end if;
    if p_expected_revision is null or p_expected_revision <> v_existing.revision then
      raise exception 'This PO changed on another device. Reload it before saving.' using errcode = '40001';
    end if;
    perform set_config('jgc.actor_name', v_profile.display_name, true);
    delete from public.digital_po_work_order_links where po_id = v_existing.id;
    update public.digital_purchase_orders
      set job_id = null, job_number = v_job_number, job_name = v_job_name,
          supplier_id = null, supplier_name = v_supplier_name, order_date = v_order_date,
          notes = left(coalesce(p_order->>'notes', ''), 5000), revision = revision + 1
      where id = v_existing.id returning * into v_saved;
    delete from public.digital_po_items where po_id = v_existing.id;
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    if nullif(trim(v_item->>'description'), '') is null then continue; end if;
    begin v_item_id := coalesce(nullif(v_item->>'id', '')::uuid, gen_random_uuid());
    exception when others then v_item_id := gen_random_uuid(); end;
    insert into public.digital_po_items (id, po_id, quantity_ordered, quantity_received, stock_number, description, notes, sort_order)
    values (v_item_id, v_saved.id, nullif(v_item->>'quantity_ordered', '')::numeric,
      nullif(v_item->>'quantity_received', '')::numeric, left(coalesce(v_item->>'stock_number', ''), 120),
      left(trim(v_item->>'description'), 1000), left(coalesce(v_item->>'notes', ''), 2000), v_item_count);
    v_item_count := v_item_count + 1;
  end loop;
  return v_saved;
end;
$$;

create or replace function public.digital_po_update_pending_manual(
  p_order jsonb, p_items jsonb, p_expected_revision integer, p_pdf_storage_path text,
  p_receipt_storage_path text default null, p_receipt_original_filename text default null
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
  v_po_id uuid;
  v_order_date date;
  v_job_number text;
  v_job_name text;
  v_supplier_name text;
  v_item jsonb;
  v_item_id uuid;
  v_item_count integer := 0;
begin
  if p_order is null or jsonb_typeof(p_order) <> 'object' or p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 100 then
    raise exception 'PO details and between 1 and 100 material rows are required.' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_items) item where coalesce(trim(item->>'description'), '') = '') then
    raise exception 'Every material row needs a description.' using errcode = '22023';
  end if;
  begin v_po_id := (p_order->>'id')::uuid; v_order_date := (p_order->>'order_date')::date;
  exception when others then raise exception 'A valid PO and order date are required.' using errcode = '22023'; end;
  if nullif(p_order->>'job_id', '') is not null then
    raise exception 'Use the standard pending-update function for a listed job.' using errcode = '22023';
  end if;
  v_job_number := left(coalesce(trim(p_order->>'job_number'), ''), 120);
  v_job_name := left(coalesce(trim(p_order->>'job_name'), ''), 240);
  v_supplier_name := left(coalesce(trim(p_order->>'supplier_name'), ''), 240);
  if v_job_number = '' or v_job_name = '' or v_supplier_name = '' then
    raise exception 'Manual job number, manual job name, and supplier are required.' using errcode = '23514';
  end if;
  select * into v_profile from public.profiles where id = v_user_id and account_status = 'approved';
  if not found then raise exception 'This portal account is not active.' using errcode = '42501'; end if;
  select * into v_po from public.digital_purchase_orders where id = v_po_id for update;
  if not found then raise exception 'PO was not found.' using errcode = 'P0002'; end if;
  if v_po.creator_profile_id <> v_user_id and not jgc_private.digital_po_is_admin() then raise exception 'Only the PO creator can edit a pending submission.' using errcode = '42501'; end if;
  if v_po.workflow_status <> 'submitted' or v_po.email_status <> 'pending' or not exists (
    select 1 from public.digital_po_email_outbox outbox where outbox.po_id = v_po.id and outbox.submission_sequence = v_po.submission_sequence and outbox.delivery_status = 'pending' and outbox.next_attempt_at > now()
  ) then raise exception 'This PO is no longer pending submission and cannot be changed.' using errcode = '55000'; end if;
  if p_expected_revision is null or p_expected_revision <> v_po.revision then raise exception 'This PO changed on another device. Refresh it before saving.' using errcode = '40001'; end if;
  if p_pdf_storage_path is null or p_pdf_storage_path <> v_po_id::text || '/current/po.pdf' or not exists (select 1 from storage.objects where bucket_id = 'digital-po-temp' and name = p_pdf_storage_path) then raise exception 'The updated PO PDF could not be verified.' using errcode = '23514'; end if;
  if p_receipt_storage_path is not null and (p_receipt_storage_path <> v_po_id::text || '/current/receipt.jpg' or not exists (select 1 from storage.objects where bucket_id = 'digital-po-temp' and name = p_receipt_storage_path)) then raise exception 'The updated receipt could not be verified.' using errcode = '23514'; end if;
  perform set_config('jgc.actor_name', v_profile.display_name, true);
  delete from public.digital_po_work_order_links where po_id = v_po.id;
  update public.digital_purchase_orders set
    job_id = null, job_number = v_job_number, job_name = v_job_name,
    supplier_id = null, supplier_name = v_supplier_name, order_date = v_order_date,
    notes = left(coalesce(p_order->>'notes', ''), 5000), pdf_storage_path = p_pdf_storage_path,
    receipt_status = case when p_receipt_storage_path is null then receipt_status else 'uploaded_temp' end,
    receipt_attached = case when p_receipt_storage_path is null then receipt_attached else true end,
    receipt_storage_path = coalesce(p_receipt_storage_path, receipt_storage_path),
    receipt_uploaded_at = case when p_receipt_storage_path is null then receipt_uploaded_at else now() end,
    receipt_uploaded_by = case when p_receipt_storage_path is null then receipt_uploaded_by else v_user_id end,
    receipt_uploaded_by_name = case when p_receipt_storage_path is null then receipt_uploaded_by_name else v_profile.display_name end,
    receipt_original_filename = case when p_receipt_storage_path is null then receipt_original_filename else left(coalesce(p_receipt_original_filename, 'receipt.jpg'), 240) end,
    last_edited_by_profile_id = v_user_id, last_edited_by_name = v_profile.display_name, last_edited_at = now(), revision = revision + 1, updated_at = now()
  where id = v_po.id returning * into v_saved;
  delete from public.digital_po_items where po_id = v_po.id;
  for v_item in select value from jsonb_array_elements(p_items)
  loop
    begin v_item_id := coalesce(nullif(v_item->>'id', '')::uuid, gen_random_uuid()); exception when others then v_item_id := gen_random_uuid(); end;
    insert into public.digital_po_items (id, po_id, quantity_ordered, description, sort_order)
    values (v_item_id, v_po.id, nullif(trim(v_item->>'quantity_ordered'), '')::numeric, trim(v_item->>'description'), v_item_count);
    v_item_count := v_item_count + 1;
  end loop;
  return v_saved;
end;
$$;

revoke all on function public.digital_po_save_manual(jsonb, jsonb, integer) from public, anon;
grant execute on function public.digital_po_save_manual(jsonb, jsonb, integer) to authenticated;
revoke all on function public.digital_po_update_pending_manual(jsonb, jsonb, integer, text, text, text) from public, anon;
grant execute on function public.digital_po_update_pending_manual(jsonb, jsonb, integer, text, text, text) to authenticated;
