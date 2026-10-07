-- Release 996 (Zeth, 2026-10-07): "when there is a prepared/draft jsa and the day for the JSA has arrived it
-- should show up in todays JSA's and on the job board. That way someone can activate it and use it that day.
-- Currently it is hard to find where it is"
--
-- Prepared JSAs stay office-only to create and edit (save_prepared_jsa is unchanged). On the JSA's work date,
-- approved JGC staff can now find it (Today's Reports, the job's Job Board), open it and activate it with
-- today's Workers Onsite. The work-date rule in activation is unchanged, so nobody can activate early.

-- Today's prepared JSAs that have not been activated yet. With a Job Board token, only that job's.
create or replace function private.jgc_list_today_prepared_jsas(p_token text)
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to ''
as $function$
declare b public.job_boards; today text := ((now() at time zone 'America/Toronto')::date)::text;
begin
  if auth.uid() is null or not (public.is_admin() or private.jgc_job_board_staff()) then
    raise exception 'Sign in with your JGC account to see prepared JSAs' using errcode='42501';
  end if;
  if p_token is not null then
    select * into b from public.job_boards where token=p_token and enabled;
    if b.id is null then raise exception 'Job Board unavailable' using errcode='42501'; end if;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id',p.id,
      'work_date',p.payload#>>'{record,inspection_date}',
      'project',(select f->>'value' from jsonb_array_elements(coalesce(p.payload#>'{record,form_data,fields}','[]'::jsonb)) f where f->>'label'='Project / Job' limit 1),
      'location',(select f->>'value' from jsonb_array_elements(coalesce(p.payload#>'{record,form_data,fields}','[]'::jsonb)) f where f->>'label' ~* '^location' limit 1),
      'prepared_by',coalesce(nullif(trim(pr.display_name),''),'JGC office'),
      'updated_at',p.updated_at) order by p.updated_at desc)
    from public.jsa_preparations p left join public.profiles pr on pr.id=p.created_by
    where p.activated_at is null and p.payload#>>'{record,inspection_date}'=today
      and (b.id is null or private.jgc_job_board_source_matches(p.payload->'record',b.id,b.job_number))),'[]'::jsonb);
end $function$;

-- Open one prepared JSA: admins any time; JGC staff on its work date.
create or replace function private.jgc_get_prepared_jsa(p_id uuid)
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to ''
as $function$
declare item public.jsa_preparations; admin boolean := public.is_admin();
begin
  if auth.uid() is null or not (admin or private.jgc_job_board_staff()) then
    raise exception 'Sign in with your JGC account to open prepared JSAs' using errcode='42501';
  end if;
  select * into item from public.jsa_preparations where id=p_id;
  if item.id is null then raise exception 'Prepared JSA not found'; end if;
  if not admin and item.payload#>>'{record,inspection_date}' is distinct from ((now() at time zone 'America/Toronto')::date)::text then
    raise exception 'JGC staff can open a prepared JSA on its work date. Ask the office to open it before then.' using errcode='42501';
  end if;
  return to_jsonb(item);
end $function$;

-- Activation: admins as before, plus JGC staff. The work-date check below still applies to everyone.
create or replace function private.jgc_activate_prepared_jsa(p_id uuid, p_revision integer, p_mode text, p_attendees jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare item public.jsa_preparations; model jsonb; workers jsonb;
begin
  if auth.uid() is null or not (public.is_admin() or private.jgc_job_board_staff()) then raise exception 'Sign in with your JGC account to activate this JSA' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
  select * into item from public.jsa_preparations where id=p_id for update;
  if not found then raise exception 'Draft not found'; end if;
  if item.activated_at is null then
    if item.revision is distinct from p_revision then raise exception 'This draft changed elsewhere. Reopen it before activation' using errcode='40001'; end if;
    if p_mode is distinct from 'workers' then raise exception 'Use Complete and Worker Sign Off'; end if;
    if (item.payload#>>'{record,inspection_date}')::date<>(now() at time zone 'America/Toronto')::date then raise exception 'Worker sign-off is available only on the JSA work date'; end if;
    if p_attendees is null or jsonb_typeof(p_attendees)<>'array' or jsonb_array_length(p_attendees) not between 1 and 500 then raise exception 'Workers Onsite are required'; end if;
    select jsonb_agg(jsonb_build_object('employee_id',value->>'matched_employee_id','name',value->>'attendee_name','company',value->>'attendee_company')) into workers from jsonb_array_elements(p_attendees);
    model:=private.jgc_save_worker_jsa(p_id,0,item.payload->'record',workers);
    update public.jsa_worker_workflows set prepared_in_advance=((item.created_at at time zone 'America/Toronto')::date<valid_date) where record_id=p_id;
    model:=private.jgc_request_jsa_worker_signoff(p_id);
    update public.jsa_preparations set activated_at=now(),activated_by=auth.uid(),record_id=p_id,acknowledgement_mode='workers',updated_at=now() where id=p_id returning * into item;
  else
    -- Idempotent activation also preserves signatures on historical active drafts.
    model:=private.jgc_jsa_worker_model(item.record_id);
  end if;
  return model||jsonb_build_object('draft',to_jsonb(item));
end $function$;

create or replace function public.list_today_prepared_jsas(p_token text default null)
 returns jsonb
 language sql
 stable
 set search_path to ''
as $function$ select private.jgc_list_today_prepared_jsas(p_token) $function$;

create or replace function public.get_prepared_jsa(p_id uuid)
 returns jsonb
 language sql
 stable
 set search_path to ''
as $function$ select private.jgc_get_prepared_jsa(p_id) $function$;

revoke all on function private.jgc_list_today_prepared_jsas(text) from public, anon;
revoke all on function private.jgc_get_prepared_jsa(uuid) from public, anon;
grant execute on function private.jgc_list_today_prepared_jsas(text) to authenticated;
grant execute on function private.jgc_get_prepared_jsa(uuid) to authenticated;
revoke all on function public.list_today_prepared_jsas(text) from public, anon;
revoke all on function public.get_prepared_jsa(uuid) from public, anon;
grant execute on function public.list_today_prepared_jsas(text) to authenticated, service_role;
grant execute on function public.get_prepared_jsa(uuid) to authenticated, service_role;
