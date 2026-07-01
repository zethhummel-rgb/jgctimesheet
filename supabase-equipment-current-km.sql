-- Adds the KM field used by Admin > Equipment / Vehicles.
-- Run this in Supabase SQL Editor to keep vehicle KM updated from submitted QR inspections.

alter table public.equipment_vehicles
  add column if not exists current_km numeric;

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
