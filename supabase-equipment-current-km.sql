-- Adds the KM field used by Admin > Equipment / Vehicles.
-- Run this once in Supabase SQL Editor if saving equipment says current_km is missing.

alter table public.equipment_vehicles
  add column if not exists current_km numeric;
