-- Additive REVIEW COPY. Apply only with specific approval, after job-board-setup.sql.
begin;
create function public.list_job_board_sources(p_board_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare b public.job_boards; result jsonb;
begin
  if not private.jgc_job_board_admin() then raise exception 'Approved administrator required' using errcode='42501'; end if;
  select * into b from public.job_boards where id=p_board_id;
  if b.id is null then raise exception 'Job Board unavailable'; end if;
  select coalesce(jsonb_agg(to_jsonb(s) order by s.report_date desc,s.title),'[]'::jsonb) into result from (
    select 'inspection_records'::text source_type,r.id source_id,coalesce(nullif(r.title,''),r.inspection_type,'Inspection') title,
      case when r.inspection_type ilike 'JSA' then 'jsa' when r.inspection_type ilike '%permit%' then 'permit' else 'inspection' end category,
      r.inspection_date report_date,'job-number'::text match
    from public.inspection_records r where private.jgc_job_board_source_matches(to_jsonb(r),b.id,b.job_number)
    union all
    select 'toolbox_talk_reports',r.id,coalesce(r.talk_title,'Toolbox talk'),'toolbox-talk',r.report_date,'job-number'
    from public.toolbox_talk_reports r where private.jgc_job_board_source_matches(to_jsonb(r),b.id,b.job_number) and not coalesce(r.is_duplicate,false)
    union all
    select 'daily_site_reports',r.id,'Daily site report','daily-report',r.report_date,'job-number'
    from public.daily_site_reports r where private.jgc_job_board_source_matches(to_jsonb(r),b.id,b.job_number)
    union all
    select 'incident_reports',r.id,coalesce(r.incident_type,'Incident report'),'accident-incident',r.report_date,'job-number'
    from public.incident_reports r where private.jgc_job_board_source_matches(to_jsonb(r),b.id,b.job_number)
    union all
    select 'accident_reports',r.id,'Supervisor accident investigation','accident-incident',r.accident_date,'job-number'
    from public.accident_reports r where private.jgc_job_board_source_matches(to_jsonb(r),b.id,b.job_number)
    union all
    select 'employee_injury_reports',r.id,'Employee injury report','accident-incident',r.accident_date,'job-number'
    from public.employee_injury_reports r where private.jgc_job_board_source_matches(to_jsonb(r),b.id,b.job_number)
    union all
    select 'policies',r.id,r.title,'jgc-policy',(now() at time zone 'America/Toronto')::date,'company-policy'
    from public.policies r where r.is_active=true
  ) s where not exists(select 1 from public.job_board_documents d where d.board_id=b.id and d.source_type=s.source_type and d.source_id=s.source_id);
  return result;
end $$;
revoke all on function public.list_job_board_sources(uuid) from public,anon;
grant execute on function public.list_job_board_sources(uuid) to authenticated;
commit;
