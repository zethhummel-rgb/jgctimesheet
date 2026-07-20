begin;

alter table public.profiles
  drop constraint if exists profiles_account_status_check;

alter table public.profiles
  add constraint profiles_account_status_check
  check (account_status = any (array['pending'::text, 'approved'::text, 'limited'::text, 'inactive'::text]));

create or replace function public.jgc_has_full_portal_access()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.account_status = 'approved'
  );
$$;

create or replace function public.jgc_has_limited_portal_access()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.account_status = 'limited'
  );
$$;

create or replace function public.jgc_limited_worker_matches(candidate_worker text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.account_status = 'limited'
      and lower(trim(p.worker_key)) = lower(trim(coalesce(candidate_worker, '')))
  );
$$;

create or replace function public.jgc_limited_certificate_file_matches(object_name text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, storage
as $$
  select exists (
    select 1
    from public.profiles p
    join public.certificates c
      on lower(trim(c.worker_name)) = lower(trim(p.worker_key))
    where p.id = (select auth.uid())
      and p.account_status = 'limited'
      and c.file_path = object_name
  );
$$;

revoke all on function public.jgc_has_full_portal_access() from public;
revoke all on function public.jgc_has_limited_portal_access() from public;
revoke all on function public.jgc_limited_worker_matches(text) from public;
revoke all on function public.jgc_limited_certificate_file_matches(text) from public;

grant execute on function public.jgc_has_full_portal_access() to anon, authenticated;
grant execute on function public.jgc_has_limited_portal_access() to authenticated;
grant execute on function public.jgc_limited_worker_matches(text) to authenticated;
grant execute on function public.jgc_limited_certificate_file_matches(text) to authenticated;

-- Existing authenticated policies were written for active workers. Add one
-- consistent approved-account gate so the new limited status cannot inherit
-- broad table access through an older permissive policy.
do $$
declare
  policy_row record;
  old_using text;
  old_check text;
  access_gate constant text := 'public.jgc_has_full_portal_access()';
begin
  for policy_row in
    select schemaname, tablename, policyname, cmd, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and roles = array['authenticated'::name]
      and tablename <> 'profiles'
      and policyname not like 'Limited access%'
  loop
    old_using := coalesce(policy_row.qual, 'true');
    old_check := coalesce(policy_row.with_check, policy_row.qual, 'true');

    if policy_row.cmd in ('SELECT', 'DELETE') then
      execute format(
        'alter policy %I on %I.%I using ((%s) and (%s))',
        policy_row.policyname,
        policy_row.schemaname,
        policy_row.tablename,
        old_using,
        access_gate
      );
    elsif policy_row.cmd = 'INSERT' then
      execute format(
        'alter policy %I on %I.%I with check ((%s) and (%s))',
        policy_row.policyname,
        policy_row.schemaname,
        policy_row.tablename,
        old_check,
        access_gate
      );
    else
      execute format(
        'alter policy %I on %I.%I using ((%s) and (%s)) with check ((%s) and (%s))',
        policy_row.policyname,
        policy_row.schemaname,
        policy_row.tablename,
        old_using,
        access_gate,
        old_check,
        access_gate
      );
    end if;
  end loop;
end;
$$;

-- Policies granted to PUBLIC or to both anon/authenticated must keep working
-- for genuinely anonymous forms, while no longer becoming a side door for a
-- signed-in limited account.
do $$
declare
  policy_row record;
  old_using text;
  old_check text;
  access_gate constant text := $gate$(auth.role() <> 'authenticated' or public.jgc_has_full_portal_access())$gate$;
begin
  for policy_row in
    select schemaname, tablename, policyname, cmd, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and tablename <> 'profiles'
      and policyname not like 'Limited access%'
      and roles <> array['authenticated'::name]
      and (
        'public'::name = any (roles)
        or 'authenticated'::name = any (roles)
      )
  loop
    old_using := coalesce(policy_row.qual, 'true');
    old_check := coalesce(policy_row.with_check, policy_row.qual, 'true');

    if policy_row.cmd in ('SELECT', 'DELETE') then
      execute format(
        'alter policy %I on %I.%I using ((%s) and (%s))',
        policy_row.policyname,
        policy_row.schemaname,
        policy_row.tablename,
        old_using,
        access_gate
      );
    elsif policy_row.cmd = 'INSERT' then
      execute format(
        'alter policy %I on %I.%I with check ((%s) and (%s))',
        policy_row.policyname,
        policy_row.schemaname,
        policy_row.tablename,
        old_check,
        access_gate
      );
    else
      execute format(
        'alter policy %I on %I.%I using ((%s) and (%s)) with check ((%s) and (%s))',
        policy_row.policyname,
        policy_row.schemaname,
        policy_row.tablename,
        old_using,
        access_gate,
        old_check,
        access_gate
      );
    end if;
  end loop;
end;
$$;

-- Storage policies need the same approved-account gate. Certificate policies
-- are replaced below with a narrower approved-or-own-file rule.
drop policy if exists "Public can create certificate signed links" on storage.objects;
drop policy if exists "Public can upload certificate files" on storage.objects;

do $$
declare
  policy_row record;
  old_using text;
  old_check text;
  access_gate constant text := 'public.jgc_has_full_portal_access()';
begin
  for policy_row in
    select schemaname, tablename, policyname, cmd, qual, with_check
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and roles = array['authenticated'::name]
      and policyname not like 'Limited access%'
  loop
    old_using := coalesce(policy_row.qual, 'true');
    old_check := coalesce(policy_row.with_check, policy_row.qual, 'true');

    if policy_row.cmd in ('SELECT', 'DELETE') then
      execute format(
        'alter policy %I on storage.objects using ((%s) and (%s))',
        policy_row.policyname,
        old_using,
        access_gate
      );
    elsif policy_row.cmd = 'INSERT' then
      execute format(
        'alter policy %I on storage.objects with check ((%s) and (%s))',
        policy_row.policyname,
        old_check,
        access_gate
      );
    else
      execute format(
        'alter policy %I on storage.objects using ((%s) and (%s)) with check ((%s) and (%s))',
        policy_row.policyname,
        old_using,
        access_gate,
        old_check,
        access_gate
      );
    end if;
  end loop;
end;
$$;

do $$
declare
  policy_row record;
  old_using text;
  old_check text;
  access_gate constant text := $gate$(auth.role() <> 'authenticated' or public.jgc_has_full_portal_access())$gate$;
begin
  for policy_row in
    select schemaname, tablename, policyname, cmd, qual, with_check
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and roles <> array['authenticated'::name]
      and (
        'public'::name = any (roles)
        or 'authenticated'::name = any (roles)
      )
  loop
    old_using := coalesce(policy_row.qual, 'true');
    old_check := coalesce(policy_row.with_check, policy_row.qual, 'true');

    if policy_row.cmd in ('SELECT', 'DELETE') then
      execute format(
        'alter policy %I on storage.objects using ((%s) and (%s))',
        policy_row.policyname,
        old_using,
        access_gate
      );
    elsif policy_row.cmd = 'INSERT' then
      execute format(
        'alter policy %I on storage.objects with check ((%s) and (%s))',
        policy_row.policyname,
        old_check,
        access_gate
      );
    else
      execute format(
        'alter policy %I on storage.objects using ((%s) and (%s)) with check ((%s) and (%s))',
        policy_row.policyname,
        old_using,
        access_gate,
        old_check,
        access_gate
      );
    end if;
  end loop;
end;
$$;

drop policy if exists "Limited access can read own certificates" on public.certificates;
create policy "Limited access can read own certificates"
on public.certificates
for select
to authenticated
using (public.jgc_limited_worker_matches(worker_name));

drop policy if exists "Limited access can read own submitted timesheets" on public.previous_timesheet_weeks;
create policy "Limited access can read own submitted timesheets"
on public.previous_timesheet_weeks
for select
to authenticated
using (public.jgc_limited_worker_matches(worker_name));

drop policy if exists "Limited access can read own timesheet entries" on public.timesheet_entries;
create policy "Limited access can read own timesheet entries"
on public.timesheet_entries
for select
to authenticated
using (public.jgc_limited_worker_matches(worker_name));

drop policy if exists "Limited access can read own inspections" on public.inspection_records;
create policy "Limited access can read own inspections"
on public.inspection_records
for select
to authenticated
using (public.jgc_limited_worker_matches(worker_name));

drop policy if exists "Limited access can read own vehicle inspections" on public.vehicle_inspection_records;
create policy "Limited access can read own vehicle inspections"
on public.vehicle_inspection_records
for select
to authenticated
using (
  public.jgc_has_limited_portal_access()
  and (
    public.jgc_limited_worker_matches(driver_employee_key)
    or created_by = (select auth.uid())
  )
);

drop policy if exists "Limited access can read own daily site reports" on public.daily_site_reports;
create policy "Limited access can read own daily site reports"
on public.daily_site_reports
for select
to authenticated
using (public.jgc_limited_worker_matches(worker_name));

drop policy if exists "Limited access can read own incident reports" on public.incident_reports;
create policy "Limited access can read own incident reports"
on public.incident_reports
for select
to authenticated
using (public.jgc_limited_worker_matches(reported_by_worker));

drop policy if exists "Limited access can read own accident reports" on public.accident_reports;
create policy "Limited access can read own accident reports"
on public.accident_reports
for select
to authenticated
using (
  public.jgc_limited_worker_matches(injured_worker)
  or public.jgc_limited_worker_matches(report_maker_worker)
  or public.jgc_limited_worker_matches(created_by_worker)
);

drop policy if exists "Limited access can read own employee injury reports" on public.employee_injury_reports;
create policy "Limited access can read own employee injury reports"
on public.employee_injury_reports
for select
to authenticated
using (
  public.jgc_limited_worker_matches(employee_worker)
  or public.jgc_limited_worker_matches(created_by_worker)
);

drop policy if exists "Limited access can read own toolbox talk reports" on public.toolbox_talk_reports;
create policy "Limited access can read own toolbox talk reports"
on public.toolbox_talk_reports
for select
to authenticated
using (public.jgc_limited_worker_matches(submitted_by_worker));

drop policy if exists "Approved users can upload certificate files" on storage.objects;
create policy "Approved users can upload certificate files"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'certificates'
  and public.jgc_has_full_portal_access()
);

drop policy if exists "Limited access can read own certificate files" on storage.objects;
create policy "Limited access can read own certificate files"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'certificates'
  and (
    public.jgc_has_full_portal_access()
    or public.jgc_limited_certificate_file_matches(name)
  )
);

commit;
