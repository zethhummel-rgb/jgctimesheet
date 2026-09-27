-- Release 944: security fixes approved by Zeth from the 2026-09-27 audit (items 1, 2, 7 and 12).

-- 1. Admin rights come from the admin role only. Some rules and two QR-code functions also treated two owner
--    email addresses as admin, but any signed-in user can edit their own profile email, so an employee could
--    give themselves those rights. Drop that email branch everywhere; Zeth and Jeff already hold the admin role.
do $$
declare
  policy_row record;
  function_row record;
  policy_email_branch constant text := '\s+OR\s+\(lower\((COALESCE\()?p\.email(, ''''::text\))?\)\s+=\s+ANY\s+\(ARRAY\[''zeth@johngordonconstruction\.com''::text,\s*''jeff@johngordonconstruction\.com''::text\]\)\)';
  function_email_branch constant text := '\s*or lower\(coalesce\(p\.email, ''''\)\) in \(''zeth@johngordonconstruction\.com'', ''jeff@johngordonconstruction\.com''\)';
begin
  for policy_row in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and (coalesce(qual, '') ~ 'johngordonconstruction\.com' or coalesce(with_check, '') ~ 'johngordonconstruction\.com')
  loop
    execute format(
      'alter policy %I on %I.%I%s%s',
      policy_row.policyname,
      policy_row.schemaname,
      policy_row.tablename,
      case when policy_row.qual is null then '' else ' using (' || regexp_replace(policy_row.qual, policy_email_branch, '', 'g') || ')' end,
      case when policy_row.with_check is null then '' else ' with check (' || regexp_replace(policy_row.with_check, policy_email_branch, '', 'g') || ')' end
    );
  end loop;

  for function_row in
    select p.oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('ensure_equipment_inspection_qr_token', 'ensure_vehicle_inspection_qr_token')
  loop
    execute regexp_replace(pg_get_functiondef(function_row.oid), function_email_branch, '', 'g');
  end loop;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and (coalesce(qual, '') || coalesce(with_check, '')) ~ 'johngordonconstruction\.com'
  ) then
    raise exception 'An email-based admin rule is still present.';
  end if;

  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and p.prokind = 'f'
      and pg_get_functiondef(p.oid) ~ 'zeth@johngordonconstruction\.com'
  ) then
    raise exception 'An email-based admin check is still present in a function.';
  end if;
end $$;

-- 2. Incident photos: the public report forms (and signed-in employees) can still add photos, and can confirm
--    or retry their own upload for 10 minutes. Only admins can view older photos, and only admins can delete.
--    Before, anyone without signing in could list, download, replace or delete every incident photo.
drop policy if exists "Incident photos readable" on storage.objects;
drop policy if exists "Incident photos uploadable" on storage.objects;
drop policy if exists "Incident photos updateable" on storage.objects;
drop policy if exists "Incident photos deleteable" on storage.objects;

create policy "Incident photos uploadable"
  on storage.objects for insert to anon, authenticated
  with check (
    bucket_id = 'incident-photos'
    and ((select auth.uid()) is null or private.jgc_has_full_portal_access())
  );

create policy "Incident photos readable by admins and new uploads"
  on storage.objects for select to anon, authenticated
  using (
    bucket_id = 'incident-photos'
    and (
      (select public.is_admin())
      or (created_at > now() - interval '10 minutes' and ((select auth.uid()) is null or private.jgc_has_full_portal_access()))
    )
  );

create policy "Incident photos replaceable by admins and new uploads"
  on storage.objects for update to anon, authenticated
  using (
    bucket_id = 'incident-photos'
    and (
      (select public.is_admin())
      or (created_at > now() - interval '10 minutes' and ((select auth.uid()) is null or private.jgc_has_full_portal_access()))
    )
  )
  with check (
    bucket_id = 'incident-photos'
    and ((select public.is_admin()) or (select auth.uid()) is null or private.jgc_has_full_portal_access())
  );

create policy "Incident photos deleteable by admins"
  on storage.objects for delete to authenticated
  using (bucket_id = 'incident-photos' and (select public.is_admin()));

-- 7. Toolbox talk PDFs: everyone who could read them still can (employees and the subcontractor view), but
--    only admins can upload, replace or delete them. Before, anyone without signing in could change them.
drop policy if exists "Toolbox talk PDFs uploadable" on storage.objects;
drop policy if exists "Toolbox talk PDFs updateable" on storage.objects;
drop policy if exists "Toolbox talk PDFs deleteable" on storage.objects;

create policy "Toolbox talk PDFs uploadable by admins"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'toolbox-talks' and (select public.is_admin()) and private.jgc_has_full_portal_access());

create policy "Toolbox talk PDFs updateable by admins"
  on storage.objects for update to authenticated
  using (bucket_id = 'toolbox-talks' and (select public.is_admin()) and private.jgc_has_full_portal_access())
  with check (bucket_id = 'toolbox-talks' and (select public.is_admin()) and private.jgc_has_full_portal_access());

create policy "Toolbox talk PDFs deleteable by admins"
  on storage.objects for delete to authenticated
  using (bucket_id = 'toolbox-talks' and (select public.is_admin()) and private.jgc_has_full_portal_access());

-- 12. Profile photos live in a folder named after the employee's account id. Employees can only add, replace
--     or delete photos in their own folder; admins can manage anyone's. Before, any employee could replace or
--     delete anyone's photo. Viewing is unchanged (public bucket).
drop policy if exists "Authenticated users can upload profile photos" on storage.objects;
drop policy if exists "Authenticated users can update profile photos" on storage.objects;
drop policy if exists "Authenticated users can delete profile photos" on storage.objects;

create policy "Profile photos uploadable by owner or admin"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'profile-photos'
    and private.jgc_has_full_portal_access()
    and ((storage.foldername(name))[1] = (select auth.uid())::text or (select public.is_admin()))
  );

create policy "Profile photos updateable by owner or admin"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'profile-photos'
    and private.jgc_has_full_portal_access()
    and ((storage.foldername(name))[1] = (select auth.uid())::text or (select public.is_admin()))
  )
  with check (
    bucket_id = 'profile-photos'
    and private.jgc_has_full_portal_access()
    and ((storage.foldername(name))[1] = (select auth.uid())::text or (select public.is_admin()))
  );

create policy "Profile photos deleteable by owner or admin"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'profile-photos'
    and private.jgc_has_full_portal_access()
    and ((storage.foldername(name))[1] = (select auth.uid())::text or (select public.is_admin()))
  );
