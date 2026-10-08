-- Release 1009 (Zeth, 2026-10-07):
-- * Approved supervisors can read injury and accident reports, including ones attached to a Job Board.
-- * An inspection record's creator can delete it (admins already could).

create or replace function private.jgc_is_approved_supervisor()
returns boolean language sql stable security definer set search_path to '' as $f$
  select exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.account_status = 'approved' and p.role = 'supervisor')
$f$;
revoke all on function private.jgc_is_approved_supervisor() from public, anon;
grant execute on function private.jgc_is_approved_supervisor() to authenticated;

drop policy if exists "Admins, the injured employee and the filer read injury reports" on public.employee_injury_reports;
create policy "Admins, supervisors, the injured employee and the filer read injury reports" on public.employee_injury_reports
for select to authenticated
using (private.jgc_has_full_portal_access() and ((select public.is_admin()) or (select private.jgc_is_approved_supervisor())
  or private.jgc_current_worker_matches(employee_worker) or private.jgc_current_worker_matches(created_by_worker)));

drop policy if exists "Admins, the injured worker and the filer read accident reports" on public.accident_reports;
create policy "Admins, supervisors, the injured worker and the filer read accident reports" on public.accident_reports
for select to authenticated
using (private.jgc_has_full_portal_access() and ((select public.is_admin()) or (select private.jgc_is_approved_supervisor())
  or private.jgc_current_worker_matches(injured_worker) or private.jgc_current_worker_matches(report_maker_worker)
  or private.jgc_current_worker_matches(created_by_worker)));

-- The Job Board uses the same people.
create or replace function private.jgc_can_read_injury_report(p_source_type text, p_id uuid)
returns boolean language sql stable security definer set search_path to '' as $f$
  select case p_source_type
    when 'employee_injury_reports' then exists (
      select 1 from public.employee_injury_reports r where r.id = p_id and (
        (select public.is_admin()) or (select private.jgc_is_approved_supervisor()) or private.jgc_current_worker_matches(r.employee_worker)
        or private.jgc_current_worker_matches(r.created_by_worker)))
    when 'accident_reports' then exists (
      select 1 from public.accident_reports r where r.id = p_id and (
        (select public.is_admin()) or (select private.jgc_is_approved_supervisor()) or private.jgc_current_worker_matches(r.injured_worker)
        or private.jgc_current_worker_matches(r.report_maker_worker) or private.jgc_current_worker_matches(r.created_by_worker)))
    else true end
$f$;

drop policy if exists "Approved admins can delete inspection records" on public.inspection_records;
create policy "The creator or an admin deletes inspection records" on public.inspection_records
for delete to authenticated
using (private.jgc_has_full_portal_access() and ((select public.is_admin()) or private.jgc_current_worker_matches(worker_name)));
