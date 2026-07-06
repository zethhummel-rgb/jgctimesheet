-- Fix profile account-type values for the notification center.
--
-- Run this once in Supabase SQL Editor if "Make Supervisor" shows:
-- profiles_role_check

alter table public.profiles
  add column if not exists role text default 'worker';

update public.profiles
set role = case lower(trim(coalesce(role, '')))
  when 'admin' then 'admin'
  when 'supervisor' then 'supervisor'
  when 'subcontractor' then 'subcontractor'
  else 'worker'
end;

alter table public.profiles
  alter column role set default 'worker';

alter table public.profiles
  drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('worker', 'supervisor', 'admin', 'subcontractor'));
