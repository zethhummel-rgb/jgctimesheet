create or replace function private.jgc_current_worker_matches(candidate_worker text)
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
      and p.account_status in ('approved', 'limited')
      and lower(trim(p.worker_key)) = lower(trim(coalesce(candidate_worker, '')))
  );
$$;

revoke all on function private.jgc_current_worker_matches(text) from public;
grant execute on function private.jgc_current_worker_matches(text) to authenticated;

drop policy if exists "Subcontractors can submit daily_site_reports" on public.daily_site_reports;
drop policy if exists "Workers can insert daily site reports" on public.daily_site_reports;
drop policy if exists "Workers can read own daily site reports" on public.daily_site_reports;
drop policy if exists "Workers can update own daily site reports" on public.daily_site_reports;

create policy "Anonymous users can submit daily site reports"
on public.daily_site_reports
for insert
to anon
with check (true);

create policy "Workers and admins can submit daily site reports"
on public.daily_site_reports
for insert
to authenticated
with check (
  private.jgc_has_full_portal_access()
  and (
    (select public.is_admin())
    or private.jgc_current_worker_matches(worker_name)
  )
);

create policy "Workers and admins can read daily site reports"
on public.daily_site_reports
for select
to authenticated
using (
  private.jgc_has_full_portal_access()
  and (
    (select public.is_admin())
    or private.jgc_current_worker_matches(worker_name)
  )
);

create policy "Workers and admins can update daily site reports"
on public.daily_site_reports
for update
to authenticated
using (
  private.jgc_has_full_portal_access()
  and (
    (select public.is_admin())
    or private.jgc_current_worker_matches(worker_name)
  )
)
with check (
  private.jgc_has_full_portal_access()
  and (
    (select public.is_admin())
    or private.jgc_current_worker_matches(worker_name)
  )
);
