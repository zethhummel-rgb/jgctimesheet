-- One-use Calendar capabilities are issued only for an approved caller's stored source.
CREATE TABLE private.jgc_calendar_sync_tickets(token_hash text PRIMARY KEY,profile_id uuid NOT NULL REFERENCES public.profiles(id),action text NOT NULL CHECK(action IN ('upsert','delete','pull_google_updates')),source_table text,source_id uuid,source_version timestamptz,payload jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL DEFAULT now()+interval '90 seconds',claimed_at timestamptz);
ALTER TABLE private.jgc_calendar_sync_tickets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.jgc_calendar_sync_tickets FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.prepare_calendar_sync(p_action text,p_source_table text DEFAULT NULL,p_source_id uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE actor public.profiles; source jsonb; token uuid:=gen_random_uuid(); payload jsonb; event jsonb;label text;names text;equipment_name text;description text;stamp timestamptz;
BEGIN
 IF NOT private.jgc_has_full_portal_access() THEN RAISE EXCEPTION 'Approved JGC account required.' USING ERRCODE='42501';END IF;
 SELECT * INTO actor FROM public.profiles WHERE id=auth.uid() AND account_status='approved';
 IF p_action NOT IN ('upsert','delete','pull_google_updates') OR p_action IS NULL THEN RAISE EXCEPTION 'Invalid Calendar action.' USING ERRCODE='22023';END IF;
 IF p_action='pull_google_updates' THEN
  IF actor.role IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'Administrator access required.' USING ERRCODE='42501';END IF;
  payload:=jsonb_build_object('action',p_action);
 ELSE
  IF p_source_table NOT IN ('schedule_events','vacation_requests') OR p_source_table IS NULL OR p_source_id IS NULL THEN RAISE EXCEPTION 'Calendar source unavailable.' USING ERRCODE='22023';END IF;
  EXECUTE format('select to_jsonb(s) from public.%I s where id=$1',p_source_table) INTO source USING p_source_id;
  IF source IS NULL THEN RAISE EXCEPTION 'Calendar source unavailable.' USING ERRCODE='42501';END IF;
  IF p_source_table='schedule_events' THEN
   IF source->>'created_by' IS DISTINCT FROM auth.uid()::text AND actor.role IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'This schedule event is not yours.' USING ERRCODE='42501';END IF;
   label:=coalesce(nullif(source->>'title',''),nullif(source->>'job_name',''),nullif(source->>'location',''),'Schedule Event');
   IF nullif(source->>'job_name','') IS NOT NULL AND source->>'job_name'<>label THEN label:=(source->>'job_name')||' - '||label;END IF;
   SELECT string_agg(value,', ') INTO names FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(source->'employee_names')='array' THEN source->'employee_names' ELSE '[]'::jsonb END);
   SELECT name INTO equipment_name FROM public.equipment_vehicles WHERE id=nullif(source->>'equipment_id','')::uuid;
   description:=concat_ws(E'\n',CASE WHEN nullif(source->>'job_name','') IS NOT NULL THEN 'Job: '||concat_ws(' - ',nullif(source->>'job_number',''),source->>'job_name') END,CASE WHEN names IS NOT NULL THEN 'Employees: '||names END,CASE WHEN equipment_name IS NOT NULL THEN 'Vehicle / Equipment: '||equipment_name END,CASE WHEN nullif(source->>'location','') IS NOT NULL THEN 'Location: '||(source->>'location') END,CASE WHEN nullif(source->>'maintenance_reason','') IS NOT NULL THEN 'Reason: '||(source->>'maintenance_reason') END,CASE WHEN nullif(source->>'notes','') IS NOT NULL THEN 'Notes: '||(source->>'notes') END,'Created from JGC Portal.','Portal Event ID: '||p_source_id);
   event:=jsonb_build_object('id',p_source_id,'sync_table',p_source_table,'google_event_id',source->>'google_event_id','event_date',source->>'event_date','end_date',source->>'event_date','all_day',false,'start_time',coalesce(source->>'start_time','07:00'),'end_time',coalesce(source->>'end_time','07:30'),'event_type',source->>'event_type','title','[JGC] '||label,'description',description,'location',coalesce(source->>'location',''));
  ELSE
   IF actor.role IS DISTINCT FROM 'admin' AND (p_action<>'delete' OR nullif(actor.worker_key,'') IS NULL OR source->>'worker_name' IS DISTINCT FROM actor.worker_key) THEN RAISE EXCEPTION 'Administrator access required for vacation Calendar sync.' USING ERRCODE='42501';END IF;
   IF p_action='upsert' AND source->>'status' IS DISTINCT FROM 'approved' THEN RAISE EXCEPTION 'Only approved vacation can be added to the Calendar.' USING ERRCODE='22023';END IF;
   names:=coalesce(nullif(source->>'worker_display_name',''),source->>'worker_name','Employee');
   event:=jsonb_build_object('id',p_source_id,'sync_table',p_source_table,'google_event_id',source->>'google_event_id','event_date',source->>'start_date','end_date',coalesce(source->>'end_date',source->>'start_date'),'all_day',true,'event_type','vacation','title','[JGC] Vacation - Vacation - '||names,'description',concat_ws(E'\n','Employees: '||names,CASE WHEN nullif(source->>'reason','') IS NOT NULL THEN 'Notes: '||(source->>'reason') END,'Created from JGC Portal.','Portal Event ID: '||p_source_id),'location','');
  END IF;
  stamp:=nullif(source->>'updated_at','')::timestamptz;
  payload:=jsonb_build_object('action',p_action,'event',event);
 END IF;
 PERFORM private.jgc1014_limit('calendar:'||auth.uid(),120,interval '1 hour');
 INSERT INTO private.jgc_calendar_sync_tickets(token_hash,profile_id,action,source_table,source_id,source_version,payload) VALUES(private.jgc_job_board_token_hash(token),auth.uid(),p_action,CASE WHEN p_action='pull_google_updates' THEN NULL ELSE p_source_table END,CASE WHEN p_action='pull_google_updates' THEN NULL ELSE p_source_id END,stamp,payload);
 RETURN jsonb_build_object('ticket',token,'expires_at',clock_timestamp()+interval '90 seconds');
END $function$;
REVOKE ALL ON FUNCTION public.prepare_calendar_sync(text,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.prepare_calendar_sync(text,text,uuid) TO authenticated;

CREATE FUNCTION public.claim_calendar_sync_ticket(p_ticket uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE t private.jgc_calendar_sync_tickets;p public.profiles;current_version timestamptz;
BEGIN
 SELECT * INTO t FROM private.jgc_calendar_sync_tickets WHERE token_hash=private.jgc_job_board_token_hash(p_ticket) AND claimed_at IS NULL AND expires_at>clock_timestamp() FOR UPDATE;
 IF t.token_hash IS NULL THEN RAISE EXCEPTION 'Calendar authorization unavailable.' USING ERRCODE='42501';END IF;
 SELECT * INTO p FROM public.profiles WHERE id=t.profile_id AND account_status='approved';
 IF p.id IS NULL THEN RAISE EXCEPTION 'Calendar authorization unavailable.' USING ERRCODE='42501';END IF;
 IF t.action='pull_google_updates' AND p.role IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'Calendar authorization unavailable.' USING ERRCODE='42501';END IF;
 IF t.action<>'pull_google_updates' THEN
  EXECUTE format('select updated_at from public.%I where id=$1',t.source_table) INTO current_version USING t.source_id;
  IF (current_version IS NULL AND t.action<>'delete') OR (current_version IS NOT NULL AND current_version IS DISTINCT FROM t.source_version) THEN RAISE EXCEPTION 'Calendar record changed. Queue a fresh request.' USING ERRCODE='42501';END IF;
 END IF;
 UPDATE private.jgc_calendar_sync_tickets SET claimed_at=clock_timestamp() WHERE token_hash=t.token_hash;
 RETURN t.payload;
END $function$;
REVOKE ALL ON FUNCTION public.claim_calendar_sync_ticket(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_calendar_sync_ticket(uuid) TO service_role;

-- Calendar IDs and schedule ownership cannot be supplied/changed by browser callers.
CREATE FUNCTION private.jgc_calendar_source_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
BEGIN
 IF auth.uid() IS NULL THEN RETURN NEW;END IF;
 IF TG_OP='INSERT' THEN
  IF nullif(NEW.google_event_id,'') IS NOT NULL THEN RAISE EXCEPTION 'Calendar event IDs are assigned by the sync service.' USING ERRCODE='42501';END IF;
 ELSE
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.google_event_id IS DISTINCT FROM OLD.google_event_id THEN RAISE EXCEPTION 'Calendar event identity is managed by the sync service.' USING ERRCODE='42501';END IF;
  IF TG_TABLE_NAME='schedule_events' AND to_jsonb(NEW)->>'created_by' IS DISTINCT FROM to_jsonb(OLD)->>'created_by' THEN RAISE EXCEPTION 'Schedule ownership cannot be changed.' USING ERRCODE='42501';END IF;
 END IF;
 RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION private.jgc_calendar_source_guard() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER jgc_calendar_schedule_guard BEFORE INSERT OR UPDATE ON public.schedule_events FOR EACH ROW EXECUTE FUNCTION private.jgc_calendar_source_guard();
CREATE TRIGGER jgc_calendar_vacation_guard BEFORE INSERT OR UPDATE ON public.vacation_requests FOR EACH ROW EXECUTE FUNCTION private.jgc_calendar_source_guard();
DROP POLICY "Approved users can create schedule events" ON public.schedule_events;
CREATE POLICY "Approved users can create schedule events" ON public.schedule_events FOR INSERT TO authenticated WITH CHECK(private.jgc_has_full_portal_access() AND created_by=auth.uid());
DROP POLICY "Approved users can update schedule events" ON public.schedule_events;
CREATE POLICY "Approved users can update schedule events" ON public.schedule_events FOR UPDATE TO authenticated USING(private.jgc_has_full_portal_access() AND (created_by=auth.uid() OR public.is_admin())) WITH CHECK(private.jgc_has_full_portal_access() AND (created_by=auth.uid() OR public.is_admin()));
