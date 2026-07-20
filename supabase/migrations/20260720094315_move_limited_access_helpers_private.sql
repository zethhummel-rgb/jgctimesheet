begin;

create schema if not exists private;

create or replace function private.jgc_has_full_portal_access()
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

create or replace function private.jgc_has_limited_portal_access()
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

create or replace function private.jgc_limited_worker_matches(candidate_worker text)
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

create or replace function private.jgc_limited_certificate_file_matches(object_name text)
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

revoke all on function private.jgc_has_full_portal_access() from public;
revoke all on function private.jgc_has_limited_portal_access() from public;
revoke all on function private.jgc_limited_worker_matches(text) from public;
revoke all on function private.jgc_limited_certificate_file_matches(text) from public;

grant usage on schema private to anon, authenticated;
grant execute on function private.jgc_has_full_portal_access() to anon, authenticated;
grant execute on function private.jgc_has_limited_portal_access() to authenticated;
grant execute on function private.jgc_limited_worker_matches(text) to authenticated;
grant execute on function private.jgc_limited_certificate_file_matches(text) to authenticated;

do $$
declare
  policy_row record;
  new_using text;
  new_check text;
begin
  for policy_row in
    select schemaname, tablename, policyname, cmd, qual, with_check
    from pg_policies
    where schemaname in ('public', 'storage')
      and (
        coalesce(qual, '') like '%jgc_has_full_portal_access%'
        or coalesce(qual, '') like '%jgc_has_limited_portal_access%'
        or coalesce(qual, '') like '%jgc_limited_worker_matches%'
        or coalesce(qual, '') like '%jgc_limited_certificate_file_matches%'
        or coalesce(with_check, '') like '%jgc_has_full_portal_access%'
        or coalesce(with_check, '') like '%jgc_has_limited_portal_access%'
        or coalesce(with_check, '') like '%jgc_limited_worker_matches%'
        or coalesce(with_check, '') like '%jgc_limited_certificate_file_matches%'
      )
  loop
    new_using := policy_row.qual;
    new_check := policy_row.with_check;

    if new_using is not null then
      new_using := replace(new_using, 'jgc_has_full_portal_access()', 'private.jgc_has_full_portal_access()');
      new_using := replace(new_using, 'jgc_has_limited_portal_access()', 'private.jgc_has_limited_portal_access()');
      new_using := replace(new_using, 'jgc_limited_worker_matches(', 'private.jgc_limited_worker_matches(');
      new_using := replace(new_using, 'jgc_limited_certificate_file_matches(', 'private.jgc_limited_certificate_file_matches(');
      new_using := replace(
        new_using,
        '((auth.role() <> ''authenticated''::text) OR private.jgc_has_full_portal_access())',
        '(((select auth.uid()) is null) OR private.jgc_has_full_portal_access())'
      );
    end if;

    if new_check is not null then
      new_check := replace(new_check, 'jgc_has_full_portal_access()', 'private.jgc_has_full_portal_access()');
      new_check := replace(new_check, 'jgc_has_limited_portal_access()', 'private.jgc_has_limited_portal_access()');
      new_check := replace(new_check, 'jgc_limited_worker_matches(', 'private.jgc_limited_worker_matches(');
      new_check := replace(new_check, 'jgc_limited_certificate_file_matches(', 'private.jgc_limited_certificate_file_matches(');
      new_check := replace(
        new_check,
        '((auth.role() <> ''authenticated''::text) OR private.jgc_has_full_portal_access())',
        '(((select auth.uid()) is null) OR private.jgc_has_full_portal_access())'
      );
    end if;

    if policy_row.cmd in ('SELECT', 'DELETE') then
      execute format(
        'alter policy %I on %I.%I using (%s)',
        policy_row.policyname,
        policy_row.schemaname,
        policy_row.tablename,
        new_using
      );
    elsif policy_row.cmd = 'INSERT' then
      execute format(
        'alter policy %I on %I.%I with check (%s)',
        policy_row.policyname,
        policy_row.schemaname,
        policy_row.tablename,
        new_check
      );
    elsif new_using is not null and new_check is not null then
      execute format(
        'alter policy %I on %I.%I using (%s) with check (%s)',
        policy_row.policyname,
        policy_row.schemaname,
        policy_row.tablename,
        new_using,
        new_check
      );
    elsif new_using is not null then
      execute format(
        'alter policy %I on %I.%I using (%s)',
        policy_row.policyname,
        policy_row.schemaname,
        policy_row.tablename,
        new_using
      );
    else
      execute format(
        'alter policy %I on %I.%I with check (%s)',
        policy_row.policyname,
        policy_row.schemaname,
        policy_row.tablename,
        new_check
      );
    end if;
  end loop;
end;
$$;

revoke all on function public.jgc_has_full_portal_access() from public, anon, authenticated;
revoke all on function public.jgc_has_limited_portal_access() from public, anon, authenticated;
revoke all on function public.jgc_limited_worker_matches(text) from public, anon, authenticated;
revoke all on function public.jgc_limited_certificate_file_matches(text) from public, anon, authenticated;

drop function public.jgc_has_full_portal_access();
drop function public.jgc_has_limited_portal_access();
drop function public.jgc_limited_worker_matches(text);
drop function public.jgc_limited_certificate_file_matches(text);

commit;
