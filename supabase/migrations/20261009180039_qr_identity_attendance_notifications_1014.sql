-- New counters/nonces are internal only; existing safety and sign-in history is retained.
CREATE TABLE private.jgc_request_limits(scope text PRIMARY KEY,window_at timestamptz NOT NULL,requests integer NOT NULL);
ALTER TABLE private.jgc_request_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.jgc_request_limits FROM PUBLIC,anon,authenticated;
CREATE FUNCTION private.jgc1014_limit(p_scope text,p_max integer,p_window interval) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE n integer; stamp timestamptz:=clock_timestamp();
BEGIN
  INSERT INTO private.jgc_request_limits(scope,window_at,requests) VALUES(p_scope,stamp,1)
  ON CONFLICT(scope) DO UPDATE SET requests=CASE WHEN private.jgc_request_limits.window_at+p_window<=stamp THEN 1 ELSE private.jgc_request_limits.requests+1 END,
    window_at=CASE WHEN private.jgc_request_limits.window_at+p_window<=stamp THEN stamp ELSE private.jgc_request_limits.window_at END RETURNING requests INTO n;
  IF n>p_max THEN RAISE EXCEPTION 'Too many requests. Please try again later.' USING ERRCODE='54000'; END IF;
END $function$;
REVOKE ALL ON FUNCTION private.jgc1014_limit(text,integer,interval) FROM PUBLIC,anon,authenticated;

ALTER TABLE public.job_board_visitor_sessions ADD COLUMN purpose text NOT NULL DEFAULT 'portal' CHECK(purpose IN ('portal','site-only'));
ALTER TABLE public.job_board_visitor_sessions DROP CONSTRAINT job_board_visitor_sessions_actor_email_check;
ALTER TABLE public.job_board_visitor_sessions ADD CONSTRAINT job_board_visitor_sessions_actor_email_check CHECK ((purpose='site-only' AND actor_email='') OR length(actor_email) BETWEEN 3 AND 254);
CREATE TABLE private.jgc_site_signin_nonces(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),board_id uuid NOT NULL REFERENCES public.job_boards(id),visit_id uuid NOT NULL REFERENCES public.job_board_visitor_sessions(id),created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL DEFAULT now()+interval '10 minutes',event_id uuid,reason text);
CREATE TABLE private.jgc_site_signin_confirmations(event_id uuid PRIMARY KEY REFERENCES public.job_board_activity(id),confirmed_by uuid NOT NULL REFERENCES public.profiles(id),confirmed_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE private.jgc_site_signin_nonces ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.jgc_site_signin_confirmations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.jgc_site_signin_nonces,private.jgc_site_signin_confirmations FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.begin_job_board_site_signin(p_token text,p_visit_token uuid,p_name text,p_company text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE b public.job_boards;s public.job_board_visitor_sessions;p public.profiles;visit uuid:=p_visit_token;nonce uuid;name_value text;company_value text;kind text;
BEGIN
  SELECT * INTO b FROM public.job_boards WHERE token=p_token AND enabled;
  IF b.id IS NULL THEN RAISE EXCEPTION 'Job Board unavailable' USING ERRCODE='42501';END IF;
  IF auth.uid() IS NOT NULL THEN
    SELECT * INTO p FROM public.profiles WHERE id=auth.uid() AND account_status IN ('approved','limited');
    IF p.id IS NULL THEN RAISE EXCEPTION 'Account access unavailable' USING ERRCODE='42501';END IF;
  END IF;
  IF visit IS NOT NULL THEN s:=private.jgc_job_board_visit(b.id,visit);IF s.id IS NULL THEN RAISE EXCEPTION 'Please sign in again.' USING ERRCODE='42501';END IF;END IF;
  IF s.id IS NULL THEN
    kind:=CASE WHEN private.jgc_job_board_staff() THEN 'staff' ELSE 'visitor' END;
    name_value:=CASE WHEN p.id IS NOT NULL THEN coalesce(nullif(btrim(p.display_name),''),p.worker_key) ELSE btrim(p_name) END;
    company_value:=CASE WHEN kind='staff' THEN 'John Gordon Construction' ELSE btrim(p_company) END;
    IF coalesce(length(name_value),0) NOT BETWEEN 2 AND 150 OR coalesce(length(company_value),0) NOT BETWEEN 1 AND 150 THEN RAISE EXCEPTION 'Enter your name and company.' USING ERRCODE='22023';END IF;
    IF kind<>'staff' THEN PERFORM private.jgc1014_limit('site-session-hour:'||b.id,300,interval '1 hour');PERFORM private.jgc1014_limit('site-session-day:'||b.id,1000,interval '1 day');END IF;
    visit:=gen_random_uuid();
    INSERT INTO public.job_board_visitor_sessions(board_id,token_hash,profile_id,actor_name,actor_company,actor_email,identity_type,purpose,expires_at)
      VALUES(b.id,private.jgc_job_board_token_hash(visit),p.id,name_value,company_value,coalesce(p.email,''),kind,'site-only',clock_timestamp()+interval '15 minutes') RETURNING * INTO s;
  END IF;
  PERFORM private.jgc1014_limit('site-nonce:'||s.id,5,interval '1 hour');
  INSERT INTO private.jgc_site_signin_nonces(board_id,visit_id) VALUES(b.id,s.id) RETURNING id INTO nonce;
  RETURN jsonb_build_object('nonce',nonce,'visit_token',visit,'name',s.actor_name,'company',s.actor_company,'expires_at',clock_timestamp()+interval '10 minutes');
END $function$;
REVOKE ALL ON FUNCTION public.begin_job_board_site_signin(text,uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.begin_job_board_site_signin(text,uuid,text,text) TO anon,authenticated;

-- The old entry point cannot bypass the live-session/nonce requirement.
REVOKE ALL ON FUNCTION public.record_job_board_site_signin(text,text,text,text,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION private.jgc_record_job_board_site_signin(text,text,text,text,uuid) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.record_job_board_site_signin(p_token text,p_visit_token uuid,p_submission_id uuid,p_reason text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE b public.job_boards;s public.job_board_visitor_sessions;n private.jgc_site_signin_nonces;event uuid;stamp timestamptz;reason_value text:=btrim(coalesce(p_reason,''));
BEGIN
  IF length(reason_value)>1000 THEN RAISE EXCEPTION 'Reason must be at most 1000 characters.' USING ERRCODE='22023';END IF;
  SELECT * INTO b FROM public.job_boards WHERE token=p_token AND enabled;
  IF b.id IS NULL THEN RAISE EXCEPTION 'Job Board unavailable' USING ERRCODE='42501';END IF;
  SELECT * INTO s FROM public.job_board_visitor_sessions WHERE board_id=b.id AND token_hash=private.jgc_job_board_token_hash(p_visit_token) AND revoked_at IS NULL AND expires_at>clock_timestamp()
    AND ((profile_id IS NULL AND auth.uid() IS NULL) OR profile_id=auth.uid());
  IF s.id IS NULL THEN RAISE EXCEPTION 'Please sign in again.' USING ERRCODE='42501';END IF;
  IF s.profile_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=s.profile_id AND account_status IN ('approved','limited')) THEN RAISE EXCEPTION 'Account access unavailable' USING ERRCODE='42501';END IF;
  SELECT * INTO n FROM private.jgc_site_signin_nonces WHERE id=p_submission_id AND board_id=b.id AND visit_id=s.id FOR UPDATE;
  IF n.id IS NULL THEN RAISE EXCEPTION 'Start a fresh site sign-in.' USING ERRCODE='42501';END IF;
  IF n.event_id IS NOT NULL THEN
    IF n.reason IS DISTINCT FROM reason_value THEN RAISE EXCEPTION 'Sign-in retry does not match.' USING ERRCODE='22023';END IF;
    SELECT created_at INTO stamp FROM public.job_board_activity WHERE id=n.event_id;
    RETURN jsonb_build_object('ok',true,'recorded_at',stamp,'verified',s.identity_type='staff');
  END IF;
  IF n.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Site sign-in expired. Start again.' USING ERRCODE='42501';END IF;
  PERFORM private.jgc1014_limit('site-signin:'||s.id,2,interval '1 day');
  PERFORM private.jgc1014_limit('site-signin-board:'||b.id,1000,interval '1 day');
  stamp:=clock_timestamp();
  INSERT INTO public.job_board_activity(board_id,actor_profile_id,actor_name,actor_company,actor_email,identity_type,action,created_at,reason,submission_id)
    VALUES(b.id,s.profile_id,s.actor_name,s.actor_company,s.actor_email,s.identity_type,'site-signin',stamp,reason_value,n.id) RETURNING id INTO event;
  UPDATE private.jgc_site_signin_nonces SET event_id=event,reason=reason_value WHERE id=n.id;
  RETURN jsonb_build_object('ok',true,'recorded_at',stamp,'verified',s.identity_type='staff');
END $function$;
REVOKE ALL ON FUNCTION public.record_job_board_site_signin(text,uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_job_board_site_signin(text,uuid,uuid,text) TO anon,authenticated;

CREATE FUNCTION public.confirm_job_board_site_signin(p_event_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
BEGIN
  IF NOT private.jgc_job_board_admin() THEN RAISE EXCEPTION 'Admin access required.' USING ERRCODE='42501';END IF;
  IF NOT EXISTS(SELECT 1 FROM public.job_board_activity WHERE id=p_event_id AND action='site-signin') THEN RAISE EXCEPTION 'Site sign-in unavailable.' USING ERRCODE='22023';END IF;
  INSERT INTO private.jgc_site_signin_confirmations(event_id,confirmed_by) VALUES(p_event_id,auth.uid()) ON CONFLICT DO NOTHING;
END $function$;
REVOKE ALL ON FUNCTION public.confirm_job_board_site_signin(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.confirm_job_board_site_signin(uuid) TO authenticated;

-- Restrict browser-authored notifications to approved admins. Employees use source-bound RPCs below.
DROP POLICY notifications_insert_admin_or_creator ON public.notifications;
CREATE POLICY notifications_insert_approved_admin ON public.notifications FOR INSERT TO authenticated WITH CHECK(private.jgc_has_full_portal_access() AND EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND role='admin' AND account_status='approved') AND created_by=auth.uid());
REVOKE ALL ON public.notifications FROM PUBLIC,anon;
REVOKE UPDATE ON public.notifications FROM authenticated;
GRANT UPDATE(clicked_at,cleared_at,updated_at) ON public.notifications TO authenticated;
CREATE FUNCTION private.jgc1014_notification_recipient(n public.notifications) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $function$
 SELECT private.jgc_has_full_portal_access() AND EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.account_status='approved' AND
  (p.role='admin' OR n.target_profile_id=p.id OR (n.target_profile_id IS NULL AND
   ((nullif(btrim(n.target_worker_key),'') IS NOT NULL AND lower(btrim(n.target_worker_key))=lower(btrim(p.worker_key))) OR
    (nullif(btrim(n.target_worker_email),'') IS NOT NULL AND lower(btrim(n.target_worker_email))=lower(auth.jwt()->>'email')) OR
    (coalesce(n.target_worker_key,'')='' AND coalesce(n.target_worker_email,'')='' AND lower(n.target_role)=lower(p.role))))));
$function$;
REVOKE ALL ON FUNCTION private.jgc1014_notification_recipient(public.notifications) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.jgc1014_notification_recipient(public.notifications) TO authenticated;
DROP POLICY notifications_select_own_role_or_admin ON public.notifications;
CREATE POLICY notifications_select_own_role_or_admin ON public.notifications FOR SELECT TO authenticated USING(private.jgc1014_notification_recipient(notifications));
DROP POLICY notifications_update_own_role_or_admin ON public.notifications;
CREATE POLICY notifications_update_own_role_or_admin ON public.notifications FOR UPDATE TO authenticated USING(private.jgc1014_notification_recipient(notifications)) WITH CHECK(private.jgc1014_notification_recipient(notifications));

CREATE FUNCTION public.publish_portal_workflow_notification(p_notification_type text,p_source_table text,p_source_id text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE actor public.profiles;source jsonb;target public.profiles;title_value text;message_value text;link_value text;version_value text;recipients uuid[];notice_id uuid;notice_ids uuid[]:='{}';setting public.notification_settings;recipient_meta jsonb;ack_id uuid;group_result jsonb;group_ids jsonb:='[]'::jsonb;source_uuid uuid;
BEGIN
  IF NOT private.jgc_has_full_portal_access() THEN RAISE EXCEPTION 'Approved account required.' USING ERRCODE='42501';END IF;
  SELECT * INTO actor FROM public.profiles WHERE id=auth.uid() AND account_status='approved';
  IF p_source_table NOT IN ('vacation_requests','employee_writeups','work_orders','schedule_events','inspection_records','safety_acknowledgements') THEN RETURN jsonb_build_object('ok',true,'skipped',true,'reason','Notifications for this source are managed by the server.','notificationIds','[]'::jsonb);END IF;
  -- Existing safety callers group pending acknowledgements as type:record UUID.
  -- Resolve that group from the saved record; recipients never come from the browser.
  IF p_source_table='safety_acknowledgements' AND p_notification_type='jsa_acknowledgement' AND p_source_id ~* '^(jsa|toolbox|toolbox_talk):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    source_uuid:=split_part(p_source_id,':',2)::uuid;
    IF actor.role IS DISTINCT FROM 'admin' AND NOT EXISTS(SELECT 1 FROM public.inspection_records r WHERE r.id=source_uuid AND nullif(actor.worker_key,'') IS NOT NULL AND lower(r.worker_name)=lower(actor.worker_key)) THEN RAISE EXCEPTION 'Only the report creator can request these acknowledgements.' USING ERRCODE='42501';END IF;
    FOR ack_id IN SELECT a.id FROM public.safety_acknowledgements a WHERE a.record_id=source_uuid AND a.record_type IN ('jsa','toolbox','toolbox_talk') AND a.acknowledgement_status='pending' AND a.acknowledged_at IS NULL AND a.matched_employee_id IS NOT NULL AND a.attendee_key !~ '^jsa-(worker|external):' LOOP
      group_result:=public.publish_portal_workflow_notification(p_notification_type,p_source_table,ack_id::text);
      group_ids:=group_ids||coalesce(group_result->'notificationIds','[]'::jsonb);
    END LOOP;
    RETURN jsonb_build_object('ok',true,'inserted',jsonb_array_length(group_ids),'notificationIds',group_ids);
  END IF;
  IF p_source_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RAISE EXCEPTION 'Notification source unavailable.' USING ERRCODE='22023';END IF;
  EXECUTE format('select to_jsonb(s) from public.%I s where id=$1',p_source_table) INTO source USING p_source_id::uuid;
  IF source IS NULL THEN RAISE EXCEPTION 'Notification source unavailable.' USING ERRCODE='42501';END IF;
  IF p_source_table='vacation_requests' AND p_notification_type='vacation_request' THEN
    IF (nullif(actor.worker_key,'') IS NULL OR lower(source->>'worker_name') IS DISTINCT FROM lower(actor.worker_key)) AND actor.role IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'This is not your vacation request.' USING ERRCODE='42501';END IF;
    title_value:='Vacation request';message_value:=left(coalesce(source->>'worker_display_name',actor.display_name)||' · '||coalesce(source->>'start_date','')||' through '||coalesce(source->>'end_date',''),400);link_value:='admin.html?tab=vacation';
    SELECT array_agg(id) INTO recipients FROM public.profiles WHERE account_status='approved' AND role IN ('admin','supervisor');
  ELSIF p_source_table='employee_writeups' AND p_notification_type='employee_writeup' THEN
    IF source->>'employee_profile_id' IS DISTINCT FROM auth.uid()::text OR source->>'acknowledged_at' IS NULL OR NOT EXISTS(SELECT 1 FROM public.employee_writeup_acknowledgements WHERE writeup_id=p_source_id::uuid AND employee_profile_id=auth.uid() AND version=(source->>'current_version')::integer) THEN RAISE EXCEPTION 'A personal acknowledgement is required.' USING ERRCODE='42501';END IF;
    title_value:='Write-up acknowledged';message_value:=left(coalesce(source->>'employee_name',actor.display_name)||' acknowledged version '||(source->>'current_version')||'.',400);link_value:='employee-writeups-admin.html?id='||p_source_id;
    SELECT array_agg(id) INTO recipients FROM public.profiles WHERE account_status='approved' AND role='admin';
  ELSIF p_source_table='work_orders' AND p_notification_type='wo_hours_requested' THEN
    IF source->>'created_by' IS DISTINCT FROM auth.uid()::text AND actor.role IS DISTINCT FROM 'admin' AND NOT EXISTS(SELECT 1 FROM public.work_order_labour WHERE work_order_id=p_source_id::uuid AND employee_id=auth.uid()) THEN RAISE EXCEPTION 'This Work Order is not assigned to you.' USING ERRCODE='42501';END IF;
    title_value:='WO hours requested';message_value:=left(concat_ws(' · ',source->>'wo_number',source->>'job_number',source->>'job_name',source->>'work_order_date'),400);link_value:='timesheet.html';
    SELECT array_agg(DISTINCT p.id) INTO recipients FROM public.work_order_labour l JOIN public.profiles p ON p.id=l.employee_id WHERE l.work_order_id=p_source_id::uuid AND NOT coalesce(l.complete,false) AND p.account_status='approved'
      AND (source->>'created_by'=auth.uid()::text OR actor.role='admin' OR p.id=auth.uid());
  ELSIF p_source_table='schedule_events' AND p_notification_type='schedule_update' THEN
    IF source->>'created_by' IS DISTINCT FROM auth.uid()::text AND actor.role IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'Only the schedule creator can publish this update.' USING ERRCODE='42501';END IF;
    title_value:='Schedule updated';message_value:=left(concat_ws(' · ',source->>'event_date',source->>'start_time',source->>'title',source->>'job_name'),400);link_value:='schedule.html';
    SELECT array_agg(p.id) INTO recipients FROM public.profiles p WHERE p.account_status='approved' AND EXISTS(SELECT 1 FROM jsonb_array_elements_text(case when jsonb_typeof(source->'employee_keys')='array' then source->'employee_keys' else '[]'::jsonb end) k WHERE lower(k)=lower(p.worker_key));
  ELSIF p_source_table='safety_acknowledgements' AND p_notification_type='jsa_acknowledgement' THEN
    IF source->>'matched_employee_id' IS DISTINCT FROM auth.uid()::text AND actor.role IS DISTINCT FROM 'admin' AND NOT EXISTS(SELECT 1 FROM public.inspection_records r WHERE r.id=(source->>'record_id')::uuid AND nullif(actor.worker_key,'') IS NOT NULL AND lower(r.worker_name)=lower(actor.worker_key)) THEN RAISE EXCEPTION 'This acknowledgement is not assigned to you.' USING ERRCODE='42501';END IF;
    IF coalesce(source->>'acknowledgement_status','')<>'pending' OR coalesce(source->>'record_date','')<>(now() AT TIME ZONE 'America/Toronto')::date::text THEN RETURN jsonb_build_object('ok',true,'skipped',true,'reason','No current pending sign-off.','notificationIds','[]'::jsonb);END IF;
    title_value:='Safety report to acknowledge';message_value:='Review your assigned safety report for today.';link_value:='todays-inspections.html';recipients:=ARRAY[(source->>'matched_employee_id')::uuid];
  ELSIF p_source_table='inspection_records' AND p_notification_type='inspection_issue' THEN
    IF (nullif(actor.worker_key,'') IS NULL OR lower(source->>'worker_name') IS DISTINCT FROM lower(actor.worker_key)) AND actor.role IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'This is not your inspection.' USING ERRCODE='42501';END IF;
    IF coalesce((source->'summary'->>'failed_count')::integer,0)<1 THEN RETURN jsonb_build_object('ok',true,'skipped',true,'reason','No inspection issue.','notificationIds','[]'::jsonb);END IF;
    title_value:='Inspection issue';message_value:=left(concat_ws(' · ',source->>'inspection_type',source->>'equipment_name',source->>'inspection_date'),400);link_value:='admin.html?tab=inspections';
    SELECT array_agg(id) INTO recipients FROM public.profiles WHERE account_status='approved' AND role IN ('admin','supervisor');
  ELSE RAISE EXCEPTION 'This notification type does not match its source.' USING ERRCODE='22023';END IF;
  PERFORM private.jgc1014_limit('workflow-notice:'||auth.uid(),60,interval '1 hour');
  version_value:=coalesce(source->>'current_version',source->>'updated_at',source->>'created_at','1');
  SELECT * INTO setting FROM public.notification_settings WHERE notification_type=p_notification_type;
  FOR target IN SELECT * FROM public.profiles WHERE id=ANY(coalesce(recipients,'{}'::uuid[])) AND account_status='approved' LOOP
    IF (CASE target.role WHEN 'admin' THEN NOT coalesce(setting.admin_enabled,true) WHEN 'supervisor' THEN NOT coalesce(setting.supervisor_enabled,true) ELSE NOT coalesce(setting.employee_enabled,true) END) THEN CONTINUE;END IF;
    recipient_meta:=CASE WHEN p_source_table='work_orders' THEN jsonb_build_object('wo_number',source->>'wo_number','job_number',source->>'job_number','job_name',source->>'job_name','work_order_date',source->>'work_order_date') ELSE '{}'::jsonb END;
    notice_id:=NULL;
    INSERT INTO public.notifications(notification_type,title,message,link_url,target_profile_id,target_worker_key,target_worker_email,target_role,source_table,source_id,dedupe_key,metadata,created_by,created_by_name)
      VALUES(p_notification_type,title_value,message_value,link_value,target.id,coalesce(target.worker_key,''),'',coalesce(target.role,'worker'),p_source_table,p_source_id,'workflow-1014:'||p_notification_type||':'||p_source_id||':'||version_value||':'||target.id,recipient_meta,auth.uid(),coalesce(actor.display_name,actor.worker_key))
      ON CONFLICT(dedupe_key) DO NOTHING RETURNING id INTO notice_id;
    IF notice_id IS NOT NULL THEN notice_ids:=array_append(notice_ids,notice_id);END IF;
  END LOOP;
  RETURN jsonb_build_object('ok',true,'inserted',cardinality(notice_ids),'notificationIds',to_jsonb(notice_ids));
END $function$;
REVOKE ALL ON FUNCTION public.publish_portal_workflow_notification(text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.publish_portal_workflow_notification(text,text,text) TO authenticated;
CREATE OR REPLACE FUNCTION private.jgc_job_board_visit(p_board_id uuid, p_visit_token uuid)
 RETURNS job_board_visitor_sessions
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select s from public.job_board_visitor_sessions s
  where s.board_id=p_board_id and s.token_hash=private.jgc_job_board_token_hash(p_visit_token)
    and s.purpose='portal' and s.revoked_at is null and s.expires_at>now()
    and ((s.profile_id is null and auth.uid() is null) or (s.profile_id=auth.uid() and exists(select 1 from public.profiles p where p.id=s.profile_id and p.account_status in ('approved','limited'))));
$function$;
CREATE OR REPLACE FUNCTION private.jgc_register_job_board_visit(p_token text, p_name text, p_company text, p_email text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare b public.job_boards; p public.profiles; visit uuid; kind text; name_value text; company_value text; email_value text;
begin
  select * into b from public.job_boards where token=p_token and enabled;
  if b.id is null then raise exception 'Job Board unavailable' using errcode='42501'; end if;
  if auth.uid() is not null then
    select * into p from public.profiles where id=auth.uid();
    if p.id is null or p.account_status not in ('approved','limited') then raise exception 'Account access unavailable' using errcode='42501'; end if;
  end if;
  if private.jgc_job_board_staff() then
    kind := 'staff'; name_value := coalesce(nullif(trim(p.display_name),''),nullif(trim(p.worker_key),'')); company_value := 'John Gordon Construction'; email_value := lower(trim(p.email));
  else
    kind := case when p.id is null then 'visitor' else 'client' end;
    name_value := case when p.id is null then trim(p_name) else coalesce(nullif(trim(p.display_name),''),trim(p_name)) end;
    company_value := trim(p_company);
    email_value := lower(trim(case when p.id is null then p_email else p.email end));
  end if;
  if coalesce(length(name_value),0) not between 1 and 150 or coalesce(length(company_value),0) not between 1 and 150 or coalesce(length(email_value),0) not between 3 and 254 or email_value !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then raise exception 'Enter your name, company and valid email'; end if;
  perform pg_advisory_xact_lock(hashtextextended('job-board-visits:'||b.id::text,0));
  if (select count(*) from public.job_board_visitor_sessions where board_id=b.id and created_at>clock_timestamp()-interval '1 minute')>=120
    or (select count(*) from public.job_board_visitor_sessions where board_id=b.id and lower(actor_email)=email_value and created_at>clock_timestamp()-interval '1 minute')>=3 then raise exception 'Too many sign-in requests. Try again in a minute.' using errcode='54000'; end if;
  if kind<>'staff' then perform private.jgc1014_limit('portal-visits-hour:'||b.id,300,interval '1 hour'); perform private.jgc1014_limit('portal-visits-day:'||b.id,1000,interval '1 day'); end if;
  visit := gen_random_uuid();
  insert into public.job_board_visitor_sessions(board_id,token_hash,profile_id,actor_name,actor_company,actor_email,identity_type)
  values(b.id,private.jgc_job_board_token_hash(visit),p.id,name_value,company_value,email_value,kind);
  perform private.jgc_job_board_append(b.id,'visit',null,jsonb_build_object('profile_id',p.id,'name',name_value,'company',company_value,'email',email_value,'identity_type',kind));
  return jsonb_build_object('visit_token',visit,'expires_at',clock_timestamp()+interval '12 hours');
end $function$;
CREATE OR REPLACE FUNCTION private.jgc_get_job_board_onsite_today(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare b public.job_boards; today date := (now() at time zone 'America/Toronto')::date; people jsonb;
begin
  if not private.jgc_job_board_staff() then raise exception 'Sign in with your JGC account to see who is on site' using errcode='42501'; end if;
  select * into b from public.job_boards where token=p_token and enabled;
  if b.id is null then raise exception 'Job Board unavailable' using errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('name',q.name,'company',q.company,'first_at',q.first_at,'last_at',q.last_at,'count',q.n) order by q.first_at),'[]'::jsonb)
  into people
  from (select min(actor_name) name, min(actor_company) company, min(created_at) first_at, max(created_at) last_at, count(*)::integer n
        from public.job_board_activity
        where board_id=b.id and action='site-signin' and ((identity_type='staff' and actor_profile_id is not null) or exists(select 1 from private.jgc_site_signin_confirmations c where c.event_id=public.job_board_activity.id)) and (created_at at time zone 'America/Toronto')::date=today
        group by lower(btrim(actor_name)), lower(btrim(actor_company))) q;
  return jsonb_build_object('date',today,'people',people);
end $function$;
CREATE OR REPLACE FUNCTION public.submit_vehicle_qr_inspection(p_vehicle_id uuid, p_token text, p_record jsonb)
 RETURNS TABLE(success boolean, message text, record jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  clean_token text := trim(coalesce(p_token, ''));
  v_vehicle public.equipment_vehicles%rowtype;
  v_record public.vehicle_inspection_records%rowtype;
  v_driver_name text := nullif(trim(coalesce(p_record->>'driver_name', '')), '');
  v_status text := coalesce(nullif(trim(p_record->>'status'), ''), 'submitted');
  v_defects boolean := coalesce((p_record->>'defects_found')::boolean, false);
  v_major boolean := coalesce((p_record->>'major_defects_found')::boolean, false);
  v_vehicle_status text := coalesce(nullif(trim(p_record->>'vehicle_status_after_inspection'), ''), case when v_major then 'Out of Service / Needs Review' when v_defects then 'Needs Review' else 'Active' end);
  v_current_km numeric := nullif(coalesce(p_record->>'current_km', p_record->>'odometer', ''), '')::numeric;
  v_actor public.profiles; v_items jsonb; v_count integer; v_invalid integer;
  v_toronto_today date := (now() at time zone 'America/Toronto')::date;
begin
  if octet_length(p_record::text)>65536 or jsonb_typeof(p_record) IS DISTINCT FROM 'object' then raise exception 'Inspection content is too large or invalid.' using errcode='22023';end if;
  select * into v_vehicle from public.equipment_vehicles where id=p_vehicle_id and vehicle_qr_token=clean_token and coalesce(is_active,true) for update;
  if v_vehicle.id is null then return query select false,'This vehicle QR code is not active.'::text,null::jsonb;return;end if;
  if auth.uid() is not null and not private.jgc_has_full_portal_access() then raise exception 'An approved JGC account is required.' using errcode='42501';end if;
  select * into v_actor from public.profiles where id=auth.uid() and account_status='approved';
  if v_actor.id is not null then
    v_driver_name:=coalesce(nullif(btrim(v_actor.display_name),''),v_actor.worker_key);
    p_record:=p_record||jsonb_build_object('driver_name',v_driver_name,'driver_employee_key',v_actor.worker_key,'driver_company','John Gordon Construction');
  else
    if nullif(btrim(p_record->>'driver_employee_key'),'') is not null then raise exception 'Sign in with your JGC account to record an employee inspection.' using errcode='42501';end if;
    if coalesce(length(v_driver_name),0) not between 2 and 150 or coalesce(length(btrim(p_record->>'driver_company')),0) not between 1 and 150 then raise exception 'Enter your name and company.' using errcode='22023';end if;
    perform private.jgc1014_limit('vehicle-qr-hour:'||v_vehicle.id,30,interval '1 hour');
    perform private.jgc1014_limit('vehicle-qr-day:'||v_vehicle.id,100,interval '1 day');
  end if;
  if v_status not in ('draft','submitted') or coalesce((p_record->>'inspection_date')::date,v_toronto_today)<>v_toronto_today then raise exception 'Use today and a valid inspection status.' using errcode='22023';end if;
  if jsonb_typeof(p_record->'form_data'->'sections') is distinct from 'array' then raise exception 'Inspection checklist is required.' using errcode='22023';end if;
  select coalesce(jsonb_agg(item),'[]'::jsonb) into v_items from jsonb_array_elements(p_record->'form_data'->'sections') section cross join lateral jsonb_array_elements(case when jsonb_typeof(section->'items')='array' then section->'items' else '[]'::jsonb end) item;
  select count(*),count(*) filter(where coalesce(item->>'result','') not in ('pass','defect','na','n/a') and not(v_status='draft' and coalesce(item->>'result','')='')) into v_count,v_invalid from jsonb_array_elements(v_items) item;
  if v_count not between 1 and 250 or v_invalid>0 then raise exception 'Complete each checklist item with Pass, Defect or N/A.' using errcode='22023';end if;
  v_defects:=exists(select 1 from jsonb_array_elements(v_items) item where item->>'result'='defect');
  v_major:=exists(select 1 from jsonb_array_elements(v_items) item where item->>'result'='defect' and item->>'severity'='major');
  if exists(select 1 from jsonb_array_elements(v_items) item where item->>'result'='defect' and coalesce(item->>'severity','') not in ('minor','major')) then raise exception 'Choose Minor or Major for each defect.' using errcode='22023';end if;
  v_vehicle_status:=case when v_actor.id is null then 'Needs Review' when v_major then 'Out of Service / Needs Review' when v_defects then 'Needs Review' else 'Active' end;
  p_record:=p_record||jsonb_build_object('form_data',coalesce(p_record->'form_data','{}'::jsonb)||jsonb_build_object('identity_verified',v_actor.id is not null));
  if v_current_km is not null and (v_current_km<0 or v_current_km>10000000 or (v_actor.id is not null and (v_current_km<coalesce(v_vehicle.current_km,0) or (v_actor.role IS DISTINCT FROM 'admin' and v_current_km>coalesce(v_vehicle.current_km,v_current_km)+10000)))) then raise exception 'Check the odometer. It cannot go backwards or make an unusually large jump.' using errcode='22023';end if;
  if exists (
    select 1 from (values (nullif(trim(coalesce(p_record->>'trailer_1_id', '')), '')), (nullif(trim(coalesce(p_record->>'trailer_2_id', '')), ''))) t(id)
    where t.id is not null and case when t.id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then t.id::uuid = p_vehicle_id or not exists (select 1 from public.equipment_vehicles e where e.id = t.id::uuid and private.jgc_is_trailer_asset(e))
      else true end
  ) then
    return query select false, 'Select trailers from the list for this vehicle.'::text, null::jsonb;
    return;
  end if;

  if length(clean_token) < 24 then
    return query select false, 'This vehicle QR token is not valid.'::text, null::jsonb;
    return;
  end if;

  select *
    into v_vehicle
  from public.equipment_vehicles e
  where e.id = p_vehicle_id
    and e.vehicle_qr_token = clean_token
    and coalesce(e.is_active, true) = true
  limit 1;

  if not found then
    return query select false, 'This vehicle QR code is not active.'::text, null::jsonb;
    return;
  end if;

  if v_driver_name is null or length(v_driver_name) < 2 then
    return query select false, 'Select an employee name or enter a manual driver name.'::text, null::jsonb;
    return;
  end if;

  insert into public.vehicle_inspection_records (
    status,
    inspection_type,
    inspection_date,
    inspection_time,
    driver_name,
    driver_employee_key,
    driver_company,
    location,
    odometer,
    vehicle_id,
    vehicle_name,
    vehicle_license_plate,
    vehicle_jurisdiction,
    vehicle_vin,
    vehicle_make,
    vehicle_model,
    vehicle_year,
    trailer_1_id,
    trailer_1_name,
    trailer_1_license_plate,
    trailer_1_jurisdiction,
    trailer_2_id,
    trailer_2_name,
    trailer_2_license_plate,
    trailer_2_jurisdiction,
    defects_found,
    major_defects_found,
    vehicle_status_after_inspection,
    form_data,
    defect_summary,
    repair_notes,
    created_by,
    created_by_name
  )
  values (
    v_status,
    coalesce(nullif(trim(p_record->>'inspection_type'), ''), 'Daily Vehicle Inspection'),
    coalesce((p_record->>'inspection_date')::date, v_toronto_today),
    nullif(p_record->>'inspection_time', '')::time,
    v_driver_name,
    nullif(trim(coalesce(p_record->>'driver_employee_key', '')), ''),
    nullif(trim(coalesce(p_record->>'driver_company', '')), ''),
    nullif(trim(coalesce(p_record->>'location', '')), ''),
    v_current_km,
    v_vehicle.id,
    coalesce(nullif(trim(p_record->>'vehicle_name'), ''), v_vehicle.name),
    coalesce(nullif(trim(p_record->>'vehicle_license_plate'), ''), v_vehicle.license_plate, v_vehicle.unit_number, v_vehicle.identification_number),
    coalesce(nullif(trim(p_record->>'vehicle_jurisdiction'), ''), v_vehicle.jurisdiction),
    coalesce(nullif(trim(p_record->>'vehicle_vin'), ''), v_vehicle.vin),
    coalesce(nullif(trim(p_record->>'vehicle_make'), ''), v_vehicle.make),
    coalesce(nullif(trim(p_record->>'vehicle_model'), ''), v_vehicle.model),
    coalesce(nullif(trim(p_record->>'vehicle_year'), ''), v_vehicle.model_year),
    nullif(p_record->>'trailer_1_id', '')::uuid,
    nullif(trim(coalesce(p_record->>'trailer_1_name', '')), ''),
    nullif(trim(coalesce(p_record->>'trailer_1_license_plate', '')), ''),
    nullif(trim(coalesce(p_record->>'trailer_1_jurisdiction', '')), ''),
    nullif(p_record->>'trailer_2_id', '')::uuid,
    nullif(trim(coalesce(p_record->>'trailer_2_name', '')), ''),
    nullif(trim(coalesce(p_record->>'trailer_2_license_plate', '')), ''),
    nullif(trim(coalesce(p_record->>'trailer_2_jurisdiction', '')), ''),
    v_defects,
    v_major,
    v_vehicle_status,
    coalesce(p_record->'form_data', '{}'::jsonb),
    coalesce(p_record->'defect_summary', '{}'::jsonb),
    nullif(trim(coalesce(p_record->>'repair_notes', '')), ''),
    auth.uid(),
    v_driver_name
  )
  returning * into v_record;

  if v_status = 'submitted' and v_actor.id is not null then
    update public.equipment_vehicles
    set vehicle_status = v_vehicle_status,
        updated_at = now()
    where id in (
      v_vehicle.id,
      nullif(p_record->>'trailer_1_id', '')::uuid,
      nullif(p_record->>'trailer_2_id', '')::uuid
    );

    if v_record.odometer is not null then
      update public.equipment_vehicles
      set current_km = v_record.odometer,
          updated_at = now()
      where id = v_vehicle.id;
    end if;
  end if;

  return query select true, case when v_status = 'draft' then 'Draft saved.' else 'Inspection submitted.' end, to_jsonb(v_record);
end;
$function$;
CREATE OR REPLACE FUNCTION public.submit_public_equipment_inspection(p_token text, p_inspector_name text, p_inspector_employee_key text, p_inspector_company text, p_inspection_type text, p_inspection_date date, p_form_data jsonb, p_summary jsonb, p_email_body text, p_current_hours numeric DEFAULT NULL::numeric)
 RETURNS TABLE(success boolean, message text, record_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  clean_token text := trim(coalesce(p_token, ''));
  clean_name text := nullif(trim(coalesce(p_inspector_name, '')), '');
  clean_employee_key text := nullif(trim(coalesce(p_inspector_employee_key, '')), '');
  clean_company text := nullif(trim(coalesce(p_inspector_company, '')), '');
  v_equipment public.equipment_vehicles%rowtype;
  v_inspection_type text;
  v_date date := coalesce(p_inspection_date, (clock_timestamp() at time zone 'America/Toronto')::date);
  v_worker_name text;
  v_existing_id uuid;
  v_record_id uuid;
  v_actor public.profiles; v_rows jsonb; v_failed integer;
begin
  if octet_length(coalesce(p_form_data,'{}'::jsonb)::text)>65536 or length(coalesce(p_email_body,''))>20000 then raise exception 'Inspection content is too large.' using errcode='22023';end if;
  if auth.uid() is not null and not private.jgc_has_full_portal_access() then raise exception 'An approved JGC account is required.' using errcode='42501';end if;
  select * into v_actor from public.profiles where id=auth.uid() and account_status='approved';
  if v_actor.id is not null then clean_name:=coalesce(nullif(btrim(v_actor.display_name),''),v_actor.worker_key);clean_employee_key:=v_actor.worker_key;clean_company:='John Gordon Construction';
  elsif clean_employee_key is not null then raise exception 'Sign in with your JGC account to record an employee inspection.' using errcode='42501';
  elsif coalesce(length(clean_name),0) not between 2 and 150 or coalesce(length(clean_company),0) not between 1 and 150 then raise exception 'Enter your name and company.' using errcode='22023';end if;
  if v_date<>(clock_timestamp() at time zone 'America/Toronto')::date then raise exception 'QR inspections must use today.' using errcode='22023';end if;
  if jsonb_typeof(p_form_data) is distinct from 'object' or (p_summary is not null and jsonb_typeof(p_summary) is distinct from 'object') or coalesce(octet_length(p_summary::text),0)>65536 then raise exception 'Inspection summary is too large or invalid.' using errcode='22023';end if;
  v_rows:=p_form_data->'rows';
  if jsonb_typeof(v_rows) is distinct from 'array' or jsonb_array_length(v_rows) not between 1 and 250 then raise exception 'Complete the inspection checklist.' using errcode='22023';end if;
  if exists(select 1 from jsonb_array_elements(v_rows) item where coalesce(item->'cells'->>2,'') not in ('P','F','N/A')) then raise exception 'Complete each checklist item with Pass, Fail or N/A.' using errcode='22023';end if;
  select count(*) into v_failed from jsonb_array_elements(v_rows) item where item->'cells'->>2='F';
  p_summary:=coalesce(p_summary,'{}'::jsonb)||jsonb_build_object('completed_by',clean_name,'company',clean_company,'failed_count',v_failed,'identity_verified',v_actor.id is not null);
  if length(clean_token) < 24 then
    return query select false, 'Invalid equipment inspection link.'::text, null::uuid;
    return;
  end if;

  if clean_name is null or length(clean_name) < 2 then
    return query select false, 'Enter the inspector name.'::text, null::uuid;
    return;
  end if;

  select *
    into v_equipment
  from public.equipment_vehicles e
  where e.inspection_qr_token = clean_token
    and coalesce(e.is_active, true) = true
  limit 1;

  if not found then
    return query select false, 'Equipment could not be found for this QR code.'::text, null::uuid;
    return;
  end if;

  v_inspection_type := coalesce(
    nullif(v_equipment.inspection_qr_type, ''),
    public.infer_equipment_inspection_type(
      v_equipment.name,
      v_equipment.equipment_type,
      v_equipment.identification_number,
      v_equipment.notes
    ),
    nullif(trim(coalesce(p_inspection_type, '')), '')
  );

  if v_inspection_type is null then
    return query select false, 'This equipment does not have a supported inspection type.'::text, null::uuid;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('equipment-qr:'||v_equipment.id,0));
  select * into v_equipment from public.equipment_vehicles where id=v_equipment.id for update;
  if p_current_hours is not null and (p_current_hours<0 or p_current_hours>10000000 or (v_actor.id is not null and (p_current_hours<coalesce(v_equipment.current_hours,0) or (v_actor.role IS DISTINCT FROM 'admin' and p_current_hours>coalesce(v_equipment.current_hours,p_current_hours)+1000)))) then raise exception 'Check the equipment meter. It cannot go backwards or make an unusually large jump.' using errcode='22023';end if;
  if v_actor.id is null then perform private.jgc1014_limit('equipment-qr-hour:'||v_equipment.id,30,interval '1 hour');perform private.jgc1014_limit('equipment-qr-day:'||v_equipment.id,100,interval '1 day');end if;
  select r.id
    into v_existing_id
  from public.inspection_records r
  where r.equipment_id = v_equipment.id
    and r.inspection_date = v_date
    and lower(coalesce(r.worker_display_name, '')) = lower(clean_name)
    and r.created_at > now() - interval '15 minutes'
  order by r.created_at desc
  limit 1;

  if v_existing_id is not null then
    return query select true, 'This inspection was already saved.'::text, v_existing_id;
    return;
  end if;

  v_worker_name := coalesce(
    clean_employee_key,
    'equipment_qr:' || lower(regexp_replace(clean_name || '|' || coalesce(clean_company, ''), '[^a-zA-Z0-9@._-]+', '-', 'g'))
  );

  insert into public.inspection_records (
    worker_name,
    worker_display_name,
    inspection_type,
    inspection_date,
    title,
    summary,
    form_data,
    email_body,
    equipment_id,
    equipment_name,
    equipment_identification,
    public_submission,
    public_submission_source,
    inspection_qr_token
  ) values (
    v_worker_name,
    clean_name,
    v_inspection_type,
    v_date,
    v_inspection_type || ' - ' || v_date::text,
    coalesce(p_summary, '{}'::jsonb) || jsonb_build_object(
      'completed_by', clean_name,
      'company', coalesce(clean_company, ''),
      'public_submission', true,
      'public_submission_source', 'equipment_qr',
      'equipment_id', v_equipment.id,
      'equipment_name', v_equipment.name,
      'equipment_identification', coalesce(v_equipment.identification_number, '')
    ),
    coalesce(p_form_data, '{}'::jsonb) || jsonb_build_object(
      'public_submission', true,
      'public_submission_source', 'equipment_qr',
      'equipment', jsonb_build_object(
        'id', v_equipment.id,
        'name', v_equipment.name,
        'identification_number', coalesce(v_equipment.identification_number, ''),
        'equipment_type', coalesce(v_equipment.equipment_type, ''),
        'current_hours', p_current_hours
      )
    ),
    coalesce(p_email_body, ''),
    v_equipment.id,
    v_equipment.name,
    coalesce(v_equipment.identification_number, ''),
    true,
    'equipment_qr',
    clean_token
  )
  returning id into v_record_id;

  if v_actor.id is not null and p_current_hours is not null and p_current_hours >= 0 then
    update public.equipment_vehicles
    set current_hours = p_current_hours,
        updated_at = now()
    where id = v_equipment.id;
  end if;

  return query select true, 'Inspection saved.'::text, v_record_id;
end;
$function$;
CREATE OR REPLACE FUNCTION public.sync_equipment_current_km_from_vehicle_inspection() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
BEGIN
  IF private.jgc_has_full_portal_access() AND lower(coalesce(new.status,''))='submitted' AND new.vehicle_id IS NOT NULL AND new.odometer IS NOT NULL THEN
    UPDATE public.equipment_vehicles SET current_km=new.odometer,updated_at=now() WHERE id=new.vehicle_id AND (current_km IS NULL OR (new.odometer>=current_km AND current_km IS DISTINCT FROM new.odometer));
  END IF;RETURN new;
END $function$;
REVOKE ALL ON FUNCTION public.sync_equipment_current_km_from_vehicle_inspection() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.jgc_get_job_board_signins(p_board_id uuid, p_kind text, p_before timestamp with time zone, p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$

declare rows_value jsonb;cursor_value timestamptz; action_value text;

begin

  if not private.jgc_job_board_admin() then raise exception 'Approved administrator access required' using errcode='42501'; end if;

  if not exists(select 1 from public.job_boards where id=p_board_id) then raise exception 'Job Board unavailable';end if;

  if p_kind not in ('portal','site') or p_kind is null then raise exception 'Select Portal or Site sign-ins';end if;

  action_value:=case when p_kind='portal' then 'visit' else 'site-signin' end;

  select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at desc),'[]'::jsonb),min(q.created_at) into rows_value,cursor_value from (select id,actor_name,actor_company,actor_email,identity_type,action,created_at,reason,((identity_type='staff' and actor_profile_id is not null) or exists(select 1 from private.jgc_site_signin_confirmations where event_id=public.job_board_activity.id)) as verified from public.job_board_activity where board_id=p_board_id and action=action_value and (p_before is null or created_at<p_before) order by created_at desc limit greatest(1,least(coalesce(p_limit,50),100))) q;

  if not exists(select 1 from public.job_board_activity where board_id=p_board_id and action=action_value and created_at<cursor_value) then cursor_value:=null;end if;

  return jsonb_build_object('events',rows_value,'next_before',cursor_value);

end $function$;
