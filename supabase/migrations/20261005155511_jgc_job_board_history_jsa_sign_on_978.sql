-- Release 978: canonical job-scoped JSA sign-on and separate sign-in pagination.
begin;
create function private.jgc_job_board_jsa_context(p_token text,p_visit_token uuid,p_document_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare d public.job_board_documents; b public.job_boards; actor jsonb; record_id_value uuid; key_value text; ack public.safety_acknowledgements; roster jsonb;
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
  return jsonb_build_object('document_id',d.id,'title',d.title,'report_date',d.report_date,'version',d.updated_at,'identity',jsonb_build_object('name',actor->>'name','company',actor->>'company'),'signed',ack.signature_signed_at is not null,'signed_at',ack.signature_signed_at,'record',case when d.source_type='inspection_records' then d.source_payload else null end,'acknowledgements',roster);
end $$;

create function private.jgc_sign_job_board_jsa(p_token text,p_visit_token uuid,p_document_id uuid,p_confirm_read boolean,p_reviewed_version timestamptz,p_signature_strokes jsonb,p_signature_width integer,p_signature_height integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare context_value jsonb; d public.job_board_documents; b public.job_boards; actor jsonb; key_value text; record_id_value uuid; ack public.safety_acknowledgements; stroke jsonb; point jsonb; points integer:=0; staff boolean;
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
  key_value := case when staff then 'job-board-staff:'||(actor->>'profile_id') else 'job-board-visitor:'||encode(sha256(convert_to(lower(trim(actor->>'name'))||'|'||lower(trim(actor->>'company'))||'|'||lower(trim(actor->>'email')),'UTF8')),'hex') end;
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
end $$;
create function public.get_job_board_jsa(p_token text,p_visit_token uuid,p_document_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$ select private.jgc_job_board_jsa_context(p_token,p_visit_token,p_document_id) $$;
create function public.sign_job_board_jsa(p_token text,p_visit_token uuid,p_document_id uuid,p_confirm_read boolean,p_reviewed_version timestamptz,p_signature_strokes jsonb,p_signature_width integer,p_signature_height integer) returns jsonb language sql security invoker set search_path='' as $$ select private.jgc_sign_job_board_jsa(p_token,p_visit_token,p_document_id,p_confirm_read,p_reviewed_version,p_signature_strokes,p_signature_width,p_signature_height) $$;
revoke all on function private.jgc_job_board_jsa_context(text,uuid,uuid),public.get_job_board_jsa(text,uuid,uuid),private.jgc_sign_job_board_jsa(text,uuid,uuid,boolean,timestamptz,jsonb,integer,integer),public.sign_job_board_jsa(text,uuid,uuid,boolean,timestamptz,jsonb,integer,integer) from public,anon,authenticated;
grant execute on function private.jgc_job_board_jsa_context(text,uuid,uuid),public.get_job_board_jsa(text,uuid,uuid),private.jgc_sign_job_board_jsa(text,uuid,uuid,boolean,timestamptz,jsonb,integer,integer),public.sign_job_board_jsa(text,uuid,uuid,boolean,timestamptz,jsonb,integer,integer) to anon,authenticated;

create function private.jgc_get_job_board_signins(p_board_id uuid,p_kind text,p_before timestamptz,p_limit integer) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare rows_value jsonb;cursor_value timestamptz; action_value text;
begin
  if not private.jgc_job_board_admin() then raise exception 'Approved administrator access required' using errcode='42501'; end if;
  if not exists(select 1 from public.job_boards where id=p_board_id) then raise exception 'Job Board unavailable';end if;
  if p_kind not in ('portal','site') or p_kind is null then raise exception 'Select Portal or Site sign-ins';end if;
  action_value:=case when p_kind='portal' then 'visit' else 'site-signin' end;
  select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at desc),'[]'::jsonb),min(q.created_at) into rows_value,cursor_value from (select id,actor_name,actor_company,actor_email,identity_type,action,created_at,reason from public.job_board_activity where board_id=p_board_id and action=action_value and (p_before is null or created_at<p_before) order by created_at desc limit greatest(1,least(coalesce(p_limit,50),100))) q;
  if not exists(select 1 from public.job_board_activity where board_id=p_board_id and action=action_value and created_at<cursor_value) then cursor_value:=null;end if;
  return jsonb_build_object('events',rows_value,'next_before',cursor_value);
end $$;
create function public.get_job_board_signins(p_board_id uuid,p_kind text,p_before timestamptz default null,p_limit integer default 50) returns jsonb language sql stable security invoker set search_path='' as $$ select private.jgc_get_job_board_signins(p_board_id,p_kind,p_before,p_limit) $$;
revoke all on function private.jgc_get_job_board_signins(uuid,text,timestamptz,integer),public.get_job_board_signins(uuid,text,timestamptz,integer) from public,anon,authenticated;
grant execute on function private.jgc_get_job_board_signins(uuid,text,timestamptz,integer),public.get_job_board_signins(uuid,text,timestamptz,integer) to authenticated;
commit;
