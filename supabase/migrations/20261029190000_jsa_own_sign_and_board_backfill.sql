create or replace function private.jgc_sign_jsa_worker(p_id uuid,p_revision integer,p_confirm_read boolean,p_strokes jsonb,p_width integer,p_height integer,p_acknowledgement_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
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
  if w.created_by<>auth.uid() and not w.prepared_in_advance and not exists(select 1 from public.safety_acknowledgements where id=p_acknowledgement_id and record_type='jsa' and record_id=p_id and removed_at is null and matched_employee_id=auth.uid()) then raise exception 'Only the JSA creator can collect worker signatures on their phone' using errcode='42501'; end if;
  if w.revision is distinct from p_revision then raise exception 'The JSA changed. Reopen it and review the current report' using errcode='40001'; end if;
  if w.valid_date<>(now() at time zone 'America/Toronto')::date then raise exception 'Worker sign-off is available only on the JSA work date'; end if;
  if w.requested_at is null then raise exception 'Press Complete and Worker Sign Off before collecting signatures'; end if;
  select * into a from public.safety_acknowledgements where id=p_acknowledgement_id and record_type='jsa' and record_id=p_id and removed_at is null for update;
  if not found then raise exception 'Worker not found on this JSA'; end if;
  if a.signature_signed_at is null then
    update public.safety_acknowledgements set acknowledgement_status='acknowledged_by_user',acknowledgement_method=case when a.matched_employee_id=auth.uid() then 'user_portal' else 'shared_device' end,acknowledged_at=now(),acknowledged_by_user_id=auth.uid(),
      acknowledged_by_name=a.attendee_name,signature_strokes=p_strokes,signature_width=p_width,signature_height=p_height,signature_signed_name=a.attendee_name,signature_signed_at=now() where id=a.id;
  end if;
  update public.jsa_worker_workflows set completed_at=case when not exists(select 1 from public.safety_acknowledgements where record_type='jsa' and record_id=p_id and removed_at is null and signature_signed_at is null) then coalesce(completed_at,now()) else null end where record_id=p_id;
  return private.jgc_jsa_worker_model(p_id);
end $$;


-- A board can be created after its reports. Attach trusted job-matched JSAs at board creation/enabling.
create or replace function private.jgc_board_attach_existing_jsas() returns trigger
language plpgsql security definer set search_path='' as $$
declare r public.inspection_records;
begin
 if not new.enabled or auth.uid() is null or not private.jgc_job_board_admin() then return new; end if;
 for r in select i.* from public.inspection_records i where lower(i.inspection_type)='jsa'
   and private.jgc_job_board_source_matches(to_jsonb(i),new.id,new.job_number)
   and not exists(select 1 from public.job_board_documents d where d.board_id=new.id and d.source_type='inspection_records' and d.source_id=i.id)
 loop perform private.jgc_attach_job_board_report_by_id(new.id,'inspection_records',r.id); end loop;
 return new;
end $$;
revoke all on function private.jgc_board_attach_existing_jsas() from public,anon,authenticated;
create trigger jgc_board_attach_existing_jsas after insert or update of enabled on public.job_boards
for each row execute function private.jgc_board_attach_existing_jsas();
-- Retry attachment when an offline or saved JSA gains job information later.
create trigger jgc_board_attach_updated_jsa after update of form_data on public.inspection_records
for each row when (lower(new.inspection_type)='jsa') execute function private.jgc_job_board_auto_attach_staff_form();
