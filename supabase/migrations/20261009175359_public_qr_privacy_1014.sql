-- Preserve QR links and stored safety history; public responses contain only required status data.
CREATE OR REPLACE FUNCTION private.jgc1014_vehicle_qr_model(p_vehicle_id uuid, p_token text)
 RETURNS TABLE(vehicle jsonb, trailers jsonb, employees jsonb, history jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  clean_token text := trim(coalesce(p_token, ''));
  v_vehicle public.equipment_vehicles%rowtype;
begin
  if length(clean_token) < 24 then
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
    return;
  end if;

  return query
  select
    private.jgc_vehicle_inspection_asset(v_vehicle),
    coalesce(
      (
        select jsonb_agg(private.jgc_vehicle_inspection_asset(e) order by e.name)
        from public.equipment_vehicles e
        where coalesce(e.is_active, true) = true
          and e.id <> v_vehicle.id
          and lower(coalesce(e.name, '') || ' ' || coalesce(e.equipment_type, '') || ' ' || coalesce(e.asset_category, '') || ' ' || coalesce(e.identification_number, '') || ' ' || coalesce(e.notes, '')) ~ '(trailer|trl|float|deck over|deckover)'
      ),
      '[]'::jsonb
    ),
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'display_name', p.display_name,
            'worker_key', p.worker_key
          )
          order by p.display_name
        )
        from public.profiles p
        where coalesce(p.account_status, 'approved') not in ('pending', 'inactive')
          and coalesce(p.role, 'worker') <> 'subcontractor'
          and nullif(trim(coalesce(p.display_name, '')), '') is not null
      ),
      '[]'::jsonb
    ),
    coalesce(
      (
        select jsonb_agg(to_jsonb(r) order by r.inspection_date desc, r.created_at desc)
        from (
          select *
          from public.vehicle_inspection_records r
          where r.vehicle_id = v_vehicle.id
             or r.trailer_1_id = v_vehicle.id
             or r.trailer_2_id = v_vehicle.id
          order by r.inspection_date desc, r.created_at desc
          limit 30
        ) r
      ),
      '[]'::jsonb
    );
end;
$function$;
REVOKE ALL ON FUNCTION private.jgc1014_vehicle_qr_model(uuid,text) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.get_vehicle_qr_inspection(p_vehicle_id uuid,p_token text)
RETURNS TABLE(vehicle jsonb,trailers jsonb,employees jsonb,history jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE model record; p public.profiles;
BEGIN
  SELECT * INTO model FROM private.jgc1014_vehicle_qr_model(p_vehicle_id,p_token);
  IF NOT FOUND THEN RETURN; END IF;
  IF private.jgc_has_full_portal_access() THEN
    SELECT * INTO p FROM public.profiles WHERE id=auth.uid() AND account_status='approved';
    RETURN QUERY SELECT model.vehicle,model.trailers,jsonb_build_array(jsonb_build_object('worker_key',p.worker_key,'display_name',p.display_name)),model.history;
  ELSE
    RETURN QUERY SELECT model.vehicle,model.trailers,'[]'::jsonb,
      CASE WHEN jsonb_array_length(model.history)>0 THEN jsonb_build_array(jsonb_build_object(
        'inspection_date',model.history->0->>'inspection_date',
        'status',model.history->0->>'status',
        'public_summary',true)) ELSE '[]'::jsonb END;
  END IF;
END $function$;
CREATE OR REPLACE FUNCTION private.jgc1014_equipment_qr_model(p_token text)
 RETURNS TABLE(equipment_id uuid, equipment_name text, equipment_identification text, equipment_type text, inspection_type text, current_hours numeric, today_inspection jsonb, employees jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  clean_token text := trim(coalesce(p_token, ''));
begin
  if length(clean_token) < 24 then
    return;
  end if;

  return query
  select
    e.id,
    e.name::text,
    coalesce(e.identification_number, '')::text,
    coalesce(e.equipment_type, '')::text,
    coalesce(
      nullif(e.inspection_qr_type, ''),
      public.infer_equipment_inspection_type(e.name, e.equipment_type, e.identification_number, e.notes)
    )::text,
    e.current_hours::numeric,
    (
      select jsonb_build_object(
        'id', r.id,
        'inspection_type', r.inspection_type,
        'inspection_date', r.inspection_date,
        'worker_name', r.worker_name,
        'worker_display_name', r.worker_display_name,
        'created_at', r.created_at,
        'summary', coalesce(r.summary, '{}'::jsonb),
        'form_data', coalesce(r.form_data, '{}'::jsonb),
        'equipment_name', coalesce(r.equipment_name, e.name),
        'equipment_identification', coalesce(r.equipment_identification, e.identification_number, '')
      )
      from public.inspection_records r
      where r.inspection_date = (clock_timestamp() at time zone 'America/Toronto')::date
        and (
          r.equipment_id = e.id
          or r.inspection_qr_token = clean_token
          or exists (
            select 1
            from jsonb_array_elements(
              case
                when jsonb_typeof(r.form_data->'fields') = 'array' then r.form_data->'fields'
                else '[]'::jsonb
              end
            ) field_row
            where lower(trim(field_row->>'value')) in (
              lower(trim(coalesce(e.name, ''))),
              lower(trim(coalesce(e.identification_number, ''))),
              lower(trim(coalesce(e.identification_number, '') || ' - ' || coalesce(e.name, ''))),
              lower(trim(coalesce(e.name, '') || ' - ' || coalesce(e.identification_number, '')))
            )
          )
        )
      order by r.created_at desc
      limit 1
    ) as today_inspection,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'display_name', p.display_name,
            'worker_key', p.worker_key
          )
          order by p.display_name
        )
        from public.profiles p
        where coalesce(p.account_status, 'approved') not in ('pending', 'inactive')
          and coalesce(p.role, 'worker') <> 'subcontractor'
          and nullif(trim(coalesce(p.display_name, '')), '') is not null
      ),
      '[]'::jsonb
    ) as employees
  from public.equipment_vehicles e
  where e.inspection_qr_token = clean_token
    and coalesce(e.is_active, true) = true
  limit 1;
end;
$function$;
REVOKE ALL ON FUNCTION private.jgc1014_equipment_qr_model(text) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.get_public_equipment_inspection(p_token text)
RETURNS TABLE(equipment_id uuid,equipment_name text,equipment_identification text,equipment_type text,inspection_type text,current_hours numeric,today_inspection jsonb,employees jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE model record; p public.profiles; today_status jsonb;
BEGIN
  SELECT * INTO model FROM private.jgc1014_equipment_qr_model(p_token); IF NOT FOUND THEN RETURN; END IF;
  IF private.jgc_has_full_portal_access() THEN
    SELECT * INTO p FROM public.profiles WHERE id=auth.uid() AND account_status='approved';
    RETURN QUERY SELECT model.equipment_id,model.equipment_name,model.equipment_identification,model.equipment_type,model.inspection_type,model.current_hours,model.today_inspection,
      jsonb_build_array(jsonb_build_object('worker_key',p.worker_key,'display_name',p.display_name));
  ELSE
    today_status:=CASE WHEN model.today_inspection IS NOT NULL THEN jsonb_build_object('inspection_date',model.today_inspection->>'inspection_date','public_summary',true) ELSE NULL END;
    RETURN QUERY SELECT model.equipment_id,model.equipment_name,model.equipment_identification,model.equipment_type,model.inspection_type,model.current_hours,today_status,'[]'::jsonb;
  END IF;
END $function$;
CREATE OR REPLACE FUNCTION private.jgc1014_public_safety_model(p_value jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $function$
DECLARE result jsonb; item record;
BEGIN
  IF jsonb_typeof(p_value)='object' THEN
    result:='{}'::jsonb;
    FOR item IN SELECT key,value AS child FROM jsonb_each(p_value) LOOP
      IF lower(item.key) NOT IN ('signature','signature_strokes','signature_width','signature_height','signature_signed_name','signature_signed_by','matched_employee_email','matched_employee_id','attendee_key','attendee_email','actor_email','email','employee_signature','qr_token','token','signature_user_agent','user_agent') THEN
        result:=result||jsonb_build_object(item.key,private.jgc1014_public_safety_model(item.child));
      END IF;
    END LOOP; RETURN result;
  ELSIF jsonb_typeof(p_value)='array' THEN
    SELECT coalesce(jsonb_agg(private.jgc1014_public_safety_model(child)),'[]'::jsonb) INTO result FROM jsonb_array_elements(p_value) child; RETURN result;
  END IF;
  RETURN p_value;
END $function$;
REVOKE ALL ON FUNCTION private.jgc1014_public_safety_model(jsonb) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION private.jgc_job_board_jsa_context_full_1014(p_token text, p_visit_token uuid, p_document_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare d public.job_board_documents; b public.job_boards; actor jsonb; record_id_value uuid; key_value text; ack public.safety_acknowledgements; roster jsonb; worker_model jsonb;
begin
  d := private.jgc_job_board_read_document(p_token,p_visit_token,p_document_id);
  select * into b from public.job_boards where id=d.board_id and enabled;
  if b.id is null or d.status<>'published' or d.category<>'jsa' then raise exception 'Published JSA unavailable' using errcode='42501'; end if;
  if d.source_type is not null and (d.source_type<>'inspection_records' or lower(coalesce(d.source_payload->>'inspection_type',''))<>'jsa') then raise exception 'This document is not a JSA' using errcode='42501'; end if;
  actor := private.jgc_job_board_actor(b.id,p_visit_token);
  record_id_value := coalesce(d.source_id,d.id);
  if actor->>'identity_type'='staff' then
    key_value := 'job-board-staff:'||(actor->>'profile_id');
    select * into ack from public.safety_acknowledgements a where a.record_type='jsa' and a.record_id=record_id_value and a.removed_at is null and (a.matched_employee_id::text=actor->>'profile_id' or a.attendee_key=key_value) order by (a.signature_signed_at is not null) desc,a.created_at limit 1;
  else
    key_value := 'job-board-visitor:'||encode(sha256(convert_to(lower(trim(actor->>'name'))||'|'||lower(trim(actor->>'company'))||'|'||lower(trim(actor->>'email')),'UTF8')),'hex');
    select * into ack from public.safety_acknowledgements a where a.record_type='jsa' and a.record_id=record_id_value and a.attendee_key=key_value and a.removed_at is null;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('attendee_name',a.attendee_name,'attendee_company',a.attendee_company,'acknowledgement_status',a.acknowledgement_status,'acknowledged_at',a.acknowledged_at,'signature_strokes',a.signature_strokes,'signature_signed_name',a.signature_signed_name,'signature_signed_at',a.signature_signed_at) order by a.created_at),'[]'::jsonb) into roster from public.safety_acknowledgements a where a.record_type='jsa' and a.record_id=record_id_value and a.removed_at is null;
  if exists(select 1 from public.jsa_worker_workflows where record_id=record_id_value) then
    worker_model:=private.jgc_jsa_worker_model(record_id_value);
    key_value:=case when actor->>'identity_type'='staff' then 'jsa-worker:'||(actor->>'profile_id') else 'jsa-external:'||md5(lower(trim(actor->>'name'))||'|'||lower(trim(actor->>'company'))) end;
    select * into ack from public.safety_acknowledgements where record_type='jsa' and record_id=record_id_value and attendee_key=key_value and removed_at is null;
    return jsonb_build_object('document_id',d.id,'title',d.title,'report_date',d.report_date,'version',d.updated_at,'identity',jsonb_build_object('name',actor->>'name','company',actor->>'company'),
      'signed',ack.signature_signed_at is not null,'signed_at',ack.signature_signed_at,'record',worker_model->'record','workflow',worker_model->'workflow','can_collect',actor->>'identity_type'='staff' and (worker_model->>'can_collect')::boolean,'acknowledgements',roster);
  end if;
  return jsonb_build_object('document_id',d.id,'title',d.title,'report_date',d.report_date,'version',d.updated_at,'identity',jsonb_build_object('name',actor->>'name','company',actor->>'company'),'signed',ack.signature_signed_at is not null,'signed_at',ack.signature_signed_at,'record',case when d.source_type='inspection_records' then d.source_payload else null end,'acknowledgements',roster);
end $function$;
REVOKE ALL ON FUNCTION private.jgc_job_board_jsa_context_full_1014(text,uuid,uuid) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION private.jgc_job_board_jsa_context(p_token text,p_visit_token uuid,p_document_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE model jsonb;
BEGIN
  model:=private.jgc_job_board_jsa_context_full_1014(p_token,p_visit_token,p_document_id);
  IF private.jgc_job_board_staff() THEN RETURN model; END IF;
  RETURN private.jgc1014_public_safety_model(model);
END $function$;
CREATE OR REPLACE FUNCTION private.jgc_resolve_job_board_download_full_1014(p_token text, p_visit_token uuid, p_document_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare d public.job_board_documents;
begin
  d := private.jgc_job_board_read_document(p_token,p_visit_token,p_document_id);
  perform private.jgc_job_board_append(d.board_id,'download-request',d.id,private.jgc_job_board_actor(d.board_id,p_visit_token));
  return jsonb_build_object('id',d.id,'board_id',d.board_id,'bucket','job-board-files','object_path',d.object_path,'file_name',d.file_name,'mime_type',d.mime_type,'file_size',d.file_size,'category',d.category,'title',d.title,'source_type',d.source_type,'source_id',d.source_id,'source_payload',d.source_payload);
end $function$;
REVOKE ALL ON FUNCTION private.jgc_resolve_job_board_download_full_1014(text,uuid,uuid) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION private.jgc_resolve_job_board_download(p_token text,p_visit_token uuid,p_document_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE model jsonb;
BEGIN
  model:=private.jgc_resolve_job_board_download_full_1014(p_token,p_visit_token,p_document_id);
  IF private.jgc_job_board_staff() THEN RETURN model; END IF;
  RETURN private.jgc1014_public_safety_model(model);
END $function$;
-- Existing public EXECUTE grants and staff permissions are preserved by CREATE OR REPLACE.
