drop policy if exists "Anonymous users can submit daily site reports" on public.daily_site_reports;
drop policy if exists "Limited access can read own daily site reports" on public.daily_site_reports;
drop policy if exists "Workers and admins can read daily site reports" on public.daily_site_reports;

create policy "Subcontractors can submit bounded daily site reports"
on public.daily_site_reports
for insert
to anon
with check (
  lower(trim(worker_name)) like 'subcontractor:%'
  and char_length(trim(worker_name)) between 15 and 320
  and char_length(trim(project)) between 1 and 300
  and report_date between (current_date - 31) and (current_date + 1)
);

create policy "Accounts can read permitted daily site reports"
on public.daily_site_reports
for select
to authenticated
using (
  private.jgc_limited_worker_matches(worker_name)
  or (
    private.jgc_has_full_portal_access()
    and (
      (select public.is_admin())
      or private.jgc_current_worker_matches(worker_name)
    )
  )
);
