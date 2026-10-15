-- Only a valid personal signature activates a prepared JSA. Reading/login never writes a JSA.
-- Existing completed records/signatures are not backfilled or rewritten.
alter table public.jsa_preparations add column activated_visit_id uuid;
alter table public.jsa_preparations add column activation_identity jsonb;
alter table public.jsa_preparations drop constraint jsa_preparations_check;
alter table public.jsa_preparations add constraint jsa_preparations_check check (
 (activated_at is null and record_id is null and activated_by is null and activated_visit_id is null and acknowledgement_mode is null)
 or (activated_at is not null and record_id is not null and (activated_by is not null or activated_visit_id is not null) and acknowledgement_mode is not null)
);

create function private.jgc_board_jsa_planned_workers(p_payload jsonb) returns jsonb
language sql immutable set search_path='' as $$
 select coalesce(jsonb_agg(worker order by kind,position),'[]'::jsonb) from (
  select 0 kind,ordinality position,jsonb_build_object('employee_id',v->>'profile_id','name',v->>'display_name','company','John Gordon Construction') worker
  from jsonb_array_elements(coalesce(p_payload->'crew','[]'::jsonb)) with ordinality x(v,ordinality)
  union all
  select 1,ordinality,case when jsonb_typeof(v)='object' then jsonb_build_object('name',v->>'name','company',v->>'company')
   else jsonb_build_object('name',split_part(v#>>'{}',' - ',1),'company',case when position(' - ' in v#>>'{}')>0 then substring(v#>>'{}' from position(' - ' in v#>>'{}')+3) else '' end) end
  from jsonb_array_elements(coalesce(p_payload->'manual','[]'::jsonb)) with ordinality x(v,ordinality)
 ) planned
$$;

create function private.jgc_board_jsa_review_key(p_id uuid,p_record jsonb,p_workers jsonb) returns text
language sql immutable set search_path='' as $$
 select encode(sha256(convert_to(jsonb_build_object('id',p_id,'date',p_record->'inspection_date',
   'form_data',(p_record->'form_data')-'jsa_worker_workflow_version','summary',coalesce(p_record->'summary','{}'::jsonb),
   'workers',p_workers)::text,'UTF8')),'hex')
$$;

create function private.jgc_board_jsa_context(p_token text,p_visit_token uuid,p_id uuid,p_prepared boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b public.job_boards; p public.jsa_preparations; r public.inspection_records; w public.jsa_worker_workflows;
 actor jsonb; model jsonb; workers jsonb; a public.safety_acknowledgements; actor_key text; d public.job_board_documents;
begin
 if p_prepared is distinct from false and p_prepared is distinct from true then raise exception 'Invalid JSA'; end if;
 select * into b from public.job_boards where token=p_token and enabled;
 if b.id is null then raise exception 'Job Board unavailable' using errcode='42501'; end if;
 actor:=private.jgc_job_board_actor(b.id,p_visit_token);
 if p_prepared then
  select * into p from public.jsa_preparations where id=p_id;
  if p.id is null or p.payload#>>'{record,inspection_date}' is distinct from ((now() at time zone 'America/Toronto')::date)::text
    or private.jgc_job_board_source_matches(p.payload->'record',b.id,b.job_number) is not true then
   raise exception 'Today’s JSA is unavailable for this job' using errcode='42501';
  end if;
  if p.activated_at is null then
   workers:=private.jgc_board_jsa_planned_workers(p.payload);
   model:=jsonb_build_object('document_id',p.id,'title','JSA - '||(p.payload#>>'{record,inspection_date}'),
    'report_date',p.payload#>>'{record,inspection_date}','identity',jsonb_build_object('name',actor->>'name','company',actor->>'company'),
    'signed',false,'record',(p.payload->'record')||jsonb_build_object('form_data',(p.payload#>'{record,form_data}')||jsonb_build_object('jsa_worker_workflow_version',2),
      'jsa_workflow',jsonb_build_object('version',2,'status','Prepared — first signature activates')),'acknowledgements','[]'::jsonb,
    'workflow',jsonb_build_object('version',2,'active',true,'status','Prepared — first signature activates','required',jsonb_array_length(workers),'signed',0,'outstanding',jsonb_array_length(workers)),
    'board_self_sign',true,'prepared',true,'review_key',private.jgc_board_jsa_review_key(p.id,p.payload->'record',workers));
   if not private.jgc_job_board_staff() then model:=private.jgc1014_public_safety_model(model); end if;
   return model;
  end if;
  select * into d from public.job_board_documents where board_id=b.id and source_type='inspection_records' and source_id=p.record_id and status='published' and category='jsa' order by created_at,id limit 1;
  if d.id is null then raise exception 'Published JSA unavailable' using errcode='42501'; end if;
 else
  select * into d from public.job_board_documents where id=p_id and board_id=b.id;
 end if;
 -- Retain all original document visibility, session and public signature-redaction checks.
 model:=private.jgc_job_board_jsa_context(p_token,p_visit_token,d.id);
 select * into w from public.jsa_worker_workflows where record_id=coalesce(d.source_id,d.id);
 if w.record_id is not null and w.valid_date=(now() at time zone 'America/Toronto')::date then
  select * into r from public.inspection_records where id=w.record_id;
  if private.jgc_job_board_source_matches(to_jsonb(r),b.id,b.job_number) is not true then raise exception 'JSA belongs to a different job' using errcode='42501'; end if;
  actor_key:=case when actor->>'identity_type'='staff' then 'jsa-worker:'||(actor->>'profile_id')
    else 'jsa-external:'||md5(lower(trim(actor->>'name'))||'|'||lower(trim(actor->>'company'))) end;
  select * into a from public.safety_acknowledgements where record_type='jsa' and record_id=w.record_id and removed_at is null
    and (attendee_key=actor_key or (actor->>'identity_type'='staff' and matched_employee_id::text=actor->>'profile_id'))
    order by (signature_signed_at is not null) desc,created_at,id limit 1;
  model:=model||jsonb_build_object('signed',a.signature_signed_at is not null,'signed_at',a.signature_signed_at,'board_self_sign',true,
   'review_key',private.jgc_board_jsa_review_key(w.record_id,to_jsonb(r),w.source_payload->'workers'));
 end if;
 if not private.jgc_job_board_staff() then model:=private.jgc1014_public_safety_model(model); end if;
 return model;
end $$;

create function public.get_job_board_prepared_jsa(p_token text,p_visit_token uuid,p_prepared_id uuid) returns jsonb
language sql security invoker set search_path='' as $$ select private.jgc_board_jsa_context(p_token,p_visit_token,p_prepared_id,true) $$;
create or replace function public.get_job_board_jsa(p_token text,p_visit_token uuid,p_document_id uuid) returns jsonb
language sql security invoker set search_path='' as $$ select private.jgc_board_jsa_context(p_token,p_visit_token,p_document_id,false) $$;

create function private.jgc_list_board_prepared_jsas(p_token text,p_visit_token uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare b public.job_boards;
begin
 select * into b from public.job_boards where token=p_token and enabled;
 if b.id is null then raise exception 'Job Board unavailable' using errcode='42501'; end if;
 perform private.jgc_job_board_actor(b.id,p_visit_token);
 return coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'work_date',p.payload#>>'{record,inspection_date}',
   'project',(select f->>'value' from jsonb_array_elements(p.payload#>'{record,form_data,fields}') f where f->>'label'='Project / Job' limit 1),
   'prepared_by',pr.display_name,'updated_at',p.updated_at) order by p.created_at desc,p.id)
  from public.jsa_preparations p left join public.profiles pr on pr.id=p.created_by
  where p.activated_at is null and p.payload#>>'{record,inspection_date}'=((now() at time zone 'America/Toronto')::date)::text
   and private.jgc_job_board_source_matches(p.payload->'record',b.id,b.job_number)),'[]'::jsonb);
end $$;
create function public.list_job_board_prepared_jsas(p_token text,p_visit_token uuid) returns jsonb
language sql security invoker set search_path='' as $$ select private.jgc_list_board_prepared_jsas(p_token,p_visit_token) $$;

-- Owner-only, never exposed through the API. Its caller checks the exact job/date, review key and signature.
create function private.jgc_seed_board_prepared_jsa(p_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare p public.jsa_preparations; person public.profiles; worker public.profiles; item jsonb; source jsonb; workers jsonb;
 data_value jsonb; key_value text; name_value text; company_value text; employee_id_value uuid; date_value date;
begin
 select * into p from public.jsa_preparations where id=p_id for update;
 if p.id is null then raise exception 'Prepared JSA unavailable'; end if;
 if p.activated_at is not null then return p.record_id; end if;
 source:=p.payload->'record';workers:=private.jgc_board_jsa_planned_workers(p.payload);
 date_value:=(source->>'inspection_date')::date;
 if date_value is distinct from (now() at time zone 'America/Toronto')::date then raise exception 'Sign on only on the JSA work date'; end if;
 if exists(select 1 from public.inspection_records where id=p_id) then raise exception 'Existing JSA history is preserved. Reopen the current JSA.'; end if;
 if jsonb_typeof(source#>'{form_data,fields}') is distinct from 'array' or jsonb_typeof(source#>'{form_data,rows}') is distinct from 'array'
  or jsonb_array_length(source#>'{form_data,rows}')=0 or jsonb_array_length(workers)>500
  or not exists(select 1 from jsonb_array_elements(source#>'{form_data,fields}') f where f->>'label'='Project / Job' and nullif(trim(f->>'value'),'') is not null)
  or exists(select 1 from jsonb_array_elements(source#>'{form_data,rows}') f where coalesce(length(trim(f#>>'{cells,0}')),0)=0 or coalesce(length(trim(f#>>'{cells,1}')),0)=0 or coalesce(length(trim(f#>>'{cells,2}')),0)=0)
  then raise exception 'The prepared JSA needs its project, task, hazards and controls completed by the office'; end if;
 select * into person from public.profiles where id=p.created_by;
 if person.id is null then raise exception 'JSA author unavailable'; end if;
 data_value:=(source->'form_data')||jsonb_build_object('jsa_worker_workflow_version',2);
 insert into public.inspection_records(id,worker_name,worker_display_name,inspection_type,inspection_date,title,summary,form_data,email_body)
 values(p.id,person.worker_key,person.display_name,'JSA',date_value,'JSA - '||date_value::text,coalesce(source->'summary','{}'::jsonb),data_value,source->>'email_body');
 insert into public.jsa_worker_workflows(record_id,created_by,valid_date,source_payload,prepared_in_advance,requested_at)
 values(p.id,p.created_by,date_value,jsonb_build_object('record',source,'workers',workers),(p.created_at at time zone 'America/Toronto')::date<date_value,now());
 for item in select value from jsonb_array_elements(workers) loop
  employee_id_value:=nullif(item->>'employee_id','')::uuid;
  name_value:=trim(coalesce(item->>'name',''));company_value:=trim(coalesce(item->>'company',''));
  if employee_id_value is not null then
   select * into worker from public.profiles where id=employee_id_value and account_status='approved';
   if not found then raise exception 'A planned worker no longer has an approved account. Ask the office to update this JSA.'; end if;
   name_value:=worker.display_name;company_value:='John Gordon Construction';
  elsif lower(company_value) in ('john gordon construction','john gordon construction inc','jgc') then
   if (select count(*) from public.profiles where account_status='approved' and lower(trim(display_name))=lower(name_value))=1 then
    select * into worker from public.profiles where account_status='approved' and lower(trim(display_name))=lower(name_value);
    employee_id_value:=worker.id;name_value:=worker.display_name;company_value:='John Gordon Construction';
   end if;
  end if;
  if name_value='' or company_value='' or length(name_value)>200 or length(company_value)>200 then raise exception 'Each planned worker needs Name and Company'; end if;
  key_value:=case when employee_id_value is not null then 'jsa-worker:'||employee_id_value::text else 'jsa-external:'||md5(lower(name_value)||'|'||lower(company_value)) end;
  if not exists(select 1 from public.safety_acknowledgements where record_type='jsa' and record_id=p.id and attendee_key=key_value) then
   insert into public.safety_acknowledgements(record_type,record_id,record_title,record_date,attendee_name,attendee_key,attendee_company,attendee_type,matched_employee_id,matched_employee_email,created_by,created_by_name,project,location,job_number,job_name)
   values('jsa',p.id,'JSA - '||date_value::text,date_value,name_value,key_value,company_value,case when employee_id_value is null then 'external' else 'employee' end,
    employee_id_value,case when employee_id_value is null then null else worker.email end,p.created_by::text,person.display_name,
    data_value#>>'{job_context,project}',data_value#>>'{job_context,location}',data_value#>>'{job_context,jobNumber}',data_value#>>'{job_context,jobName}');
  end if;
 end loop;
 return p.id;
end $$;

create function private.jgc_sign_today_board_jsa(p_token text,p_visit_token uuid,p_id uuid,p_prepared boolean,p_reviewed_key text,p_confirm_read boolean,p_strokes jsonb,p_width integer,p_height integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b public.job_boards; p public.jsa_preparations; r public.inspection_records; w public.jsa_worker_workflows; d public.job_board_documents;
 actor jsonb; context_value jsonb; a public.safety_acknowledgements; s public.job_board_visitor_sessions;
 record_id_value uuid; key_value text; staff boolean; was_completed boolean; stroke jsonb; point jsonb; points integer:=0; new_doc uuid;
begin
 context_value:=private.jgc_board_jsa_context(p_token,p_visit_token,p_id,p_prepared);
 if p_confirm_read is distinct from true then raise exception 'Please confirm you have read the JSA'; end if;
 if p_strokes is null or jsonb_typeof(p_strokes)<>'array' or jsonb_array_length(p_strokes) not between 1 and 200 or octet_length(p_strokes::text)>51200
  or p_width is null or p_height is null or p_width not between 200 and 2000 or p_height not between 80 and 1000 then raise exception 'Add a valid signature'; end if;
 for stroke in select value from jsonb_array_elements(p_strokes) loop
  if jsonb_typeof(stroke)<>'array' or jsonb_array_length(stroke) not between 2 and 2000 then raise exception 'Invalid signature stroke'; end if;
  points:=points+jsonb_array_length(stroke);if points>10000 then raise exception 'Signature is too large'; end if;
  for point in select value from jsonb_array_elements(stroke) loop
   if jsonb_typeof(point)<>'array' or jsonb_array_length(point)<>2 or jsonb_typeof(point->0)<>'number' or jsonb_typeof(point->1)<>'number'
     or (point->>0)::numeric not between 0 and 1 or (point->>1)::numeric not between 0 and 1 then raise exception 'Invalid signature point'; end if;
  end loop;
 end loop;
 select * into b from public.job_boards where token=p_token and enabled for share;
 actor:=private.jgc_job_board_actor(b.id,p_visit_token);staff:=actor->>'identity_type'='staff';
 if nullif(trim(actor->>'name'),'') is null or nullif(trim(actor->>'company'),'') is null then raise exception 'Sign in with your name and company' using errcode='42501'; end if;
 if p_prepared then record_id_value:=p_id;
 else select coalesce(source_id,id) into record_id_value from public.job_board_documents where id=p_id and board_id=b.id; end if;
 -- Same lock order as manual activation, followed by the shared worker-signature lock.
 perform pg_advisory_xact_lock(hashtextextended(record_id_value::text,0));
 perform pg_advisory_xact_lock(hashtextextended('jsa-workers:'||record_id_value::text,0));
 context_value:=private.jgc_board_jsa_context(p_token,p_visit_token,p_id,p_prepared);
 if p_reviewed_key is null or context_value->>'review_key' is distinct from p_reviewed_key then raise exception 'The JSA changed. Reopen it and review the current report' using errcode='40001'; end if;
 if context_value->>'board_self_sign' is distinct from 'true' then raise exception 'Sign on only on the JSA work date'; end if;
 if p_prepared then
  select * into p from public.jsa_preparations where id=p_id for update;
  if p.activated_at is null then record_id_value:=private.jgc_seed_board_prepared_jsa(p_id); end if;
 end if;
 select * into w from public.jsa_worker_workflows where record_id=record_id_value for update;
 if w.record_id is null or w.valid_date is distinct from (now() at time zone 'America/Toronto')::date then raise exception 'Sign on only on the JSA work date'; end if;
 select * into r from public.inspection_records where id=record_id_value;
 if private.jgc_job_board_source_matches(to_jsonb(r),b.id,b.job_number) is not true then raise exception 'JSA belongs to a different job' using errcode='42501'; end if;
 was_completed:=w.completed_at is not null;
 key_value:=case when staff then 'jsa-worker:'||(actor->>'profile_id') else 'jsa-external:'||md5(lower(trim(actor->>'name'))||'|'||lower(trim(actor->>'company'))) end;
 select * into a from public.safety_acknowledgements where record_type='jsa' and record_id=record_id_value and removed_at is null
  and (attendee_key=key_value or (staff and matched_employee_id::text=actor->>'profile_id')) order by (signature_signed_at is not null) desc,created_at,id limit 1 for update;
 if a.signature_signed_at is not null then return jsonb_build_object('ok',true,'already_signed',true,'signed_at',a.signature_signed_at,'workflow',private.jgc_jsa_worker_state(record_id_value)); end if;
 if a.id is null then
  insert into public.safety_acknowledgements(record_type,record_id,record_title,record_date,job_id,job_number,job_name,project,location,attendee_name,attendee_key,attendee_company,attendee_type,matched_employee_id,matched_employee_email,created_by,created_by_name)
  values('jsa',record_id_value,r.title,r.inspection_date,b.portal_job_id,b.job_number,b.job_name,b.job_number||' - '||b.job_name,b.address,
   actor->>'name',key_value,actor->>'company',case when staff then 'employee' else 'external' end,case when staff then (actor->>'profile_id')::uuid else null end,
   actor->>'email',coalesce(actor->>'profile_id','Job Board visitor'),actor->>'name') returning * into a;
 end if;
 update public.safety_acknowledgements set acknowledgement_status=case when was_completed then 'late_acknowledgement' else 'acknowledged_by_user' end,
  acknowledgement_method=case when was_completed and staff then 'late_user_portal' when was_completed then 'late_qr_external' when staff then 'user_portal' else 'qr_external' end,
  acknowledged_at=clock_timestamp(),acknowledged_by_user_id=auth.uid(),acknowledged_by_name=actor->>'name',acknowledgement_note='Personally confirmed read and signed on Job Board',
  is_late=was_completed,signature_strokes=p_strokes,signature_width=p_width,signature_height=p_height,signature_signed_name=actor->>'name',signature_signed_at=clock_timestamp()
 where id=a.id returning * into a;
 update public.jsa_worker_workflows set requested_at=coalesce(requested_at,now()),completed_at=case when not exists(
  select 1 from public.safety_acknowledgements where record_type='jsa' and record_id=record_id_value and removed_at is null and signature_signed_at is null) then coalesce(completed_at,now()) else null end
 where record_id=record_id_value;
 if p_prepared and p.activated_at is null then
  if not staff then s:=private.jgc_job_board_visit(b.id,p_visit_token);if s.id is null then raise exception 'Sign in again' using errcode='42501'; end if;end if;
  update public.jsa_preparations set activated_at=now(),activated_by=case when staff then auth.uid() else null end,activated_visit_id=case when staff then null else s.id end,
   activation_identity=jsonb_build_object('name',actor->>'name','company',actor->>'company','identity_type',actor->>'identity_type'),
   record_id=record_id_value,acknowledgement_mode='workers',updated_at=now() where id=p_id;
  -- Publish only the trusted, job/date-matched saved JSA, never visitor-provided report content.
  perform pg_advisory_xact_lock(hashtextextended('job-board-source:'||b.id::text||':inspection_records:'||record_id_value::text,0));
  select * into d from public.job_board_documents where board_id=b.id and source_type='inspection_records' and source_id=record_id_value for update;
  if d.id is not null and d.status<>'published' then raise exception 'This JSA is no longer published' using errcode='42501'; end if;
  if d.id is null then
   new_doc:=gen_random_uuid();
   insert into public.job_board_documents(id,board_id,category,title,report_date,file_name,mime_type,file_size,object_path,notes,status,visibility,source_type,source_id,source_payload,created_by)
   values(new_doc,b.id,'jsa',r.title,r.inspection_date,'JGC-jsa-'||r.inspection_date::text||'.pdf','application/pdf',1,b.id::text||'/'||new_doc::text||'/original.pdf','','published','public',
    'inspection_records',record_id_value,private.jgc_job_board_clean_snapshot(to_jsonb(r)),auth.uid());
  end if;
 end if;
 return jsonb_build_object('ok',true,'already_signed',false,'signed_at',a.signature_signed_at,'activated',p_prepared,'workflow',private.jgc_jsa_worker_state(record_id_value));
end $$;
create function public.sign_today_job_board_jsa(p_token text,p_visit_token uuid,p_id uuid,p_prepared boolean,p_reviewed_key text,p_confirm_read boolean,p_strokes jsonb,p_width integer,p_height integer) returns jsonb
language sql security invoker set search_path='' as $$ select private.jgc_sign_today_board_jsa(p_token,p_visit_token,p_id,p_prepared,p_reviewed_key,p_confirm_read,p_strokes,p_width,p_height) $$;

revoke all on function private.jgc_board_jsa_planned_workers(jsonb),private.jgc_board_jsa_review_key(uuid,jsonb,jsonb),private.jgc_seed_board_prepared_jsa(uuid),
 private.jgc_board_jsa_context(text,uuid,uuid,boolean),private.jgc_list_board_prepared_jsas(text,uuid),
 private.jgc_sign_today_board_jsa(text,uuid,uuid,boolean,text,boolean,jsonb,integer,integer),
 public.get_job_board_prepared_jsa(text,uuid,uuid),public.list_job_board_prepared_jsas(text,uuid),
 public.sign_today_job_board_jsa(text,uuid,uuid,boolean,text,boolean,jsonb,integer,integer) from public,anon,authenticated;
grant execute on function private.jgc_board_jsa_context(text,uuid,uuid,boolean),private.jgc_list_board_prepared_jsas(text,uuid),
 private.jgc_sign_today_board_jsa(text,uuid,uuid,boolean,text,boolean,jsonb,integer,integer),
 public.get_job_board_prepared_jsa(text,uuid,uuid),public.list_job_board_prepared_jsas(text,uuid),
 public.sign_today_job_board_jsa(text,uuid,uuid,boolean,text,boolean,jsonb,integer,integer) to anon,authenticated;
