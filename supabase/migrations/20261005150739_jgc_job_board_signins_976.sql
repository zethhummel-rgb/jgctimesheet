-- Release 976: attendance and login history only. Existing document ACLs stay protected.
begin;
alter table public.job_board_activity add column reason text not null default '' check (length(reason)<=1000);
alter table public.job_board_activity add column submission_id uuid;
create unique index job_board_site_submission_idx on public.job_board_activity(board_id,submission_id) where submission_id is not null;
alter table public.job_board_activity drop constraint job_board_activity_action_check;
alter table public.job_board_activity add constraint job_board_activity_action_check check(action in ('visit','site-signin','open-board','view-document','email-link','download-request','upload','publish','archive','return-pending','edit-document','disable','enable','rotate-token','grant-viewer','revoke-viewer','create-board'));

create or replace function private.jgc_job_board_append(p_board_id uuid,p_action text,p_document_id uuid,p_actor jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare stamp timestamptz;
begin
  if p_action is distinct from 'visit' then return; end if;
  perform pg_advisory_xact_lock(hashtextextended('job-board-history:'||p_board_id::text,0));
  select greatest(clock_timestamp(),coalesce(max(created_at)+interval '1 microsecond',clock_timestamp())) into stamp from public.job_board_activity where board_id=p_board_id;
  insert into public.job_board_activity(board_id,document_id,document_title,actor_profile_id,actor_name,actor_company,actor_email,identity_type,action,created_at)
  values(p_board_id,null,'',nullif(p_actor->>'profile_id','')::uuid,coalesce(p_actor->>'name',''),coalesce(p_actor->>'company',''),coalesce(p_actor->>'email',''),coalesce(p_actor->>'identity_type','visitor'),'visit',stamp);
end $$;

create function private.jgc_record_job_board_site_signin(p_token text,p_name text,p_company text,p_reason text,p_submission_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.job_boards; existing public.job_board_activity; stamp timestamptz; name_value text := btrim(coalesce(p_name,'')); company_value text := btrim(coalesce(p_company,'')); reason_value text := btrim(coalesce(p_reason,''));
begin
  select * into b from public.job_boards where token=p_token and enabled;
  if b.id is null then raise exception 'Job Board unavailable' using errcode='42501'; end if;
  if length(name_value) not between 1 and 150 or length(company_value) not between 1 and 150 or length(reason_value)>1000 or p_submission_id is null then raise exception 'Enter your name and company. Reason must be at most 1000 characters.' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('job-board-history:'||b.id::text,0));
  select * into existing from public.job_board_activity where board_id=b.id and submission_id=p_submission_id;
  if existing.id is not null then
    if existing.actor_name<>name_value or existing.actor_company<>company_value or existing.reason<>reason_value then raise exception 'Sign-in retry does not match the original submission' using errcode='22023'; end if;
    return jsonb_build_object('ok',true,'recorded_at',existing.created_at);
  end if;
  select greatest(clock_timestamp(),coalesce(max(created_at)+interval '1 microsecond',clock_timestamp())) into stamp from public.job_board_activity where board_id=b.id;
  insert into public.job_board_activity(board_id,actor_name,actor_company,actor_email,identity_type,action,created_at,reason,submission_id)
  values(b.id,name_value,company_value,'','visitor','site-signin',stamp,reason_value,p_submission_id);
  return jsonb_build_object('ok',true,'recorded_at',stamp);
end $$;
create function public.record_job_board_site_signin(p_token text,p_name text,p_company text,p_reason text,p_submission_id uuid)
returns jsonb language sql security invoker set search_path='' as $$ select private.jgc_record_job_board_site_signin(p_token,p_name,p_company,p_reason,p_submission_id) $$;
revoke all on function private.jgc_record_job_board_site_signin(text,text,text,text,uuid),public.record_job_board_site_signin(text,text,text,text,uuid) from public;
grant execute on function private.jgc_record_job_board_site_signin(text,text,text,text,uuid),public.record_job_board_site_signin(text,text,text,text,uuid) to anon,authenticated;
revoke all on function private.jgc_job_board_append(uuid,text,uuid,jsonb) from public,anon,authenticated;

create or replace function private.jgc_get_job_board_activity(p_board_id uuid,p_before timestamptz,p_limit integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare rows_value jsonb; cursor_value timestamptz;
begin
  if not private.jgc_job_board_admin() then raise exception 'Approved administrator access required' using errcode='42501'; end if;
  if not exists(select 1 from public.job_boards where id=p_board_id) then raise exception 'Job Board unavailable'; end if;
  select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at desc),'[]'::jsonb),min(q.created_at) into rows_value,cursor_value from (
    select id,actor_name,actor_company,actor_email,identity_type,action,created_at,reason from public.job_board_activity
    where board_id=p_board_id and action in ('visit','site-signin') and (p_before is null or created_at<p_before) order by created_at desc limit greatest(1,least(coalesce(p_limit,50),100))) q;
  if not exists(select 1 from public.job_board_activity where board_id=p_board_id and action in ('visit','site-signin') and created_at<cursor_value) then cursor_value := null; end if;
  return jsonb_build_object('events',rows_value,'next_before',cursor_value);
end $$;
commit;
