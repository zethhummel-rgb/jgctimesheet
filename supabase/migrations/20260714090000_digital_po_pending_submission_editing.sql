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
      and (
        (
          po.workflow_status in ('draft', 'assigned', 'opened', 'ready_to_submit')
          and (
            po.creator_profile_id = (select auth.uid())
            or po.assigned_profile_id = (select auth.uid())
            or jgc_private.digital_po_is_admin()
          )
        )
        or (
          po.workflow_status = 'submitted'
          and po.email_status = 'pending'
          and exists (
            select 1
            from public.digital_po_email_outbox outbox
            where outbox.po_id = po.id
              and outbox.submission_sequence = po.submission_sequence
              and outbox.delivery_status = 'pending'
              and outbox.next_attempt_at > now()
          )
          and (
            po.creator_profile_id = (select auth.uid())
            or jgc_private.digital_po_is_admin()
          )
        )
      )
  );
$$;

create or replace function public.digital_po_update_pending(
  p_order jsonb,
  p_items jsonb,
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
  v_job public.jobs%rowtype;
  v_po_id uuid;
  v_job_id uuid;
  v_order_date date;
  v_supplier_name text;
  v_item jsonb;
  v_item_id uuid;
  v_item_count integer := 0;
begin
  if p_order is null or jsonb_typeof(p_order) <> 'object' or p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'PO details and materials are required.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 100 then
    raise exception 'Enter between 1 and 100 material rows.' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_items) item where coalesce(trim(item->>'description'), '') = '') then
    raise exception 'Every material row needs a description.' using errcode = '22023';
  end if;

  begin
    v_po_id := (p_order->>'id')::uuid;
    v_job_id := (p_order->>'job_id')::uuid;
    v_order_date := (p_order->>'order_date')::date;
  exception when others then
    raise exception 'A valid PO, job, and order date are required.' using errcode = '22023';
  end;

  select * into v_profile from public.profiles where id = v_user_id and account_status = 'approved';
  if not found then
    raise exception 'This portal account is not active.' using errcode = '42501';
  end if;

  select * into v_po from public.digital_purchase_orders where id = v_po_id for update;
  if not found then
    raise exception 'PO was not found.' using errcode = 'P0002';
  end if;
  if v_po.creator_profile_id <> v_user_id and not jgc_private.digital_po_is_admin() then
    raise exception 'Only the PO creator can edit a pending submission.' using errcode = '42501';
  end if;
  if v_po.workflow_status <> 'submitted' or v_po.email_status <> 'pending' or not exists (
    select 1 from public.digital_po_email_outbox outbox
    where outbox.po_id = v_po.id
      and outbox.submission_sequence = v_po.submission_sequence
      and outbox.delivery_status = 'pending'
      and outbox.next_attempt_at > now()
  ) then
    raise exception 'This PO is no longer pending submission and cannot be changed.' using errcode = '55000';
  end if;
  if p_expected_revision is null or p_expected_revision <> v_po.revision then
    raise exception 'This PO changed on another device. Refresh it before saving.' using errcode = '40001';
  end if;
  if p_pdf_storage_path is null or p_pdf_storage_path <> v_po_id::text || '/current/po.pdf' or not exists (
    select 1 from storage.objects where bucket_id = 'digital-po-temp' and name = p_pdf_storage_path
  ) then
    raise exception 'The updated PO PDF could not be verified.' using errcode = '23514';
  end if;
  if p_receipt_storage_path is not null and (
    p_receipt_storage_path <> v_po_id::text || '/current/receipt.jpg'
    or not exists (select 1 from storage.objects where bucket_id = 'digital-po-temp' and name = p_receipt_storage_path)
  ) then
    raise exception 'The updated receipt could not be verified.' using errcode = '23514';
  end if;

  select * into v_job from public.jobs where id = v_job_id;
  if not found then
    raise exception 'The selected job no longer exists.' using errcode = '23503';
  end if;
  v_supplier_name := left(coalesce(trim(p_order->>'supplier_name'), ''), 240);
  if v_supplier_name = '' then
    raise exception 'Supplier is required before saving.' using errcode = '23514';
  end if;

  perform set_config('jgc.actor_name', v_profile.display_name, true);
  if v_job.id is distinct from v_po.job_id or v_order_date is distinct from v_po.order_date then
    delete from public.digital_po_work_order_links where po_id = v_po.id;
  end if;

  update public.digital_purchase_orders
  set job_id = v_job.id,
      job_number = v_job.job_number,
      job_name = v_job.job_name,
      supplier_id = null,
      supplier_name = v_supplier_name,
      order_date = v_order_date,
      notes = left(coalesce(p_order->>'notes', ''), 5000),
      pdf_storage_path = p_pdf_storage_path,
      receipt_status = case when p_receipt_storage_path is null then receipt_status else 'uploaded_temp' end,
      receipt_attached = case when p_receipt_storage_path is null then receipt_attached else true end,
      receipt_storage_path = coalesce(p_receipt_storage_path, receipt_storage_path),
      receipt_uploaded_at = case when p_receipt_storage_path is null then receipt_uploaded_at else now() end,
      receipt_uploaded_by = case when p_receipt_storage_path is null then receipt_uploaded_by else v_user_id end,
      receipt_uploaded_by_name = case when p_receipt_storage_path is null then receipt_uploaded_by_name else v_profile.display_name end,
      receipt_original_filename = case when p_receipt_storage_path is null then receipt_original_filename else left(coalesce(p_receipt_original_filename, 'receipt.jpg'), 240) end,
      last_edited_by_profile_id = v_user_id,
      last_edited_by_name = v_profile.display_name,
      last_edited_at = now(),
      revision = revision + 1,
      updated_at = now()
  where id = v_po.id
  returning * into v_saved;

  delete from public.digital_po_items where po_id = v_po.id;
  for v_item in select value from jsonb_array_elements(p_items)
  loop
    begin
      v_item_id := coalesce(nullif(v_item->>'id', '')::uuid, gen_random_uuid());
    exception when others then
      v_item_id := gen_random_uuid();
    end;
    insert into public.digital_po_items (id, po_id, quantity_ordered, description, sort_order)
    values (
      v_item_id,
      v_po.id,
      nullif(trim(v_item->>'quantity_ordered'), '')::numeric,
      trim(v_item->>'description'),
      v_item_count
    );
    v_item_count := v_item_count + 1;
  end loop;

  return v_saved;
end;
$$;

revoke all on function public.digital_po_update_pending(jsonb, jsonb, integer, text, text, text) from public, anon;
grant execute on function public.digital_po_update_pending(jsonb, jsonb, integer, text, text, text) to authenticated;
