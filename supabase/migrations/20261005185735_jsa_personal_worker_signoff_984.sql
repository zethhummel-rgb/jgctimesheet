-- New JSAs only. Existing inspections and signature rows are never backfilled.
create table public.jsa_worker_workflows (
  record_id uuid primary key references public.inspection_records(id) on delete cascade,
  created_by uuid not null references auth.users(id),
  valid_date date not null,
  prepared_in_advance boolean not null default false,
  revision integer not null default 1 check (revision > 0),
  requested_at timestamptz,
  completed_at timestamptz,
  source_payload jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.jsa_worker_workflows enable row level security;
revoke all on public.jsa_worker_workflows from public,anon,authenticated;
grant select on public.jsa_worker_workflows to authenticated;
create policy "Approved staff read JSA worker workflows" on public.jsa_worker_workflows for select to authenticated using ((select private.jgc_has_full_portal_access()));
create index jsa_worker_workflows_created_by_idx on public.jsa_worker_workflows(created_by);
create index jsa_worker_workflows_valid_date_idx on public.jsa_worker_workflows(valid_date) where completed_at is null;

create function private.jgc_jsa_worker_state(p_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('version',2,'revision',w.revision,'valid_date',w.valid_date,'requested_at',w.requested_at,'completed_at',w.completed_at,
    'today',(now() at time zone 'America/Toronto')::date,'active',w.valid_date=(now() at time zone 'America/Toronto')::date,'signing_mode',case when w.prepared_in_advance then 'shared_phone' else 'creator_phone' end,'prepared_in_advance',w.prepared_in_advance,
    'required',a.total,'signed',a.signed,'outstanding',a.total-a.signed,
    'status',case when w.completed_at is not null then 'Completed'
      when w.valid_date>(now() at time zone 'America/Toronto')::date then 'Prepared'
      when w.valid_date<(now() at time zone 'America/Toronto')::date then 'Draft — Work Date Passed'
      when a.total=0 then 'Draft — Workers Onsite Required' else 'Draft — Awaiting Worker Sign-Offs' end)
  from public.jsa_worker_workflows w cross join lateral
    (select count(*)::integer total,count(*) filter(where signature_signed_at is not null and signature_strokes is not null)::integer signed
     from public.safety_acknowledgements where record_type='jsa' and record_id=w.record_id and removed_at is null) a where w.record_id=p_id;
$$;
create function private.jgc_jsa_worker_model(p_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('record',to_jsonb(r)||jsonb_build_object('jsa_workflow',private.jgc_jsa_worker_state(p_id)),
    'can_collect',exists(select 1 from public.jsa_worker_workflows where record_id=p_id and (created_by=auth.uid() or prepared_in_advance)),
    'can_edit',exists(select 1 from public.jsa_worker_workflows where record_id=p_id and (created_by=auth.uid() or public.is_admin()) and requested_at is null),'workflow',private.jgc_jsa_worker_state(p_id),'acknowledgements',coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at,a.id)
      from public.safety_acknowledgements a where a.record_type='jsa' and a.record_id=p_id and a.removed_at is null),'[]'::jsonb))
  from public.inspection_records r where r.id=p_id and lower(r.inspection_type)='jsa';
$$;
create function private.jgc_get_jsa_worker_workflow(p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or not private.jgc_has_full_portal_access() then raise exception 'Approved account required' using errcode='42501'; end if;
  return private.jgc_jsa_worker_model(p_id);
end $$;

create function private.jgc_save_worker_jsa(p_id uuid,p_revision integer,p_payload jsonb,p_workers jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare w public.jsa_worker_workflows; r public.inspection_records; person public.profiles; worker public.profiles; item jsonb; source jsonb; data_value jsonb; key_value text; name_value text; company_value text; employee_id uuid; date_value date; source_value jsonb;
begin
  if auth.uid() is null or not private.jgc_has_full_portal_access() then raise exception 'Approved account required' using errcode='42501'; end if;
  select * into person from public.profiles where id=auth.uid() and account_status='approved';
  if person.id is null then raise exception 'Approved account required' using errcode='42501'; end if;
  if p_id is null or jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>1048576
    or jsonb_typeof(p_payload#>'{form_data,fields}') is distinct from 'array'
    or jsonb_typeof(p_payload#>'{form_data,rows}') is distinct from 'array'
    or jsonb_typeof(p_workers) is distinct from 'array' or jsonb_array_length(p_workers)>500 then raise exception 'Invalid JSA'; end if;
  date_value:=nullif(p_payload->>'inspection_date','')::date;
  if date_value is null or not exists(select 1 from jsonb_array_elements(p_payload#>'{form_data,fields}') f where f->>'label'='Project / Job' and nullif(trim(f->>'value'),'') is not null)
    or jsonb_array_length(p_payload#>'{form_data,rows}')=0
    or exists(select 1 from jsonb_array_elements(p_payload#>'{form_data,rows}') f where coalesce(length(trim(f#>>'{cells,0}')),0)=0 or coalesce(length(trim(f#>>'{cells,1}')),0)=0 or coalesce(length(trim(f#>>'{cells,2}')),0)=0)
    then raise exception 'Project, date, task, hazards and controls are required'; end if;
  source_value:=jsonb_build_object('record',p_payload,'workers',p_workers);
  perform pg_advisory_xact_lock(hashtextextended('jsa-workers:'||p_id::text,0));
  select * into w from public.jsa_worker_workflows where record_id=p_id for update;
  if found then
    if w.created_by<>auth.uid() and not public.is_admin() then raise exception 'Only the creator or admin can edit this JSA' using errcode='42501'; end if;
    if w.source_payload=source_value then return private.jgc_jsa_worker_model(p_id); end if;
    if w.revision is distinct from p_revision then raise exception 'This JSA changed. Reopen it before saving' using errcode='40001'; end if;
    if w.requested_at is not null or exists(select 1 from public.safety_acknowledgements where record_type='jsa' and record_id=p_id and signature_signed_at is not null) then raise exception 'Sign-off has started. Prepare a new JSA revision to change the report or workers'; end if;
    delete from public.safety_acknowledgements where record_type='jsa' and record_id=p_id;
  elsif exists(select 1 from public.inspection_records where id=p_id) then
    raise exception 'Existing JSA and signatures are preserved. Prepare a new JSA';
  elsif p_revision is distinct from 0 then raise exception 'JSA not found'; end if;
  data_value:=(p_payload->'form_data')||jsonb_build_object('jsa_worker_workflow_version',2);
  insert into public.inspection_records(id,worker_name,worker_display_name,inspection_type,inspection_date,title,summary,form_data,email_body)
    values(p_id,person.worker_key,person.display_name,'JSA',date_value,'JSA - '||date_value::text,coalesce(p_payload->'summary','{}'::jsonb),data_value,p_payload->>'email_body')
    on conflict(id) do update set inspection_date=excluded.inspection_date,title=excluded.title,summary=excluded.summary,form_data=excluded.form_data,email_body=excluded.email_body returning * into r;
  insert into public.jsa_worker_workflows(record_id,created_by,valid_date,source_payload,prepared_in_advance) values(p_id,auth.uid(),date_value,source_value,date_value>(now() at time zone 'America/Toronto')::date)
    on conflict(record_id) do update set valid_date=excluded.valid_date,source_payload=excluded.source_payload,revision=jsa_worker_workflows.revision+1;
  for item in select value from jsonb_array_elements(p_workers) loop
    employee_id:=nullif(item->>'employee_id','')::uuid;
    name_value:=trim(coalesce(item->>'name','')); company_value:=trim(coalesce(item->>'company',''));
    if employee_id is not null then
      select * into worker from public.profiles where id=employee_id and account_status='approved';
      if not found then raise exception 'A selected worker no longer has an approved account'; end if;
      name_value:=worker.display_name; company_value:='John Gordon Construction';
    elsif lower(company_value) in ('john gordon construction','john gordon construction inc','jgc') then
      select * into worker from public.profiles where account_status='approved' and lower(trim(display_name))=lower(name_value);
      if found then
        employee_id:=worker.id; name_value:=worker.display_name; company_value:='John Gordon Construction';
      end if;
    end if;
    if name_value='' or company_value='' or length(name_value)>200 or length(company_value)>200 then raise exception 'Each worker needs Name and Company'; end if;
    key_value:=case when employee_id is not null then 'jsa-worker:'||employee_id::text else 'jsa-external:'||md5(lower(name_value)||'|'||lower(company_value)) end;
    insert into public.safety_acknowledgements(record_type,record_id,record_title,record_date,attendee_name,attendee_key,attendee_company,attendee_type,matched_employee_id,matched_employee_email,created_by,created_by_name,project,location,job_number,job_name)
    values('jsa',p_id,r.title,date_value,name_value,key_value,company_value,case when employee_id is null then 'external' else 'employee' end,employee_id,case when employee_id is null then null else worker.email end,auth.uid()::text,person.display_name,data_value#>>'{job_context,project}',data_value#>>'{job_context,location}',data_value#>>'{job_context,jobNumber}',data_value#>>'{job_context,jobName}');
  end loop;
  return private.jgc_jsa_worker_model(p_id);
end $$;

create function private.jgc_request_jsa_worker_signoff(p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare w public.jsa_worker_workflows;
begin
  if auth.uid() is null or not private.jgc_has_full_portal_access() then raise exception 'Approved account required' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('jsa-workers:'||p_id::text,0));
  select * into w from public.jsa_worker_workflows where record_id=p_id for update;
  if not found then raise exception 'Use the original workflow for this historical JSA'; end if;
  if w.created_by<>auth.uid() and not w.prepared_in_advance then raise exception 'Only the JSA creator can collect worker sign-offs' using errcode='42501'; end if;
  if w.valid_date<>(now() at time zone 'America/Toronto')::date then raise exception 'Worker sign-off is available only on the JSA work date'; end if;
  if not exists(select 1 from public.safety_acknowledgements where record_type='jsa' and record_id=p_id and removed_at is null) then raise exception 'Add Workers Onsite before requesting sign-off'; end if;
  update public.jsa_worker_workflows set requested_at=coalesce(requested_at,now()) where record_id=p_id;
  -- Shared creator-phone signing never sends worker account notifications.
  return private.jgc_jsa_worker_model(p_id);
end $$;

create function private.jgc_sign_jsa_worker(p_id uuid,p_revision integer,p_confirm_read boolean,p_strokes jsonb,p_width integer,p_height integer,p_acknowledgement_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare w public.jsa_worker_workflows; a public.safety_acknowledgements; stroke jsonb; point jsonb; total integer:=0;
begin
  if auth.uid() is null or not private.jgc_has_full_portal_access() then raise exception 'Sign in on the phone collecting worker signatures' using errcode='42501'; end if;
  if p_confirm_read is distinct from true then raise exception 'Each worker must confirm they have read the JSA'; end if;
  if p_strokes is null or jsonb_typeof(p_strokes)<>'array' or jsonb_array_length(p_strokes) not between 1 and 200 or octet_length(p_strokes::text)>51200 or p_width is null or p_height is null or p_width not between 200 and 2000 or p_height not between 80 and 1000 then raise exception 'Add a valid signature'; end if;
  for stroke in select value from jsonb_array_elements(p_strokes) loop
    if jsonb_typeof(stroke)<>'array' or jsonb_array_length(stroke) not between 2 and 2000 then raise exception 'Invalid signature stroke'; end if;
    total:=total+jsonb_array_length(stroke); if total>10000 then raise exception 'Signature is too large'; end if;
    for point in select value from jsonb_array_elements(stroke) loop
      if jsonb_typeof(point)<>'array' or jsonb_array_length(point)<>2 or jsonb_typeof(point->0)<>'number' or jsonb_typeof(point->1)<>'number' or (point->>0)::numeric not between 0 and 1 or (point->>1)::numeric not between 0 and 1 then raise exception 'Invalid signature point'; end if;
    end loop;
  end loop;
  perform pg_advisory_xact_lock(hashtextextended('jsa-workers:'||p_id::text,0));
  select * into w from public.jsa_worker_workflows where record_id=p_id for update;
  if not found then raise exception 'Use the original workflow for this historical JSA'; end if;
  if w.created_by<>auth.uid() and not w.prepared_in_advance then raise exception 'Only the JSA creator can collect worker signatures on their phone' using errcode='42501'; end if;
  if w.revision is distinct from p_revision then raise exception 'The JSA changed. Reopen it and review the current report' using errcode='40001'; end if;
  if w.valid_date<>(now() at time zone 'America/Toronto')::date then raise exception 'Worker sign-off is available only on the JSA work date'; end if;
  if w.requested_at is null then raise exception 'Press Complete and Worker Sign Off before collecting signatures'; end if;
  select * into a from public.safety_acknowledgements where id=p_acknowledgement_id and record_type='jsa' and record_id=p_id and removed_at is null for update;
  if not found then raise exception 'Worker not found on this JSA'; end if;
  if a.signature_signed_at is null then
    update public.safety_acknowledgements set acknowledgement_status='acknowledged_by_user',acknowledgement_method='shared_device',acknowledged_at=now(),acknowledged_by_user_id=auth.uid(),
      acknowledged_by_name=a.attendee_name,signature_strokes=p_strokes,signature_width=p_width,signature_height=p_height,signature_signed_name=a.attendee_name,signature_signed_at=now() where id=a.id;
  end if;
  update public.jsa_worker_workflows set completed_at=case when not exists(select 1 from public.safety_acknowledgements where record_type='jsa' and record_id=p_id and removed_at is null and signature_signed_at is null) then coalesce(completed_at,now()) else null end where record_id=p_id;
  return private.jgc_jsa_worker_model(p_id);
end $$;

-- Keep new reports/rosters/signatures behind RPCs. Legacy rows retain existing policies.
create function private.jgc_jsa_legacy_mutation(p_record_type text,p_id uuid) returns boolean language sql stable security definer set search_path='' as $$ select lower(coalesce(p_record_type,''))<>'jsa' or not exists(select 1 from public.jsa_worker_workflows where record_id=p_id) $$;
revoke all on function private.jgc_jsa_legacy_mutation(text,uuid) from public;
grant execute on function private.jgc_jsa_legacy_mutation(text,uuid) to anon,authenticated;
do $$ declare item record; begin
  for item in select * from pg_policies where schemaname='public' and tablename='safety_acknowledgements' and cmd in ('INSERT','UPDATE','DELETE') loop
    execute format('alter policy %I on public.safety_acknowledgements %s %s',item.policyname,
      case when item.qual is null then '' else 'using (('||item.qual||') and private.jgc_jsa_legacy_mutation(record_type,record_id))' end,
      case when item.with_check is null then '' else 'with check (('||item.with_check||') and private.jgc_jsa_legacy_mutation(record_type,record_id))' end);
  end loop;
end $$;
create function private.jgc_guard_worker_jsa_record() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if lower(new.inspection_type)='jsa' and tg_op='INSERT' and current_user in ('anon','authenticated') then raise exception 'Refresh the Portal to use the Workers Onsite JSA workflow'; end if;
  if tg_op='UPDATE' and current_user in ('anon','authenticated') and (old.form_data->>'jsa_worker_workflow_version'='2' or new.form_data->>'jsa_worker_workflow_version'='2') then raise exception 'Use the JSA worker workflow to edit this report'; end if;
  return new;
end $$;
create trigger jgc_guard_worker_jsa_record before insert or update on public.inspection_records for each row execute function private.jgc_guard_worker_jsa_record();

create function public.get_jsa_worker_workflow(p_id uuid) returns jsonb language sql security invoker set search_path='' as $$ select private.jgc_get_jsa_worker_workflow(p_id) $$;
create function public.save_worker_jsa(p_id uuid,p_revision integer,p_payload jsonb,p_workers jsonb) returns jsonb language sql security invoker set search_path='' as $$ select private.jgc_save_worker_jsa(p_id,p_revision,p_payload,p_workers) $$;
create function public.request_jsa_worker_signoff(p_id uuid) returns jsonb language sql security invoker set search_path='' as $$ select private.jgc_request_jsa_worker_signoff(p_id) $$;
create function public.sign_jsa_worker(p_id uuid,p_revision integer,p_confirm_read boolean,p_strokes jsonb,p_width integer,p_height integer,p_acknowledgement_id uuid) returns jsonb language sql security invoker set search_path='' as $$ select private.jgc_sign_jsa_worker(p_id,p_revision,p_confirm_read,p_strokes,p_width,p_height,p_acknowledgement_id) $$;
revoke all on function private.jgc_jsa_worker_state(uuid),private.jgc_jsa_worker_model(uuid),private.jgc_get_jsa_worker_workflow(uuid),private.jgc_save_worker_jsa(uuid,integer,jsonb,jsonb),private.jgc_request_jsa_worker_signoff(uuid),private.jgc_sign_jsa_worker(uuid,integer,boolean,jsonb,integer,integer,uuid),private.jgc_guard_worker_jsa_record() from public,anon,authenticated;
grant execute on function private.jgc_get_jsa_worker_workflow(uuid),private.jgc_save_worker_jsa(uuid,integer,jsonb,jsonb),private.jgc_request_jsa_worker_signoff(uuid),private.jgc_sign_jsa_worker(uuid,integer,boolean,jsonb,integer,integer,uuid) to authenticated;
revoke all on function public.get_jsa_worker_workflow(uuid),public.save_worker_jsa(uuid,integer,jsonb,jsonb),public.request_jsa_worker_signoff(uuid),public.sign_jsa_worker(uuid,integer,boolean,jsonb,integer,integer,uuid) from public,anon;
grant execute on function public.get_jsa_worker_workflow(uuid),public.save_worker_jsa(uuid,integer,jsonb,jsonb),public.request_jsa_worker_signoff(uuid),public.sign_jsa_worker(uuid,integer,boolean,jsonb,integer,integer,uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.submit_public_safety_acknowledgement(p_record_type text, p_record_id uuid, p_qr_token text, p_acknowledgement_id uuid, p_attendee_name text, p_company text, p_email text, p_note text, p_unmatched boolean DEFAULT false)
 RETURNS TABLE(success boolean, message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  base_row public.safety_acknowledgements%rowtype;
  target_row public.safety_acknowledgements%rowtype;
  clean_name text;
  clean_company text;
  clean_key text;
  method_value text;
  status_value text;
  late_value boolean;
begin
  if p_record_type='jsa' and exists(select 1 from public.jsa_worker_workflows where record_id=p_record_id) then
    return query select false, 'Worker signatures are collected on the JSA creator phone using Complete and Worker Sign Off.', null::uuid;
    return;
  end if;

  clean_name := nullif(trim(coalesce(p_attendee_name, '')), '');
  clean_company := trim(coalesce(p_company, ''));

  if p_qr_token is null or length(trim(p_qr_token)) < 16 then
    return query select false, 'Invalid acknowledgement link.';
    return;
  end if;

  select *
  into base_row
  from public.safety_acknowledgements ack
  where ack.record_type = p_record_type
    and ack.record_id = p_record_id
    and ack.qr_token = p_qr_token
    and ack.removed_at is null
  order by ack.created_at
  limit 1;

  if not found then
    return query select false, 'Invalid acknowledgement link.';
    return;
  end if;

  if coalesce(p_unmatched, false) or p_acknowledgement_id is null then
    if clean_name is null or clean_company = '' then
      return query select false, 'Enter your full name and company.';
      return;
    end if;

    clean_key := lower(regexp_replace(clean_name || '|' || clean_company, '[^a-zA-Z0-9@._-]+', '-', 'g'));
    method_value := case when base_row.record_date is not null and base_row.record_date < current_date then 'late_qr_external' else 'qr_external' end;
    status_value := case when method_value = 'late_qr_external' then 'late_acknowledgement' else 'acknowledged_by_qr' end;
    late_value := method_value = 'late_qr_external';

    insert into public.safety_acknowledgements (
      record_type,
      record_id,
      record_title,
      record_date,
      job_id,
      job_number,
      job_name,
      project,
      location,
      attendee_name,
      attendee_key,
      attendee_company,
      attendee_type,
      acknowledgement_status,
      acknowledgement_method,
      acknowledged_at,
      acknowledged_by_name,
      acknowledgement_note,
      is_late,
      unmatched_qr_entry,
      qr_token,
      created_by,
      created_by_name
    ) values (
      base_row.record_type,
      base_row.record_id,
      base_row.record_title,
      base_row.record_date,
      base_row.job_id,
      base_row.job_number,
      base_row.job_name,
      base_row.project,
      base_row.location,
      clean_name,
      clean_key,
      clean_company,
      'external',
      status_value,
      method_value,
      now(),
      clean_name,
      nullif(trim(coalesce(p_note, '')), ''),
      late_value,
      true,
      p_qr_token,
      base_row.created_by,
      base_row.created_by_name
    )
    on conflict (record_type, record_id, attendee_key)
    do update set
      attendee_company = excluded.attendee_company,
      acknowledgement_status = excluded.acknowledgement_status,
      acknowledgement_method = excluded.acknowledgement_method,
      acknowledged_at = excluded.acknowledged_at,
      acknowledged_by_name = excluded.acknowledged_by_name,
      acknowledgement_note = excluded.acknowledgement_note,
      is_late = excluded.is_late,
      unmatched_qr_entry = true,
      qr_token = excluded.qr_token,
      removed_at = null;

    return query select true, 'Acknowledgement saved.';
    return;
  end if;

  select *
  into target_row
  from public.safety_acknowledgements ack
  where ack.id = p_acknowledgement_id
    and ack.record_type = p_record_type
    and ack.record_id = p_record_id
    and ack.qr_token = p_qr_token
    and ack.removed_at is null
  limit 1;

  if not found then
    return query select false, 'That attendee could not be found.';
    return;
  end if;

  if target_row.acknowledged_at is not null then
    return query select true, 'This attendee is already acknowledged.';
    return;
  end if;

  method_value := case when target_row.record_date is not null and target_row.record_date < current_date then 'late_qr_external' else 'qr_external' end;
  status_value := case when method_value = 'late_qr_external' then 'late_acknowledgement' else 'acknowledged_by_qr' end;
  late_value := method_value = 'late_qr_external';

  update public.safety_acknowledgements
  set
    attendee_company = coalesce(nullif(clean_company, ''), attendee_company),
    matched_employee_email = coalesce(nullif(trim(coalesce(p_email, '')), ''), matched_employee_email),
    acknowledgement_status = status_value,
    acknowledgement_method = method_value,
    acknowledged_at = now(),
    acknowledged_by_name = attendee_name,
    acknowledgement_note = nullif(trim(coalesce(p_note, '')), ''),
    is_late = late_value
  where id = target_row.id;

  return query select true, 'Acknowledgement saved.';
end;
$function$
;

CREATE OR REPLACE FUNCTION public.submit_public_safety_signature(p_record_type text, p_record_id uuid, p_qr_token text, p_acknowledgement_id uuid, p_attendee_name text, p_company text, p_email text, p_note text, p_unmatched boolean, p_signature_strokes jsonb, p_signature_width integer, p_signature_height integer, p_signature_source text DEFAULT 'qr'::text)
 RETURNS TABLE(success boolean, message text, acknowledgement_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  base_row public.safety_acknowledgements%rowtype;
  target_row public.safety_acknowledgements%rowtype;
  clean_name text;
  clean_company text;
  clean_email text;
  clean_key text;
  clean_source text;
  method_value text;
  status_value text;
  late_value boolean;
  saved_id uuid;
begin
  if p_record_type='jsa' and exists(select 1 from public.jsa_worker_workflows where record_id=p_record_id) then
    return query select false, 'Worker signatures are collected on the JSA creator phone using Complete and Worker Sign Off.', null::uuid;
    return;
  end if;

  clean_name := nullif(btrim(coalesce(p_attendee_name, '')), '');
  clean_company := btrim(coalesce(p_company, ''));
  clean_email := nullif(btrim(coalesce(p_email, '')), '');
  clean_source := lower(btrim(coalesce(p_signature_source, 'qr')));

  if p_record_type not in ('jsa', 'toolbox_talk')
     or p_qr_token is null
     or length(btrim(p_qr_token)) < 16 then
    return query select false, 'Invalid acknowledgement link.', null::uuid;
    return;
  end if;

  if clean_source not in ('qr', 'shared_device', 'user_portal') then
    return query select false, 'Invalid signature source.', null::uuid;
    return;
  end if;

  if clean_name is null then
    return query select false, 'Enter the printed name of the person signing.', null::uuid;
    return;
  end if;

  if p_signature_strokes is null
     or jsonb_typeof(p_signature_strokes) <> 'array'
     or jsonb_array_length(p_signature_strokes) < 1
     or jsonb_array_length(p_signature_strokes) > 200
     or octet_length(p_signature_strokes::text) > 51200
     or p_signature_width not between 200 and 2000
     or p_signature_height not between 80 and 1000 then
    return query select false, 'Add a valid signature in the signature box.', null::uuid;
    return;
  end if;

  select *
  into base_row
  from public.safety_acknowledgements ack
  where ack.record_type = p_record_type
    and ack.record_id = p_record_id
    and ack.qr_token = p_qr_token
    and ack.removed_at is null
  order by ack.created_at
  limit 1;

  if not found then
    return query select false, 'Invalid acknowledgement link.', null::uuid;
    return;
  end if;

  late_value := base_row.record_date is not null and base_row.record_date < current_date;
  method_value := case
    when clean_source = 'shared_device' and late_value then 'late_shared_device'
    when clean_source = 'shared_device' then 'shared_device'
    when clean_source = 'user_portal' and late_value then 'late_user_portal'
    when clean_source = 'user_portal' then 'user_portal'
    when late_value then 'late_qr_external'
    else 'qr_external'
  end;
  status_value := case
    when late_value then 'late_acknowledgement'
    when clean_source = 'qr' then 'acknowledged_by_qr'
    else 'acknowledged_by_user'
  end;

  if coalesce(p_unmatched, false) or p_acknowledgement_id is null then
    if clean_company = '' then
      return query select false, 'Enter your company.', null::uuid;
      return;
    end if;

    clean_key := lower(regexp_replace(clean_name || '|' || clean_company, '[^a-zA-Z0-9@._-]+', '-', 'g'));

    insert into public.safety_acknowledgements as existing (
      record_type, record_id, record_title, record_date, job_id, job_number,
      job_name, project, location, attendee_name, attendee_key,
      attendee_company, attendee_type, matched_employee_email,
      acknowledgement_status, acknowledgement_method, acknowledged_at,
      acknowledged_by_name, acknowledgement_note, is_late,
      unmatched_qr_entry, qr_token, created_by, created_by_name,
      signature_strokes, signature_width, signature_height,
      signature_version, signature_signed_name, signature_signed_at
    ) values (
      base_row.record_type, base_row.record_id, base_row.record_title,
      base_row.record_date, base_row.job_id, base_row.job_number,
      base_row.job_name, base_row.project, base_row.location, clean_name,
      clean_key, clean_company, 'external', clean_email, status_value,
      method_value, now(), clean_name, nullif(btrim(coalesce(p_note, '')), ''),
      late_value, true, p_qr_token, base_row.created_by,
      base_row.created_by_name, p_signature_strokes, p_signature_width,
      p_signature_height, 1, clean_name, now()
    )
    on conflict (record_type, record_id, attendee_key)
    do update set
      attendee_company = excluded.attendee_company,
      matched_employee_email = coalesce(excluded.matched_employee_email, existing.matched_employee_email),
      acknowledgement_status = excluded.acknowledgement_status,
      acknowledgement_method = excluded.acknowledgement_method,
      acknowledged_at = excluded.acknowledged_at,
      acknowledged_by_name = excluded.acknowledged_by_name,
      acknowledgement_note = excluded.acknowledgement_note,
      is_late = excluded.is_late,
      unmatched_qr_entry = true,
      qr_token = excluded.qr_token,
      removed_at = null,
      signature_strokes = excluded.signature_strokes,
      signature_width = excluded.signature_width,
      signature_height = excluded.signature_height,
      signature_version = excluded.signature_version,
      signature_signed_name = excluded.signature_signed_name,
      signature_signed_at = excluded.signature_signed_at
    returning id into saved_id;

    return query select true, 'Signature saved.', saved_id;
    return;
  end if;

  select *
  into target_row
  from public.safety_acknowledgements ack
  where ack.id = p_acknowledgement_id
    and ack.record_type = p_record_type
    and ack.record_id = p_record_id
    and ack.qr_token = p_qr_token
    and ack.removed_at is null
  for update;

  if not found then
    return query select false, 'That attendee could not be found.', null::uuid;
    return;
  end if;

  if target_row.signature_signed_at is not null then
    return query select true, 'This attendee has already signed.', target_row.id;
    return;
  end if;

  update public.safety_acknowledgements
  set
    attendee_company = coalesce(nullif(clean_company, ''), attendee_company),
    matched_employee_email = coalesce(clean_email, matched_employee_email),
    acknowledgement_status = status_value,
    acknowledgement_method = method_value,
    acknowledged_at = now(),
    acknowledged_by_name = clean_name,
    acknowledgement_note = nullif(btrim(coalesce(p_note, '')), ''),
    is_late = late_value,
    signature_strokes = p_signature_strokes,
    signature_width = p_signature_width,
    signature_height = p_signature_height,
    signature_version = 1,
    signature_signed_name = clean_name,
    signature_signed_at = now()
  where id = target_row.id
  returning id into saved_id;

  return query select true, 'Signature saved.', saved_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.submit_current_user_safety_acknowledgement(p_record_type text, p_record_id uuid, p_mode text DEFAULT 'account'::text, p_signature_strokes jsonb DEFAULT NULL::jsonb, p_signature_width integer DEFAULT NULL::integer, p_signature_height integer DEFAULT NULL::integer)
 RETURNS TABLE(success boolean, message text, acknowledgement_id uuid, already_acknowledged boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_record public.inspection_records%rowtype;
  v_existing public.safety_acknowledgements%rowtype;
  v_template public.safety_acknowledgements%rowtype;
  v_ack_id uuid;
  v_record_type text := lower(btrim(coalesce(p_record_type, '')));
  v_mode text := lower(btrim(coalesce(p_mode, 'account')));
  v_display_name text;
  v_email text;
  v_company constant text := 'John Gordon Construction';
  v_attendee_key text;
  v_status text;
  v_method text;
  v_project text := '';
  v_location text := '';
  v_job_number text := '';
  v_job_name text := '';
  v_record_title text := '';
  v_record_date date;
  v_qr_token text;
  v_is_new boolean := false;
begin
  if p_record_type='jsa' and exists(select 1 from public.jsa_worker_workflows where record_id=p_record_id) then
    return query select false, 'Worker signatures are collected on the JSA creator phone using Complete and Worker Sign Off.', null::uuid, false;
    return;
  end if;

  if v_user_id is null then
    return query select false, 'Sign in before acknowledging this safety record.', null::uuid, false;
    return;
  end if;

  select p.*
  into v_profile
  from public.profiles p
  where p.id = v_user_id;

  if not found or v_profile.account_status <> 'approved' then
    return query select false, 'Your account is not approved for onsite safety acknowledgements.', null::uuid, false;
    return;
  end if;

  if v_record_type not in ('jsa', 'toolbox_talk') then
    return query select false, 'This safety record type is not supported.', null::uuid, false;
    return;
  end if;

  if v_mode not in ('account', 'signature') then
    return query select false, 'Choose account acknowledgement or signature.', null::uuid, false;
    return;
  end if;

  if v_mode = 'signature' then
    if p_signature_strokes is null
       or jsonb_typeof(p_signature_strokes) <> 'array'
       or jsonb_array_length(p_signature_strokes) < 1
       or jsonb_array_length(p_signature_strokes) > 200
       or octet_length(p_signature_strokes::text) > 51200
       or coalesce(p_signature_width, 0) not between 200 and 2000
       or coalesce(p_signature_height, 0) not between 80 and 1000 then
      return query select false, 'Please provide a complete signature before submitting.', null::uuid, false;
      return;
    end if;
  end if;

  v_email := lower(btrim(coalesce(v_profile.email, '')));
  v_display_name := nullif(btrim(coalesce(v_profile.display_name, '')), '');
  if v_display_name is null then
    v_display_name := split_part(v_email, '@', 1);
  end if;
  if nullif(v_display_name, '') is null then
    return query select false, 'Your account name is missing. Ask an admin to update your profile.', null::uuid, false;
    return;
  end if;

  v_attendee_key := regexp_replace(lower(coalesce(nullif(v_email, ''), v_display_name) || '|' || v_company), '[^a-z0-9@._|+-]+', '-', 'g');
  v_attendee_key := btrim(v_attendee_key, '-');

  select a.*
  into v_existing
  from public.safety_acknowledgements a
  where a.record_type = v_record_type
    and a.record_id = p_record_id
    and a.removed_at is null
    and (
      a.matched_employee_id = v_user_id
      or (v_email <> '' and lower(coalesce(a.matched_employee_email, '')) = v_email)
      or a.attendee_key = v_attendee_key
    )
  order by a.created_at
  limit 1;

  if found and v_existing.acknowledged_at is not null then
    return query select true, 'You already acknowledged this safety record.', v_existing.id, true;
    return;
  end if;

  select a.*
  into v_template
  from public.safety_acknowledgements a
  where a.record_type = v_record_type
    and a.record_id = p_record_id
    and a.removed_at is null
  order by a.created_at
  limit 1;

  if found then
    v_record_title := coalesce(v_template.record_title, '');
    v_record_date := v_template.record_date;
    v_project := coalesce(v_template.project, '');
    v_location := coalesce(v_template.location, '');
    v_job_number := coalesce(v_template.job_number, '');
    v_job_name := coalesce(v_template.job_name, '');
    v_qr_token := v_template.qr_token;
  else
    select ir.*
    into v_record
    from public.inspection_records ir
    where ir.id = p_record_id
      and (
        (v_record_type = 'jsa' and lower(coalesce(ir.inspection_type, '')) = 'jsa')
        or (v_record_type = 'toolbox_talk' and lower(coalesce(ir.inspection_type, '')) in ('toolbox talk', 'toolbox_talk'))
      );

    if not found then
      return query select false, 'This safety record could not be found.', null::uuid, false;
      return;
    end if;

    v_record_title := coalesce(v_record.title, initcap(replace(v_record_type, '_', ' ')));
    v_record_date := v_record.inspection_date;
    v_project := coalesce(v_record.form_data->'job_context'->>'project', '');
    v_location := coalesce(v_record.form_data->'job_context'->>'location', '');
    v_job_number := coalesce(v_record.form_data->'job_context'->>'jobNumber', '');
    v_job_name := coalesce(v_record.form_data->'job_context'->>'jobName', '');

    if v_project = '' then
      select coalesce(f.value->>'value', '')
      into v_project
      from jsonb_array_elements(coalesce(v_record.form_data->'fields', '[]'::jsonb)) with ordinality as f(value, ord)
      where lower(coalesce(f.value->>'label', '')) in ('project', 'project / job', 'job')
        and nullif(btrim(coalesce(f.value->>'value', '')), '') is not null
      order by f.ord
      limit 1;
    end if;

    if v_location = '' then
      select coalesce(f.value->>'value', '')
      into v_location
      from jsonb_array_elements(coalesce(v_record.form_data->'fields', '[]'::jsonb)) with ordinality as f(value, ord)
      where lower(coalesce(f.value->>'label', '')) = 'location'
        and nullif(btrim(coalesce(f.value->>'value', '')), '') is not null
      order by f.ord
      limit 1;
    end if;

    v_qr_token := encode(extensions.gen_random_bytes(24), 'hex');
  end if;

  v_is_new := v_existing.id is null;
  v_status := case when v_is_new then 'late_acknowledgement' else 'acknowledged_by_user' end;
  v_method := case
    when v_mode = 'signature' and v_is_new then 'late_shared_device'
    when v_mode = 'signature' then 'shared_device'
    when v_is_new then 'late_user_portal'
    else 'user_portal'
  end;

  if v_existing.id is null then
    insert into public.safety_acknowledgements (
      record_type,
      record_id,
      record_title,
      record_date,
      job_id,
      job_number,
      job_name,
      project,
      location,
      attendee_name,
      attendee_key,
      attendee_company,
      attendee_type,
      matched_employee_id,
      matched_employee_email,
      acknowledgement_status,
      acknowledgement_method,
      acknowledged_at,
      acknowledged_by_user_id,
      acknowledged_by_name,
      is_late,
      unmatched_qr_entry,
      qr_token,
      created_by,
      created_by_name,
      signature_strokes,
      signature_width,
      signature_height,
      signature_signed_name,
      signature_signed_at
    ) values (
      v_record_type,
      p_record_id,
      v_record_title,
      v_record_date,
      v_template.job_id,
      nullif(v_job_number, ''),
      nullif(v_job_name, ''),
      nullif(v_project, ''),
      nullif(v_location, ''),
      v_display_name,
      v_attendee_key,
      v_company,
      'employee',
      v_user_id,
      nullif(v_email, ''),
      v_status,
      v_method,
      now(),
      v_user_id,
      v_display_name,
      true,
      false,
      v_qr_token,
      coalesce(v_template.created_by, v_record.worker_name, v_display_name),
      coalesce(v_template.created_by_name, v_record.worker_display_name, v_display_name),
      case when v_mode = 'signature' then p_signature_strokes else null end,
      case when v_mode = 'signature' then p_signature_width else null end,
      case when v_mode = 'signature' then p_signature_height else null end,
      case when v_mode = 'signature' then v_display_name else null end,
      case when v_mode = 'signature' then now() else null end
    )
    on conflict (record_type, record_id, attendee_key)
    do update set
      attendee_name = excluded.attendee_name,
      attendee_company = excluded.attendee_company,
      attendee_type = 'employee',
      matched_employee_id = excluded.matched_employee_id,
      matched_employee_email = excluded.matched_employee_email,
      acknowledgement_status = excluded.acknowledgement_status,
      acknowledgement_method = excluded.acknowledgement_method,
      acknowledged_at = excluded.acknowledged_at,
      acknowledged_by_user_id = excluded.acknowledged_by_user_id,
      acknowledged_by_name = excluded.acknowledged_by_name,
      is_late = true,
      unmatched_qr_entry = false,
      removed_at = null,
      signature_strokes = excluded.signature_strokes,
      signature_width = excluded.signature_width,
      signature_height = excluded.signature_height,
      signature_signed_name = excluded.signature_signed_name,
      signature_signed_at = excluded.signature_signed_at,
      updated_at = now()
    returning id into v_ack_id;
  else
    update public.safety_acknowledgements
    set attendee_name = v_display_name,
        attendee_company = v_company,
        attendee_type = 'employee',
        matched_employee_id = v_user_id,
        matched_employee_email = nullif(v_email, ''),
        acknowledgement_status = v_status,
        acknowledgement_method = v_method,
        acknowledged_at = now(),
        acknowledged_by_user_id = v_user_id,
        acknowledged_by_name = v_display_name,
        unmatched_qr_entry = false,
        removed_at = null,
        signature_strokes = case when v_mode = 'signature' then p_signature_strokes else null end,
        signature_width = case when v_mode = 'signature' then p_signature_width else null end,
        signature_height = case when v_mode = 'signature' then p_signature_height else null end,
        signature_signed_name = case when v_mode = 'signature' then v_display_name else null end,
        signature_signed_at = case when v_mode = 'signature' then now() else null end,
        updated_at = now()
    where id = v_existing.id
    returning id into v_ack_id;
  end if;

  return query select true,
    case when v_mode = 'signature' then 'Signature saved.' else 'Acknowledgement saved to your account.' end,
    v_ack_id,
    false;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.jgc_job_board_jsa_context(p_token text, p_visit_token uuid, p_document_id uuid)
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
end $function$
;

CREATE OR REPLACE FUNCTION private.jgc_sign_job_board_jsa(p_token text, p_visit_token uuid, p_document_id uuid, p_confirm_read boolean, p_reviewed_version timestamp with time zone, p_signature_strokes jsonb, p_signature_width integer, p_signature_height integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare context_value jsonb; d public.job_board_documents; b public.job_boards; actor jsonb; key_value text; record_id_value uuid; ack public.safety_acknowledgements; stroke jsonb; point jsonb; points integer:=0; staff boolean; worker_result jsonb;
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
  if exists(select 1 from public.jsa_worker_workflows where record_id=record_id_value) then
    raise exception 'Worker signatures for this JSA are collected on the creator phone. Open the JSA with its creator.';
  end if;
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
end $function$
;

-- Expand only the preparation mode check; historical modes remain valid.
do $$ declare c record; begin
  for c in select conname from pg_constraint where conrelid='public.jsa_preparations'::regclass and contype='c' and pg_get_constraintdef(oid) like 'CHECK ((acknowledgement_mode = ANY%' loop
    execute format('alter table public.jsa_preparations drop constraint %I',c.conname);
  end loop;
end $$;
alter table public.jsa_preparations add constraint jsa_preparations_worker_mode_check check (acknowledgement_mode in ('qr','employees','creator','workers'));
create or replace function private.jgc_activate_prepared_jsa(p_id uuid,p_revision integer,p_mode text,p_attendees jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare item public.jsa_preparations; model jsonb; workers jsonb;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Admin access required' using errcode='42501'; end if;
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
end $$;
