-- Equipment QR inspection setup.
--
-- Run this once in Supabase SQL Editor after deploying the matching website files.
-- It adds a token to each equipment row, lets admins generate QR links, and lets
-- anonymous QR scans read/submit inspections for only the tokenized unit.

alter table public.equipment_vehicles
  add column if not exists inspection_qr_token text;

alter table public.equipment_vehicles
  add column if not exists inspection_qr_type text;

alter table public.inspection_records
  add column if not exists equipment_id uuid references public.equipment_vehicles(id) on delete set null;

alter table public.inspection_records
  add column if not exists equipment_name text;

alter table public.inspection_records
  add column if not exists equipment_identification text;

alter table public.inspection_records
  add column if not exists public_submission boolean default false;

alter table public.inspection_records
  add column if not exists public_submission_source text;

alter table public.inspection_records
  add column if not exists inspection_qr_token text;

create unique index if not exists equipment_vehicles_inspection_qr_token_idx
  on public.equipment_vehicles (inspection_qr_token)
  where inspection_qr_token is not null;

create index if not exists inspection_records_equipment_date_idx
  on public.inspection_records (equipment_id, inspection_date desc, created_at desc);

create index if not exists inspection_records_qr_token_date_idx
  on public.inspection_records (inspection_qr_token, inspection_date desc, created_at desc)
  where inspection_qr_token is not null;

create or replace function public.infer_equipment_inspection_type(
  p_name text,
  p_type text,
  p_identification text,
  p_notes text
)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when lower(coalesce(p_name, '') || ' ' || coalesce(p_type, '') || ' ' || coalesce(p_identification, '') || ' ' || coalesce(p_notes, '')) ~ '(telehandler|tele-handler|tele handler)' then 'Tele Handler'
    when lower(coalesce(p_name, '') || ' ' || coalesce(p_type, '') || ' ' || coalesce(p_identification, '') || ' ' || coalesce(p_notes, '')) ~ '(forklift|fork lift)' then 'Fork Lift'
    when lower(coalesce(p_name, '') || ' ' || coalesce(p_type, '') || ' ' || coalesce(p_identification, '') || ' ' || coalesce(p_notes, '')) ~ '(aerial|scissor|boom|man lift|manlift|lift)' then 'Aerial Lifts'
    else null
  end;
$$;

create or replace function public.ensure_equipment_inspection_qr_token(
  p_equipment_id uuid
)
returns table (
  token text,
  inspection_type text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_equipment public.equipment_vehicles%rowtype;
  v_token text;
  v_inspection_type text;
  v_is_admin boolean := false;
begin
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and coalesce(p.account_status, 'approved') not in ('pending', 'inactive')
      and (
        coalesce(p.role, '') = 'admin'
        or lower(coalesce(p.email, '')) in ('zeth@johngordonconstruction.com', 'jeff@johngordonconstruction.com')
      )
  ) into v_is_admin;

  if not v_is_admin then
    raise exception 'Only admin accounts can create equipment QR codes.';
  end if;

  select *
    into v_equipment
  from public.equipment_vehicles e
  where e.id = p_equipment_id
    and coalesce(e.is_active, true) = true
  limit 1;

  if not found then
    raise exception 'Equipment could not be found.';
  end if;

  v_inspection_type := coalesce(
    nullif(v_equipment.inspection_qr_type, ''),
    public.infer_equipment_inspection_type(
      v_equipment.name,
      v_equipment.equipment_type,
      v_equipment.identification_number,
      v_equipment.notes
    )
  );

  if v_inspection_type is null then
    raise exception 'This item does not match a Fork Lift, Aerial Lift, or Tele Handler inspection.';
  end if;

  v_token := nullif(v_equipment.inspection_qr_token, '');

  if v_token is null then
    v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  end if;

  update public.equipment_vehicles
  set inspection_qr_token = v_token,
      inspection_qr_type = v_inspection_type,
      updated_at = now()
  where id = v_equipment.id;

  return query select v_token, v_inspection_type;
end;
$$;

create or replace function public.get_public_equipment_inspection(
  p_token text
)
returns table (
  equipment_id uuid,
  equipment_name text,
  equipment_identification text,
  equipment_type text,
  inspection_type text,
  current_hours numeric,
  today_inspection jsonb,
  employees jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  clean_token text := trim(coalesce(p_token, ''));
begin
  if length(clean_token) < 24 then
    return;
  end if;

  return query
  select
    e.id,
    e.name::text,
    coalesce(e.identification_number, '')::text,
    coalesce(e.equipment_type, '')::text,
    coalesce(
      nullif(e.inspection_qr_type, ''),
      public.infer_equipment_inspection_type(e.name, e.equipment_type, e.identification_number, e.notes)
    )::text,
    e.current_hours::numeric,
    (
      select jsonb_build_object(
        'id', r.id,
        'inspection_type', r.inspection_type,
        'inspection_date', r.inspection_date,
        'worker_name', r.worker_name,
        'worker_display_name', r.worker_display_name,
        'created_at', r.created_at,
        'summary', coalesce(r.summary, '{}'::jsonb),
        'form_data', coalesce(r.form_data, '{}'::jsonb),
        'equipment_name', coalesce(r.equipment_name, e.name),
        'equipment_identification', coalesce(r.equipment_identification, e.identification_number, '')
      )
      from public.inspection_records r
      where r.inspection_date = current_date
        and (
          r.equipment_id = e.id
          or r.inspection_qr_token = clean_token
          or exists (
            select 1
            from jsonb_array_elements(
              case
                when jsonb_typeof(r.form_data->'fields') = 'array' then r.form_data->'fields'
                else '[]'::jsonb
              end
            ) field_row
            where lower(trim(field_row->>'value')) in (
              lower(trim(coalesce(e.name, ''))),
              lower(trim(coalesce(e.identification_number, ''))),
              lower(trim(coalesce(e.identification_number, '') || ' - ' || coalesce(e.name, ''))),
              lower(trim(coalesce(e.name, '') || ' - ' || coalesce(e.identification_number, '')))
            )
          )
        )
      order by r.created_at desc
      limit 1
    ) as today_inspection,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'display_name', p.display_name,
            'worker_key', p.worker_key
          )
          order by p.display_name
        )
        from public.profiles p
        where coalesce(p.account_status, 'approved') not in ('pending', 'inactive')
          and coalesce(p.role, 'worker') <> 'subcontractor'
          and nullif(trim(coalesce(p.display_name, '')), '') is not null
      ),
      '[]'::jsonb
    ) as employees
  from public.equipment_vehicles e
  where e.inspection_qr_token = clean_token
    and coalesce(e.is_active, true) = true
  limit 1;
end;
$$;

create or replace function public.submit_public_equipment_inspection(
  p_token text,
  p_inspector_name text,
  p_inspector_employee_key text,
  p_inspector_company text,
  p_inspection_type text,
  p_inspection_date date,
  p_form_data jsonb,
  p_summary jsonb,
  p_email_body text,
  p_current_hours numeric default null
)
returns table (
  success boolean,
  message text,
  record_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  clean_token text := trim(coalesce(p_token, ''));
  clean_name text := nullif(trim(coalesce(p_inspector_name, '')), '');
  clean_employee_key text := nullif(trim(coalesce(p_inspector_employee_key, '')), '');
  clean_company text := nullif(trim(coalesce(p_inspector_company, '')), '');
  v_equipment public.equipment_vehicles%rowtype;
  v_inspection_type text;
  v_date date := coalesce(p_inspection_date, current_date);
  v_worker_name text;
  v_existing_id uuid;
  v_record_id uuid;
begin
  if length(clean_token) < 24 then
    return query select false, 'Invalid equipment inspection link.'::text, null::uuid;
    return;
  end if;

  if clean_name is null or length(clean_name) < 2 then
    return query select false, 'Enter the inspector name.'::text, null::uuid;
    return;
  end if;

  select *
    into v_equipment
  from public.equipment_vehicles e
  where e.inspection_qr_token = clean_token
    and coalesce(e.is_active, true) = true
  limit 1;

  if not found then
    return query select false, 'Equipment could not be found for this QR code.'::text, null::uuid;
    return;
  end if;

  v_inspection_type := coalesce(
    nullif(v_equipment.inspection_qr_type, ''),
    public.infer_equipment_inspection_type(
      v_equipment.name,
      v_equipment.equipment_type,
      v_equipment.identification_number,
      v_equipment.notes
    ),
    nullif(trim(coalesce(p_inspection_type, '')), '')
  );

  if v_inspection_type is null then
    return query select false, 'This equipment does not have a supported inspection type.'::text, null::uuid;
    return;
  end if;

  select r.id
    into v_existing_id
  from public.inspection_records r
  where r.equipment_id = v_equipment.id
    and r.inspection_date = v_date
    and lower(coalesce(r.worker_display_name, '')) = lower(clean_name)
    and r.created_at > now() - interval '15 minutes'
  order by r.created_at desc
  limit 1;

  if v_existing_id is not null then
    return query select true, 'This inspection was already saved.'::text, v_existing_id;
    return;
  end if;

  v_worker_name := coalesce(
    clean_employee_key,
    'equipment_qr:' || lower(regexp_replace(clean_name || '|' || coalesce(clean_company, ''), '[^a-zA-Z0-9@._-]+', '-', 'g'))
  );

  insert into public.inspection_records (
    worker_name,
    worker_display_name,
    inspection_type,
    inspection_date,
    title,
    summary,
    form_data,
    email_body,
    equipment_id,
    equipment_name,
    equipment_identification,
    public_submission,
    public_submission_source,
    inspection_qr_token
  ) values (
    v_worker_name,
    clean_name,
    v_inspection_type,
    v_date,
    v_inspection_type || ' - ' || v_date::text,
    coalesce(p_summary, '{}'::jsonb) || jsonb_build_object(
      'completed_by', clean_name,
      'company', coalesce(clean_company, ''),
      'public_submission', true,
      'public_submission_source', 'equipment_qr',
      'equipment_id', v_equipment.id,
      'equipment_name', v_equipment.name,
      'equipment_identification', coalesce(v_equipment.identification_number, '')
    ),
    coalesce(p_form_data, '{}'::jsonb) || jsonb_build_object(
      'public_submission', true,
      'public_submission_source', 'equipment_qr',
      'equipment', jsonb_build_object(
        'id', v_equipment.id,
        'name', v_equipment.name,
        'identification_number', coalesce(v_equipment.identification_number, ''),
        'equipment_type', coalesce(v_equipment.equipment_type, ''),
        'current_hours', p_current_hours
      )
    ),
    coalesce(p_email_body, ''),
    v_equipment.id,
    v_equipment.name,
    coalesce(v_equipment.identification_number, ''),
    true,
    'equipment_qr',
    clean_token
  )
  returning id into v_record_id;

  if p_current_hours is not null and p_current_hours >= 0 then
    update public.equipment_vehicles
    set current_hours = p_current_hours,
        updated_at = now()
    where id = v_equipment.id;
  end if;

  return query select true, 'Inspection saved.'::text, v_record_id;
end;
$$;

revoke all on function public.infer_equipment_inspection_type(text, text, text, text) from public;
revoke all on function public.ensure_equipment_inspection_qr_token(uuid) from public;
revoke all on function public.get_public_equipment_inspection(text) from public;
revoke all on function public.submit_public_equipment_inspection(text, text, text, text, text, date, jsonb, jsonb, text, numeric) from public;

grant execute on function public.ensure_equipment_inspection_qr_token(uuid) to authenticated;
grant execute on function public.get_public_equipment_inspection(text) to anon, authenticated;
grant execute on function public.submit_public_equipment_inspection(text, text, text, text, text, date, jsonb, jsonb, text, numeric) to anon, authenticated;
