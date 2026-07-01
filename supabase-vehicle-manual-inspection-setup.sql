-- Manual employee vehicle / trailer inspection setup.
--
-- Run this in Supabase SQL Editor after deploying the matching website files.
-- It lets signed-in employees open Vehicle Inspections from the employee page,
-- select a vehicle/trailer manually, and save to the same vehicle_inspection_records
-- table used by QR inspections.

alter table public.equipment_vehicles
  add column if not exists current_km numeric;

create or replace function public.get_vehicle_manual_inspection_data()
returns table (
  vehicles jsonb,
  trailers jsonb,
  employees jsonb
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select auth.uid()) is null then
    return;
  end if;

  if not exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and coalesce(p.account_status, 'approved') not in ('pending', 'inactive')
  ) then
    return;
  end if;

  return query
  select
    coalesce(
      (
        select jsonb_agg(to_jsonb(e) order by coalesce(e.license_plate, e.unit_number, e.identification_number, e.name), e.name)
        from public.equipment_vehicles e
        where coalesce(e.is_active, true) = true
          and lower(coalesce(e.name, '') || ' ' || coalesce(e.equipment_type, '') || ' ' || coalesce(e.asset_category, '') || ' ' || coalesce(e.identification_number, '') || ' ' || coalesce(e.license_plate, '') || ' ' || coalesce(e.notes, '')) ~ '(truck|vehicle|trailer|trl|float|deck over|deckover|dump|pickup|van|chevy|ford|gmc|ram)'
      ),
      '[]'::jsonb
    ),
    coalesce(
      (
        select jsonb_agg(to_jsonb(e) order by coalesce(e.license_plate, e.unit_number, e.identification_number, e.name), e.name)
        from public.equipment_vehicles e
        where coalesce(e.is_active, true) = true
          and lower(coalesce(e.name, '') || ' ' || coalesce(e.equipment_type, '') || ' ' || coalesce(e.asset_category, '') || ' ' || coalesce(e.identification_number, '') || ' ' || coalesce(e.license_plate, '') || ' ' || coalesce(e.notes, '')) ~ '(trailer|trl|float|deck over|deckover)'
      ),
      '[]'::jsonb
    ),
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'display_name', p.display_name,
            'worker_key', p.worker_key,
            'email', p.email
          )
          order by p.display_name
        )
        from public.profiles p
        where coalesce(p.account_status, 'approved') not in ('pending', 'inactive')
          and coalesce(p.role, 'worker') <> 'subcontractor'
          and nullif(trim(coalesce(p.display_name, '')), '') is not null
      ),
      '[]'::jsonb
    );
end;
$$;

revoke all on function public.get_vehicle_manual_inspection_data() from public, anon, authenticated;
grant execute on function public.get_vehicle_manual_inspection_data() to authenticated;

create or replace function public.get_vehicle_manual_inspection_history(
  p_vehicle_id uuid
)
returns table (
  history jsonb
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select auth.uid()) is null then
    return;
  end if;

  if not exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and coalesce(p.account_status, 'approved') not in ('pending', 'inactive')
  ) then
    return;
  end if;

  return query
  select coalesce(
    (
      select jsonb_agg(to_jsonb(r) order by r.inspection_date desc, r.created_at desc)
      from (
        select *
        from public.vehicle_inspection_records r
        where r.vehicle_id = p_vehicle_id
           or r.trailer_1_id = p_vehicle_id
           or r.trailer_2_id = p_vehicle_id
        order by r.inspection_date desc, r.created_at desc
        limit 30
      ) r
    ),
    '[]'::jsonb
  );
end;
$$;

revoke all on function public.get_vehicle_manual_inspection_history(uuid) from public, anon, authenticated;
grant execute on function public.get_vehicle_manual_inspection_history(uuid) to authenticated;

create or replace function public.submit_vehicle_manual_inspection(
  p_vehicle_id uuid,
  p_record jsonb
)
returns table (
  success boolean,
  message text,
  record jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_vehicle public.equipment_vehicles%rowtype;
  v_record public.vehicle_inspection_records%rowtype;
  v_driver_name text := nullif(trim(coalesce(p_record->>'driver_name', '')), '');
  v_status text := coalesce(nullif(trim(p_record->>'status'), ''), 'submitted');
  v_defects boolean := coalesce((p_record->>'defects_found')::boolean, false);
  v_major boolean := coalesce((p_record->>'major_defects_found')::boolean, false);
  v_vehicle_status text := coalesce(nullif(trim(p_record->>'vehicle_status_after_inspection'), ''), case when v_major then 'Out of Service / Needs Review' when v_defects then 'Needs Review' else 'Active' end);
  v_current_km numeric := nullif(coalesce(p_record->>'current_km', p_record->>'odometer', ''), '')::numeric;
begin
  if (select auth.uid()) is null then
    return query select false, 'You must be signed in to use manual vehicle inspections.'::text, null::jsonb;
    return;
  end if;

  if not exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and coalesce(p.account_status, 'approved') not in ('pending', 'inactive')
  ) then
    return query select false, 'This account is not approved for manual vehicle inspections.'::text, null::jsonb;
    return;
  end if;

  select *
    into v_vehicle
  from public.equipment_vehicles e
  where e.id = p_vehicle_id
    and coalesce(e.is_active, true) = true
  limit 1;

  if not found then
    return query select false, 'This vehicle or trailer is not active.'::text, null::jsonb;
    return;
  end if;

  if v_driver_name is null or length(v_driver_name) < 2 then
    return query select false, 'Select an employee name or enter a manual driver name.'::text, null::jsonb;
    return;
  end if;

  insert into public.vehicle_inspection_records (
    status,
    inspection_type,
    inspection_date,
    inspection_time,
    driver_name,
    driver_employee_key,
    driver_company,
    location,
    odometer,
    vehicle_id,
    vehicle_name,
    vehicle_license_plate,
    vehicle_jurisdiction,
    vehicle_vin,
    vehicle_make,
    vehicle_model,
    vehicle_year,
    trailer_1_id,
    trailer_1_name,
    trailer_1_license_plate,
    trailer_1_jurisdiction,
    trailer_2_id,
    trailer_2_name,
    trailer_2_license_plate,
    trailer_2_jurisdiction,
    defects_found,
    major_defects_found,
    vehicle_status_after_inspection,
    form_data,
    defect_summary,
    repair_notes,
    created_by,
    created_by_name
  )
  values (
    v_status,
    coalesce(nullif(trim(p_record->>'inspection_type'), ''), 'Daily Vehicle Inspection'),
    coalesce((p_record->>'inspection_date')::date, current_date),
    nullif(p_record->>'inspection_time', '')::time,
    v_driver_name,
    nullif(trim(coalesce(p_record->>'driver_employee_key', '')), ''),
    nullif(trim(coalesce(p_record->>'driver_company', '')), ''),
    nullif(trim(coalesce(p_record->>'location', '')), ''),
    v_current_km,
    v_vehicle.id,
    coalesce(nullif(trim(p_record->>'vehicle_name'), ''), v_vehicle.name),
    coalesce(nullif(trim(p_record->>'vehicle_license_plate'), ''), v_vehicle.license_plate, v_vehicle.unit_number, v_vehicle.identification_number),
    coalesce(nullif(trim(p_record->>'vehicle_jurisdiction'), ''), v_vehicle.jurisdiction),
    coalesce(nullif(trim(p_record->>'vehicle_vin'), ''), v_vehicle.vin),
    coalesce(nullif(trim(p_record->>'vehicle_make'), ''), v_vehicle.make),
    coalesce(nullif(trim(p_record->>'vehicle_model'), ''), v_vehicle.model),
    coalesce(nullif(trim(p_record->>'vehicle_year'), ''), v_vehicle.model_year),
    nullif(p_record->>'trailer_1_id', '')::uuid,
    nullif(trim(coalesce(p_record->>'trailer_1_name', '')), ''),
    nullif(trim(coalesce(p_record->>'trailer_1_license_plate', '')), ''),
    nullif(trim(coalesce(p_record->>'trailer_1_jurisdiction', '')), ''),
    nullif(p_record->>'trailer_2_id', '')::uuid,
    nullif(trim(coalesce(p_record->>'trailer_2_name', '')), ''),
    nullif(trim(coalesce(p_record->>'trailer_2_license_plate', '')), ''),
    nullif(trim(coalesce(p_record->>'trailer_2_jurisdiction', '')), ''),
    v_defects,
    v_major,
    v_vehicle_status,
    coalesce(p_record->'form_data', '{}'::jsonb),
    coalesce(p_record->'defect_summary', '{}'::jsonb),
    nullif(trim(coalesce(p_record->>'repair_notes', '')), ''),
    (select auth.uid()),
    v_driver_name
  )
  returning * into v_record;

  if v_status = 'submitted' then
    update public.equipment_vehicles
    set vehicle_status = v_vehicle_status,
        updated_at = now()
    where id in (
      v_vehicle.id,
      nullif(p_record->>'trailer_1_id', '')::uuid,
      nullif(p_record->>'trailer_2_id', '')::uuid
    );

    if v_record.odometer is not null then
      update public.equipment_vehicles
      set current_km = v_record.odometer,
          updated_at = now()
      where id = v_vehicle.id;
    end if;
  end if;

  return query select true, case when v_status = 'draft' then 'Draft saved.' else 'Inspection submitted.' end, to_jsonb(v_record);
end;
$$;

revoke all on function public.submit_vehicle_manual_inspection(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.submit_vehicle_manual_inspection(uuid, jsonb) to authenticated;
