-- Release 1005: security fixes from the 2026-10-03 repository scan (batch 1).

-- Patch an existing function definition, failing loudly if the expected text is not there exactly as often
-- as expected (so a changed function is never half-patched).
create or replace function pg_temp.jgc_patch(def text, pattern text, replacement text, expected int)
returns text language plpgsql as $f$
declare found int;
begin
  select count(*) into found from regexp_matches(def, pattern, 'g');
  if found <> expected then
    raise exception 'Expected % match(es) of %, found %', expected, pattern, found;
  end if;
  return regexp_replace(def, pattern, replacement, 'g');
end $f$;

-- 1. Vehicle inspections -----------------------------------------------------------------------------------
-- A vehicle QR code returned whole equipment rows (including every trailer's own QR token) and employee
-- emails, and its submit accepted any equipment id as a "trailer" and changed that asset's status. The
-- in-Portal versions also let limited accounts through and returned every vehicle's QR token.

-- What a driver needs to see about an asset: descriptive fields only, never QR tokens.
create or replace function private.jgc_vehicle_inspection_asset(e public.equipment_vehicles)
returns jsonb language sql stable set search_path to '' as $f$
  select jsonb_build_object(
    'id', e.id, 'name', e.name, 'license_plate', e.license_plate, 'unit_number', e.unit_number,
    'identification_number', e.identification_number, 'make', e.make, 'model', e.model, 'model_year', e.model_year,
    'equipment_type', e.equipment_type, 'asset_category', e.asset_category, 'notes', e.notes,
    'jurisdiction', e.jurisdiction, 'vin', e.vin, 'vehicle_status', e.vehicle_status,
    'odometer_required', e.odometer_required, 'current_km', e.current_km)
$f$;

-- An active trailer, as the inspection pages list them.
create or replace function private.jgc_is_trailer_asset(e public.equipment_vehicles)
returns boolean language sql stable set search_path to '' as $f$
  select coalesce(e.is_active, true) and lower(coalesce(e.name, '') || ' ' || coalesce(e.equipment_type, '') || ' '
    || coalesce(e.asset_category, '') || ' ' || coalesce(e.identification_number, '') || ' ' || coalesce(e.license_plate, '')
    || ' ' || coalesce(e.notes, '')) ~ '(trailer|trl|float|deck over|deckover)'
$f$;

revoke all on function private.jgc_vehicle_inspection_asset(public.equipment_vehicles) from public, anon, authenticated;
revoke all on function private.jgc_is_trailer_asset(public.equipment_vehicles) from public, anon, authenticated;

do $do$
declare
  def text;
  trailer_check constant text := E'\n  if exists (\n    select 1 from (values (nullif(trim(coalesce(p_record->>''trailer_1_id'', '''')), '''')), (nullif(trim(coalesce(p_record->>''trailer_2_id'', '''')), ''''))) t(id)\n    where t.id is not null and case when t.id ~* ''^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$''\n      then t.id::uuid = p_vehicle_id or not exists (select 1 from public.equipment_vehicles e where e.id = t.id::uuid and private.jgc_is_trailer_asset(e))\n      else true end\n  ) then\n    return query select false, ''Select trailers from the list for this vehicle.''::text, null::jsonb;\n    return;\n  end if;\n';
begin
  -- QR: safe fields only; no employee emails.
  def := pg_get_functiondef('public.get_vehicle_qr_inspection(uuid,text)'::regprocedure);
  def := pg_temp.jgc_patch(def, 'to_jsonb\(v_vehicle\)', 'private.jgc_vehicle_inspection_asset(v_vehicle)', 1);
  def := pg_temp.jgc_patch(def, 'jsonb_agg\(to_jsonb\(e\) order by e\.name\)', 'jsonb_agg(private.jgc_vehicle_inspection_asset(e) order by e.name)', 1);
  def := pg_temp.jgc_patch(def, ',\s*''email'', p\.email', '', 1);
  execute def;

  -- QR submit: trailers must be real trailers, not the vehicle or another asset.
  def := pg_get_functiondef('public.submit_vehicle_qr_inspection(uuid,text,jsonb)'::regprocedure);
  def := pg_temp.jgc_patch(def, '\mbegin\M', 'begin' || trailer_check, 1);
  execute def;

  -- In-Portal lists: approved accounts only, safe fields only, no employee emails.
  def := pg_get_functiondef('public.get_vehicle_manual_inspection_data()'::regprocedure);
  def := pg_temp.jgc_patch(def, '\mbegin\M', E'begin\n  if not private.jgc_has_full_portal_access() then\n    return;\n  end if;\n', 1);
  def := pg_temp.jgc_patch(def, 'jsonb_agg\(to_jsonb\(e\) order by', 'jsonb_agg(private.jgc_vehicle_inspection_asset(e) order by', 2);
  def := pg_temp.jgc_patch(def, ',\s*''email'', p\.email', '', 1);
  execute def;

  def := pg_get_functiondef('public.get_vehicle_manual_inspection_history(uuid)'::regprocedure);
  def := pg_temp.jgc_patch(def, '\mbegin\M', E'begin\n  if not private.jgc_has_full_portal_access() then\n    return;\n  end if;\n', 1);
  execute def;

  def := pg_get_functiondef('public.submit_vehicle_manual_inspection(uuid,jsonb)'::regprocedure);
  def := pg_temp.jgc_patch(def, '\mbegin\M', E'begin\n  if not private.jgc_has_full_portal_access() then\n    return query select false, ''Only approved Portal accounts can record vehicle inspections.''::text, null::jsonb;\n    return;\n  end if;\n' || trailer_check, 1);
  execute def;
end $do$;

-- 2. Notification links ------------------------------------------------------------------------------------
-- Links are Portal pages (optionally with ?query or #fragment) or https addresses; a javascript: (or any
-- other scheme) link could run code in the recipient's Portal session when clicked.
alter table public.notifications drop constraint if exists notifications_link_url_safe;
alter table public.notifications add constraint notifications_link_url_safe check (
  link_url is null or link_url = ''
  or link_url ~ '^(https://[^[:space:]]+|[A-Za-z0-9][A-Za-z0-9._/-]*([?#][^[:space:]]*)?)$'
);

-- 3. Push subscriptions ------------------------------------------------------------------------------------
-- Pushes are routed by the subscription's profile, worker key, email and role; those now always come from
-- the signed-in person's own profile, so nobody can register as another worker or as an admin.
create or replace function private.jgc_push_subscription_owner()
returns trigger language plpgsql security definer set search_path to '' as $f$
declare p public.profiles;
begin
  if (select auth.uid()) is null then
    return new; -- the push sender (service role) updates delivery status
  end if;
  select * into p from public.profiles where id = (select auth.uid());
  if p.id is null then
    raise exception 'Your Portal profile could not be found.' using errcode = '42501';
  end if;
  new.profile_id := p.id;
  new.worker_key := p.worker_key;
  new.worker_display_name := p.display_name;
  new.worker_email := p.email;
  new.role := p.role;
  return new;
end $f$;
revoke all on function private.jgc_push_subscription_owner() from public, anon, authenticated;

drop trigger if exists jgc_push_subscription_owner on public.push_subscriptions;
create trigger jgc_push_subscription_owner before insert or update on public.push_subscriptions
for each row execute function private.jgc_push_subscription_owner();

drop policy if exists "push subscriptions owner select" on public.push_subscriptions;
drop policy if exists "push subscriptions owner insert" on public.push_subscriptions;
drop policy if exists "push subscriptions owner update" on public.push_subscriptions;
drop policy if exists "push subscriptions owner delete" on public.push_subscriptions;
create policy "push subscriptions owner select" on public.push_subscriptions for select to authenticated
  using (profile_id = (select auth.uid()) and private.jgc_has_full_portal_access());
create policy "push subscriptions owner insert" on public.push_subscriptions for insert to authenticated
  with check (profile_id = (select auth.uid()) and private.jgc_has_full_portal_access());
create policy "push subscriptions owner update" on public.push_subscriptions for update to authenticated
  using (profile_id = (select auth.uid()) and private.jgc_has_full_portal_access())
  with check (profile_id = (select auth.uid()) and private.jgc_has_full_portal_access());
create policy "push subscriptions owner delete" on public.push_subscriptions for delete to authenticated
  using (profile_id = (select auth.uid()) and private.jgc_has_full_portal_access());

-- 4. Incident photos ---------------------------------------------------------------------------------------
-- A new upload is readable and replaceable for 10 minutes by the person who uploaded it (for the report
-- email), not by every approved account. Admins keep full access.
drop policy if exists "Incident photos readable by admins and new uploads" on storage.objects;
create policy "Incident photos readable by admins and new uploads" on storage.objects
for select to authenticated
using (bucket_id = 'incident-photos' and ((select public.is_admin()) or (created_at > now() - interval '10 minutes'
  and owner_id = (select auth.uid())::text and private.jgc_has_full_portal_access())));

drop policy if exists "Incident photos replaceable by admins and new uploads" on storage.objects;
create policy "Incident photos replaceable by admins and new uploads" on storage.objects
for update to authenticated
using (bucket_id = 'incident-photos' and ((select public.is_admin()) or (created_at > now() - interval '10 minutes'
  and owner_id = (select auth.uid())::text and private.jgc_has_full_portal_access())))
with check (bucket_id = 'incident-photos' and ((select public.is_admin()) or (owner_id = (select auth.uid())::text
  and private.jgc_has_full_portal_access())));

-- 5. Targeted announcements --------------------------------------------------------------------------------
-- An announcement addressed to one worker (by worker key, name or email) is readable by that worker and
-- admins only; untargeted announcements stay readable by every approved account.
drop policy if exists "Approved users can read active announcements" on public.announcements;
create policy "Approved users can read active announcements" on public.announcements
for select to authenticated
using (
  is_active = true and (expires_at is null or expires_at > now()) and private.jgc_has_full_portal_access()
  and (
    (coalesce(trim(target_worker_name), '') = '' and coalesce(trim(target_worker_email), '') = '')
    or exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid()) and (
        (coalesce(trim(target_worker_name), '') <> '' and lower(trim(target_worker_name)) in (lower(trim(coalesce(p.worker_key, ''))), lower(trim(coalesce(p.display_name, '')))))
        or (coalesce(trim(target_worker_email), '') <> '' and lower(trim(target_worker_email)) = lower(trim(coalesce(p.email, ''))))
      )
    )
  )
);
