-- Release 995 (Zeth, 2026-10-06).
--
-- 1) A deleted report stayed on the Job Board. Saving a report attaches a copy to the job's board
--    (jgc_job_board_auto_attach_staff_form), but deleting the report never touched that copy, so the
--    board kept showing it (job 26142 showed two JSAs today while Safety Records and Today's Reports
--    showed one). Deleting a source report now archives its board copy: it leaves the board, and the
--    row and file are kept. Sign-off rows are left as they are.
create or replace function private.jgc_job_board_archive_deleted_source()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  update public.job_board_documents set status='archived', updated_at=now()
  where source_type=tg_table_name and source_id=old.id and status<>'archived';
  return old;
end $function$;
revoke all on function private.jgc_job_board_archive_deleted_source() from public;

do $$
declare t text;
begin
  foreach t in array array['inspection_records','daily_site_reports','toolbox_talk_reports','incident_reports','accident_reports','employee_injury_reports'] loop
    execute format('drop trigger if exists jgc_job_board_archive_deleted_source on public.%I', t);
    execute format('create trigger jgc_job_board_archive_deleted_source after delete on public.%I for each row execute function private.jgc_job_board_archive_deleted_source()', t);
  end loop;
end $$;

-- Board copies whose report was already deleted (one JSA on job 26142 on 2026-10-06).
update public.job_board_documents d set status='archived', updated_at=now()
where d.status<>'archived' and d.source_id is not null and (
  (d.source_type='inspection_records' and not exists(select 1 from public.inspection_records r where r.id=d.source_id)) or
  (d.source_type='daily_site_reports' and not exists(select 1 from public.daily_site_reports r where r.id=d.source_id)) or
  (d.source_type='toolbox_talk_reports' and not exists(select 1 from public.toolbox_talk_reports r where r.id=d.source_id)) or
  (d.source_type='incident_reports' and not exists(select 1 from public.incident_reports r where r.id=d.source_id)) or
  (d.source_type='accident_reports' and not exists(select 1 from public.accident_reports r where r.id=d.source_id)) or
  (d.source_type='employee_injury_reports' and not exists(select 1 from public.employee_injury_reports r where r.id=d.source_id)));

-- 2) "On site today": signed-in JGC staff on a Job Board can see who signed in on site today, so everyone
--    can be accounted for in an emergency. Today's site sign-ins only (Toronto date), one line per person
--    with their first and last sign-in time. Visitors cannot see this list; the full history stays admin-only.
create or replace function private.jgc_get_job_board_onsite_today(p_token text)
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to ''
as $function$
declare b public.job_boards; today date := (now() at time zone 'America/Toronto')::date; people jsonb;
begin
  if not private.jgc_job_board_staff() then raise exception 'Sign in with your JGC account to see who is on site' using errcode='42501'; end if;
  select * into b from public.job_boards where token=p_token and enabled;
  if b.id is null then raise exception 'Job Board unavailable' using errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('name',q.name,'company',q.company,'first_at',q.first_at,'last_at',q.last_at,'count',q.n) order by q.first_at),'[]'::jsonb)
  into people
  from (select min(actor_name) name, min(actor_company) company, min(created_at) first_at, max(created_at) last_at, count(*)::integer n
        from public.job_board_activity
        where board_id=b.id and action='site-signin' and (created_at at time zone 'America/Toronto')::date=today
        group by lower(btrim(actor_name)), lower(btrim(actor_company))) q;
  return jsonb_build_object('date',today,'people',people);
end $function$;

create or replace function public.get_job_board_onsite_today(p_token text)
 returns jsonb
 language sql
 stable
 set search_path to ''
as $function$ select private.jgc_get_job_board_onsite_today(p_token) $function$;

revoke all on function private.jgc_get_job_board_onsite_today(text) from public, anon;
grant execute on function private.jgc_get_job_board_onsite_today(text) to authenticated;
revoke all on function public.get_job_board_onsite_today(text) from public, anon;
grant execute on function public.get_job_board_onsite_today(text) to authenticated, service_role;
