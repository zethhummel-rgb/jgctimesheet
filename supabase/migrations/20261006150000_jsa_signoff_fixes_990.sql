-- Release 990: JSA worker sign-off fixes (Zeth, 2026-10-06).
--
-- 1) "Complete and Worker Sign Off" failed with: column reference "employee_id" is ambiguous.
--    private.jgc_save_worker_jsa (release 984) declares a PL/pgSQL variable named employee_id, and release 985
--    added public.profiles.employee_id, so "select ... from public.profiles where id=employee_id" became
--    ambiguous. The variable is renamed to v_employee_id; the JSON key item->>'employee_id' and the
--    matched_employee_id column are untouched.
do $$
declare
  d text;
  pattern constant text := '(?<![''_[:alnum:]])employee_id(?![''_[:alnum:]])';
begin
  d := pg_get_functiondef('private.jgc_save_worker_jsa(uuid,integer,jsonb,jsonb)'::regprocedure);
  d := regexp_replace(d, pattern, 'v_employee_id', 'g');
  if d ~ pattern or d !~ 'v_employee_id uuid' or d !~ 'id=v_employee_id' then
    raise exception 'jgc_save_worker_jsa employee_id rename did not apply as expected';
  end if;
  execute d;
end $$;

-- 2) Late sign-on from the Job Board. Release 984 refused every Workers Onsite JSA on the Job Board. Signatures
--    stay on the creator phone while the JSA is being made and its listed workers sign off; once the JSA is
--    Completed (jsa_worker_workflows.completed_at), anyone arriving late can read it on the Job Board and sign
--    on with their own signature, as before 984. Late rows use the same attendee keys the Job Board context
--    reads for these JSAs ('jsa-worker:<profile>' / 'jsa-external:<md5>'), so the board shows them as signed.
create or replace function private.jgc_sign_job_board_jsa(p_token text, p_visit_token uuid, p_document_id uuid, p_confirm_read boolean, p_reviewed_version timestamp with time zone, p_signature_strokes jsonb, p_signature_width integer, p_signature_height integer)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare context_value jsonb; d public.job_board_documents; b public.job_boards; actor jsonb; key_value text; record_id_value uuid; ack public.safety_acknowledgements; stroke jsonb; point jsonb; points integer:=0; staff boolean; worker_result jsonb; w public.jsa_worker_workflows;
begin
  context_value := private.jgc_job_board_jsa_context(p_token,p_visit_token,p_document_id);
  if p_confirm_read is distinct from true then raise exception 'Please confirm you have read the JSA'; end if;
  select * into d from public.job_board_documents where id=p_document_id for share;
  if p_reviewed_version is null or d.updated_at<>p_reviewed_version then raise exception 'The JSA changed. Open it again and confirm you have read the updated report'; end if;
  if p_signature_strokes is null or jsonb_typeof(p_signature_strokes)<>'array' then raise exception 'Add a valid signature'; end if;
  if jsonb_array_length(p_signature_strokes) not between 1 and 200 or octet_length(p_signature_strokes::text)>51200 or p_signature_width is null or p_signature_height is null or p_signature_width not between 200 and 2000 or p_signature_height not between 80 and 1000 then raise exception 'Add a valid signature'; end if;
  for stroke in select value from jsonb_array_elements(p_signature_strokes) loop
    if jsonb_typeof(stroke)<>'array' then raise exception 'Invalid signature stroke'; end if;
    if jsonb_array_length(stroke) not between 2 and 2000 then raise exception 'Invalid signature stroke'; end if;
    points := points+jsonb_array_length(stroke);if points>10000 then raise exception 'Signature is too large'; end if;
    for point in select value from jsonb_array_elements(stroke) loop
      if jsonb_typeof(point)<>'array' then raise exception 'Invalid signature point'; end if;
      if jsonb_array_length(point)<>2 or jsonb_typeof(point->0)<>'number' or jsonb_typeof(point->1)<>'number' then raise exception 'Invalid signature point'; end if;
      if (point->>0)::numeric not between 0 and 1 or (point->>1)::numeric not between 0 and 1 then raise exception 'Invalid signature point'; end if;
    end loop;
  end loop;
  select * into b from public.job_boards where id=d.board_id and enabled for share;
  if b.id is null then raise exception 'Job Board unavailable' using errcode='42501'; end if;
  actor := private.jgc_job_board_actor(b.id,p_visit_token); staff := actor->>'identity_type'='staff'; record_id_value:=coalesce(d.source_id,d.id);
  select * into w from public.jsa_worker_workflows where record_id=record_id_value;
  if w.record_id is not null and w.completed_at is null then
    raise exception 'Worker signatures for this JSA are still being collected on the creator phone. Late sign-on opens once every listed worker has signed.';
  end if;
  key_value := case
    when w.record_id is not null and staff then 'jsa-worker:'||(actor->>'profile_id')
    when w.record_id is not null then 'jsa-external:'||md5(lower(trim(actor->>'name'))||'|'||lower(trim(actor->>'company')))
    when staff then 'job-board-staff:'||(actor->>'profile_id')
    else 'job-board-visitor:'||encode(sha256(convert_to(lower(trim(actor->>'name'))||'|'||lower(trim(actor->>'company'))||'|'||lower(trim(actor->>'email')),'UTF8')),'hex') end;
  perform pg_advisory_xact_lock(hashtextextended('job-board-jsa-sign:'||record_id_value::text||':'||key_value,0));
  select * into ack from public.safety_acknowledgements a where a.record_type='jsa' and a.record_id=record_id_value and a.removed_at is null and (a.attendee_key=key_value or (staff and a.matched_employee_id::text=actor->>'profile_id')) order by (a.signature_signed_at is not null) desc,a.created_at limit 1 for update;
  if ack.signature_signed_at is not null then return jsonb_build_object('ok',true,'already_signed',true,'signed_at',ack.signature_signed_at); end if;
  if ack.id is null then
    insert into public.safety_acknowledgements(record_type,record_id,record_title,record_date,job_id,job_number,job_name,project,location,attendee_name,attendee_key,attendee_company,attendee_type,matched_employee_id,matched_employee_email,acknowledgement_status,acknowledgement_method,acknowledged_at,acknowledged_by_user_id,acknowledged_by_name,acknowledgement_note,is_late,unmatched_qr_entry,created_by,created_by_name,signature_strokes,signature_width,signature_height,signature_signed_name,signature_signed_at)
    values('jsa',record_id_value,d.title,d.report_date,b.portal_job_id,b.job_number,b.job_name,b.job_number||' - '||b.job_name,b.address,actor->>'name',key_value,actor->>'company',case when staff then 'employee' else 'external' end,case when staff then auth.uid() else null end,actor->>'email','late_acknowledgement',case when staff then 'late_user_portal' else 'late_qr_external' end,clock_timestamp(),auth.uid(),actor->>'name','Confirmed read on Job Board',true,not staff,coalesce(actor->>'profile_id','Job Board visitor'),actor->>'name',p_signature_strokes,p_signature_width,p_signature_height,actor->>'name',clock_timestamp()) returning * into ack;
  else
    update public.safety_acknowledgements set attendee_name=actor->>'name',attendee_company=actor->>'company',acknowledgement_status='late_acknowledgement',acknowledgement_method=case when staff then 'late_user_portal' else 'late_qr_external' end,acknowledged_at=clock_timestamp(),acknowledged_by_user_id=auth.uid(),acknowledged_by_name=actor->>'name',acknowledgement_note='Confirmed read on Job Board',is_late=true,signature_strokes=p_signature_strokes,signature_width=p_signature_width,signature_height=p_signature_height,signature_signed_name=actor->>'name',signature_signed_at=clock_timestamp() where id=ack.id returning * into ack;
  end if;
  return jsonb_build_object('ok',true,'already_signed',false,'signed_at',ack.signature_signed_at);
end $function$;
