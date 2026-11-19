-- The end date is inclusive. Existing events occupy their start date.
ALTER TABLE public.schedule_events
  ADD COLUMN IF NOT EXISTS end_date date CONSTRAINT schedule_events_end_date_check
  CHECK (end_date IS NULL OR end_date >= event_date);

CREATE OR REPLACE FUNCTION public.prepare_calendar_sync(p_action text,p_source_table text DEFAULT NULL,p_source_id uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
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
   event:=jsonb_build_object('id',p_source_id,'sync_table',p_source_table,'google_event_id',source->>'google_event_id','event_date',source->>'event_date','end_date',coalesce(source->>'end_date',source->>'event_date'),'all_day',false,'start_time',coalesce(source->>'start_time','07:00'),'end_time',coalesce(source->>'end_time','07:30'),'event_type',source->>'event_type','title','[JGC] '||label,'description',description,'location',coalesce(source->>'location',''));
  ELSE
   IF actor.role IS DISTINCT FROM 'admin' AND (nullif(btrim(actor.worker_key),'') IS NULL OR lower(btrim(source->>'worker_name')) IS DISTINCT FROM lower(btrim(actor.worker_key))) THEN RAISE EXCEPTION 'This vacation request is not yours.' USING ERRCODE='42501';END IF;
   IF p_action='upsert' AND source->>'status' IS DISTINCT FROM 'approved' THEN RAISE EXCEPTION 'Only approved vacation can be added to the Calendar.' USING ERRCODE='22023';END IF;
   names:=coalesce(nullif(source->>'worker_display_name',''),source->>'worker_name','Employee');
   event:=jsonb_build_object('id',p_source_id,'sync_table',p_source_table,'google_event_id',source->>'google_event_id','event_date',source->>'start_date','end_date',coalesce(source->>'end_date',source->>'start_date'),'all_day',true,'event_type','vacation','title','[JGC] Vacation - Vacation - '||names,'description',concat_ws(E'\n','Employees: '||names,CASE WHEN nullif(source->>'reason','') IS NOT NULL THEN 'Notes: '||(source->>'reason') END,'Created from JGC Portal.','Portal Event ID: '||p_source_id),'location','');
  END IF;
  stamp:=nullif(source->>'updated_at','')::timestamptz;
  payload:=jsonb_build_object('action',p_action,'event',event);
 END IF;
 PERFORM private.jgc1014_limit('calendar:'||auth.uid(),120,interval '1 hour');
 INSERT INTO private.jgc_calendar_sync_tickets(token_hash,profile_id,action,source_table,source_id,source_version,source_fingerprint,payload) VALUES(private.jgc_job_board_token_hash(token),auth.uid(),p_action,CASE WHEN p_action='pull_google_updates' THEN NULL ELSE p_source_table END,CASE WHEN p_action='pull_google_updates' THEN NULL ELSE p_source_id END,stamp,CASE WHEN source IS NULL THEN NULL ELSE md5(source::text) END,payload);
 -- The stored payload lets existing Google deployments keep syncing during the staged update.
 -- The updated script ignores these compatibility fields and accepts only a claimed ticket.
 RETURN jsonb_build_object('ticket',token,'expires_at',clock_timestamp()+interval '90 seconds','legacy_payload',payload);
END $function$;
