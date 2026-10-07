-- Release 1001: retire the legacy "Subcontractor Access" sign-in.
-- That sign-in kept a device-only session with no account, so it relied on anonymous table access.
-- Subcontractors and visitors now use the Job Board QR code on site, which goes through the token RPCs.
-- The policies below only served the old session. Its history in subcontractor_portal_activity is kept,
-- and admins can still read and delete it.

drop policy if exists "Anyone can record subcontractor portal activity" on public.subcontractor_portal_activity;
drop policy if exists "Subcontractors can submit bounded daily site reports" on public.daily_site_reports;
drop policy if exists "Subcontractors can read active contacts" on public.contacts;
drop policy if exists "Subcontractors can read active policies" on public.policies;
drop policy if exists "Subcontractors can read active announcements" on public.announcements;

revoke all on public.subcontractor_portal_activity from anon;
revoke insert, update, truncate, references, trigger on public.subcontractor_portal_activity from authenticated;

-- The admin dashboard's "Job Board Sign-ins" card: the latest board logins and site sign-ins on every board.
create or replace function private.jgc_get_recent_job_board_signins(p_limit integer)
returns jsonb
language plpgsql
stable security definer
set search_path to ''
as $function$
declare rows_value jsonb;
begin
  if not private.jgc_job_board_admin() then raise exception 'Approved administrator access required' using errcode='42501'; end if;
  select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at desc), '[]'::jsonb) into rows_value
  from (
    select a.id, a.action, a.actor_name, a.actor_company, a.actor_email, a.identity_type, a.created_at,
           b.job_number, b.job_name
    from public.job_board_activity a
    join public.job_boards b on b.id = a.board_id
    where a.action in ('visit', 'site-signin')
    order by a.created_at desc
    limit greatest(1, least(coalesce(p_limit, 8), 50))
  ) q;
  return rows_value;
end $function$;

revoke all on function private.jgc_get_recent_job_board_signins(integer) from public, anon;
grant execute on function private.jgc_get_recent_job_board_signins(integer) to authenticated;

create or replace function public.get_recent_job_board_signins(p_limit integer default 8)
returns jsonb
language sql
stable
set search_path to ''
as $function$ select private.jgc_get_recent_job_board_signins(p_limit) $function$;

revoke all on function public.get_recent_job_board_signins(integer) from public, anon;
grant execute on function public.get_recent_job_board_signins(integer) to authenticated, service_role;
