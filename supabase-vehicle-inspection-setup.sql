-- Vehicle / trailer daily inspection QR setup.
--
-- Run this once in Supabase SQL Editor after deploying the matching website files.
-- It adds vehicle QR fields to the existing equipment_vehicles table and creates
-- a separate vehicle_inspection_records table so this system does not disturb
-- the existing lift/equipment inspection QR records.

alter table public.equipment_vehicles
  add column if not exists unit_number text;

alter table public.equipment_vehicles
  add column if not exists asset_category text;

alter table public.equipment_vehicles
  add column if not exists license_plate text;

alter table public.equipment_vehicles
  add column if not exists jurisdiction text;

alter table public.equipment_vehicles
  add column if not exists vin text;

alter table public.equipment_vehicles
  add column if not exists make text;

alter table public.equipment_vehicles
  add column if not exists model text;

alter table public.equipment_vehicles
  add column if not exists model_year text;

alter table public.equipment_vehicles
  add column if not exists odometer_required boolean default true;

alter table public.equipment_vehicles
  add column if not exists current_km numeric;

alter table public.equipment_vehicles
  add column if not exists vehicle_load text;

alter table public.equipment_vehicles
  add column if not exists vehicle_height text;

alter table public.equipment_vehicles
  add column if not exists vehicle_width text;

alter table public.equipment_vehicles
  add column if not exists vehicle_qr_token text;

alter table public.equipment_vehicles
  add column if not exists vehicle_qr_url text;

alter table public.equipment_vehicles
  add column if not exists vehicle_qr_created_at timestamptz;

alter table public.equipment_vehicles
  add column if not exists vehicle_status text default 'Active';

create unique index if not exists equipment_vehicles_vehicle_qr_token_idx
  on public.equipment_vehicles (vehicle_qr_token)
  where vehicle_qr_token is not null;

create table if not exists public.vehicle_inspection_records (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  status text not null default 'submitted',
  inspection_type text not null default 'Daily Vehicle Inspection',
  inspection_date date not null default current_date,
  inspection_time time,
  driver_name text not null,
  driver_employee_key text,
  driver_company text,
  location text,
  odometer numeric,
  vehicle_id uuid references public.equipment_vehicles(id) on delete set null,
  vehicle_name text,
  vehicle_license_plate text,
  vehicle_jurisdiction text,
  vehicle_vin text,
  vehicle_make text,
  vehicle_model text,
  vehicle_year text,
  trailer_1_id uuid references public.equipment_vehicles(id) on delete set null,
  trailer_1_name text,
  trailer_1_license_plate text,
  trailer_1_jurisdiction text,
  trailer_2_id uuid references public.equipment_vehicles(id) on delete set null,
  trailer_2_name text,
  trailer_2_license_plate text,
  trailer_2_jurisdiction text,
  defects_found boolean not null default false,
  major_defects_found boolean not null default false,
  vehicle_status_after_inspection text,
  form_data jsonb not null default '{}'::jsonb,
  defect_summary jsonb not null default '{}'::jsonb,
  repair_notes text,
  repaired_by text,
  repaired_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_by_name text
);

alter table public.vehicle_inspection_records
  add column if not exists status text default 'submitted';

alter table public.vehicle_inspection_records
  add column if not exists inspection_time time;

create index if not exists vehicle_inspection_records_vehicle_date_idx
  on public.vehicle_inspection_records (vehicle_id, inspection_date desc, created_at desc);

create index if not exists vehicle_inspection_records_trailer1_date_idx
  on public.vehicle_inspection_records (trailer_1_id, inspection_date desc, created_at desc)
  where trailer_1_id is not null;

create index if not exists vehicle_inspection_records_trailer2_date_idx
  on public.vehicle_inspection_records (trailer_2_id, inspection_date desc, created_at desc)
  where trailer_2_id is not null;

alter table public.vehicle_inspection_records enable row level security;

drop policy if exists "Vehicle inspections are viewable by approved users" on public.vehicle_inspection_records;
create policy "Vehicle inspections are viewable by approved users"
  on public.vehicle_inspection_records
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = (select auth.uid())
        and coalesce(p.account_status, 'approved') not in ('pending', 'inactive')
    )
  );

drop policy if exists "Approved users can create vehicle inspections" on public.vehicle_inspection_records;
create policy "Approved users can create vehicle inspections"
  on public.vehicle_inspection_records
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.profiles p
      where p.id = (select auth.uid())
        and coalesce(p.account_status, 'approved') not in ('pending', 'inactive')
    )
  );

drop policy if exists "Approved users can update vehicle inspections" on public.vehicle_inspection_records;
create policy "Approved users can update vehicle inspections"
  on public.vehicle_inspection_records
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = (select auth.uid())
        and coalesce(p.account_status, 'approved') not in ('pending', 'inactive')
    )
  )
  with check (
    exists (
      select 1
      from public.profiles p
      where p.id = (select auth.uid())
        and coalesce(p.account_status, 'approved') not in ('pending', 'inactive')
    )
  );

drop policy if exists "Admins can delete vehicle inspections" on public.vehicle_inspection_records;
create policy "Admins can delete vehicle inspections"
  on public.vehicle_inspection_records
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = (select auth.uid())
        and coalesce(p.account_status, 'approved') not in ('pending', 'inactive')
        and (
          coalesce(p.role, '') = 'admin'
          or lower(coalesce(p.email, '')) in ('zeth@johngordonconstruction.com', 'jeff@johngordonconstruction.com')
        )
    )
  );

grant select, insert, update, delete on public.vehicle_inspection_records to authenticated;

create or replace function public.ensure_vehicle_inspection_qr_token(
  p_equipment_id uuid
)
returns table (
  token text,
  qr_url text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_equipment public.equipment_vehicles%rowtype;
  v_token text;
  v_qr_url text;
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
    raise exception 'Only admin accounts can create vehicle inspection QR codes.';
  end if;

  select *
    into v_equipment
  from public.equipment_vehicles e
  where e.id = p_equipment_id
    and coalesce(e.is_active, true) = true
  limit 1;

  if not found then
    raise exception 'Vehicle could not be found.';
  end if;

  v_token := nullif(v_equipment.vehicle_qr_token, '');

  if v_token is null then
    v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  end if;

  v_qr_url := 'vehicle-inspection.html?vehicle_id=' || v_equipment.id::text || '&token=' || v_token;

  update public.equipment_vehicles
  set vehicle_qr_token = v_token,
      vehicle_qr_url = v_qr_url,
      vehicle_qr_created_at = coalesce(vehicle_qr_created_at, now()),
      updated_at = now()
  where id = v_equipment.id;

  return query select v_token, v_qr_url;
end;
$$;

grant execute on function public.ensure_vehicle_inspection_qr_token(uuid) to authenticated;

create or replace function public.get_vehicle_qr_inspection(
  p_vehicle_id uuid,
  p_token text
)
returns table (
  vehicle jsonb,
  trailers jsonb,
  employees jsonb,
  history jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  clean_token text := trim(coalesce(p_token, ''));
  v_vehicle public.equipment_vehicles%rowtype;
begin
  if length(clean_token) < 24 then
    return;
  end if;

  select *
    into v_vehicle
  from public.equipment_vehicles e
  where e.id = p_vehicle_id
    and e.vehicle_qr_token = clean_token
    and coalesce(e.is_active, true) = true
  limit 1;

  if not found then
    return;
  end if;

  return query
  select
    to_jsonb(v_vehicle),
    coalesce(
      (
        select jsonb_agg(to_jsonb(e) order by e.name)
        from public.equipment_vehicles e
        where coalesce(e.is_active, true) = true
          and e.id <> v_vehicle.id
          and lower(coalesce(e.name, '') || ' ' || coalesce(e.equipment_type, '') || ' ' || coalesce(e.asset_category, '') || ' ' || coalesce(e.identification_number, '') || ' ' || coalesce(e.notes, '')) ~ '(trailer|trl|float|deck over|deckover)'
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
    ),
    coalesce(
      (
        select jsonb_agg(to_jsonb(r) order by r.inspection_date desc, r.created_at desc)
        from (
          select *
          from public.vehicle_inspection_records r
          where r.vehicle_id = v_vehicle.id
             or r.trailer_1_id = v_vehicle.id
             or r.trailer_2_id = v_vehicle.id
          order by r.inspection_date desc, r.created_at desc
          limit 30
        ) r
      ),
      '[]'::jsonb
    );
end;
$$;

grant execute on function public.get_vehicle_qr_inspection(uuid, text) to anon, authenticated;

create or replace function public.submit_vehicle_qr_inspection(
  p_vehicle_id uuid,
  p_token text,
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
  clean_token text := trim(coalesce(p_token, ''));
  v_vehicle public.equipment_vehicles%rowtype;
  v_record public.vehicle_inspection_records%rowtype;
  v_driver_name text := nullif(trim(coalesce(p_record->>'driver_name', '')), '');
  v_status text := coalesce(nullif(trim(p_record->>'status'), ''), 'submitted');
  v_defects boolean := coalesce((p_record->>'defects_found')::boolean, false);
  v_major boolean := coalesce((p_record->>'major_defects_found')::boolean, false);
  v_vehicle_status text := coalesce(nullif(trim(p_record->>'vehicle_status_after_inspection'), ''), case when v_major then 'Out of Service / Needs Review' when v_defects then 'Needs Review' else 'Active' end);
  v_current_km numeric := nullif(coalesce(p_record->>'current_km', p_record->>'odometer', ''), '')::numeric;
  v_toronto_today date := (now() at time zone 'America/Toronto')::date;
begin
  if length(clean_token) < 24 then
    return query select false, 'This vehicle QR token is not valid.'::text, null::jsonb;
    return;
  end if;

  select *
    into v_vehicle
  from public.equipment_vehicles e
  where e.id = p_vehicle_id
    and e.vehicle_qr_token = clean_token
    and coalesce(e.is_active, true) = true
  limit 1;

  if not found then
    return query select false, 'This vehicle QR code is not active.'::text, null::jsonb;
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
    created_by_name
  )
  values (
    v_status,
    coalesce(nullif(trim(p_record->>'inspection_type'), ''), 'Daily Vehicle Inspection'),
    coalesce((p_record->>'inspection_date')::date, v_toronto_today),
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

grant execute on function public.submit_vehicle_qr_inspection(uuid, text, jsonb) to anon, authenticated;

create or replace function public.sync_equipment_current_km_from_vehicle_inspection()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if lower(coalesce(new.status, '')) = 'submitted'
     and new.vehicle_id is not null
     and new.odometer is not null then
    update public.equipment_vehicles
    set current_km = new.odometer,
        updated_at = now()
    where id = new.vehicle_id
      and current_km is distinct from new.odometer;
  end if;

  return new;
end;
$$;

revoke all on function public.sync_equipment_current_km_from_vehicle_inspection() from public, anon, authenticated;

drop trigger if exists sync_equipment_current_km_after_vehicle_inspection
  on public.vehicle_inspection_records;

create trigger sync_equipment_current_km_after_vehicle_inspection
after insert or update of status, odometer, vehicle_id
on public.vehicle_inspection_records
for each row
execute function public.sync_equipment_current_km_from_vehicle_inspection();

with latest_vehicle_km as (
  select distinct on (vehicle_id)
    vehicle_id,
    odometer
  from public.vehicle_inspection_records
  where lower(coalesce(status, '')) = 'submitted'
    and vehicle_id is not null
    and odometer is not null
  order by vehicle_id, inspection_date desc nulls last, created_at desc nulls last
)
update public.equipment_vehicles e
set current_km = latest_vehicle_km.odometer,
    updated_at = now()
from latest_vehicle_km
where e.id = latest_vehicle_km.vehicle_id
  and e.current_km is distinct from latest_vehicle_km.odometer;
