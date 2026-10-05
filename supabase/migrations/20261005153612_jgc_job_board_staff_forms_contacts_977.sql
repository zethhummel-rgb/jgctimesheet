-- Release 977: requested staff form publication and signed-in company contacts.
begin;
create or replace function private.jgc_attach_job_board_report_core(p_board_id uuid,p_source_type text,p_source_id uuid,p_actor jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.job_boards; d public.job_board_documents; p public.profiles; source_value jsonb; owner_value text; date_value date; category_value text; title_value text; doc uuid; admin_value boolean;
begin
  if not private.jgc_job_board_staff() then raise exception 'Approved staff access required' using errcode='42501'; end if;
  select * into b from public.job_boards where id=p_board_id and enabled;
  if b.id is null then raise exception 'Job Board unavailable'; end if;
  admin_value := private.jgc_job_board_admin();
  if p_source_type is null or p_source_type not in ('inspection_records','toolbox_talk_reports','daily_site_reports','incident_reports','accident_reports','employee_injury_reports','policies') or p_source_id is null then raise exception 'Unsupported saved report'; end if;
  if p_source_type='policies' and not admin_value then raise exception 'Administrator access required for company documents' using errcode='42501'; end if;
  execute format('select to_jsonb(r) from public.%I r where id=$1',p_source_type) into source_value using p_source_id;
  if source_value is null then raise exception 'Saved report unavailable'; end if;
  select * into p from public.profiles where id=auth.uid();
  owner_value := case p_source_type when 'inspection_records' then source_value->>'worker_name' when 'toolbox_talk_reports' then source_value->>'submitted_by_worker' when 'daily_site_reports' then source_value->>'worker_name' when 'incident_reports' then source_value->>'reported_by_worker' else source_value->>'created_by_worker' end;
  if not admin_value and lower(trim(coalesce(owner_value,''))) not in (lower(trim(coalesce(nullif(p.worker_key,''),p.id::text))),p.id::text) then raise exception 'Only your submitted reports can be attached' using errcode='42501'; end if;
  if p_source_type<>'policies' and not private.jgc_job_board_source_matches(source_value,b.id,b.job_number) then raise exception 'The saved report does not belong to this job'; end if;
  if p_source_type='policies' then
    if source_value->>'is_active' is distinct from 'true' or coalesce(length(source_value->>'file_path'),0)=0 then raise exception 'Select an active policy PDF'; end if;
    category_value := 'jgc-policy'; title_value := source_value->>'title'; date_value := (now() at time zone 'America/Toronto')::date;
    source_value := jsonb_build_object('id',p_source_id,'title',title_value,'description',coalesce(source_value->>'description',''),'file_path',source_value->>'file_path','file_name',source_value->>'file_name','file_type','application/pdf');
  elsif p_source_type='inspection_records' then
    category_value := case when lower(source_value->>'inspection_type')='jsa' then 'jsa' when lower(source_value->>'inspection_type') like '%permit%' then 'permit' else 'inspection' end;
    title_value := coalesce(nullif(source_value->>'title',''),source_value->>'inspection_type'); date_value := (source_value->>'inspection_date')::date;
  elsif p_source_type='toolbox_talk_reports' then
    category_value := 'toolbox-talk'; title_value := coalesce(nullif(source_value->>'talk_title',''),'Toolbox talk'); date_value := (source_value->>'report_date')::date;
  elsif p_source_type='daily_site_reports' then
    category_value := 'daily-report'; title_value := 'Daily site report'; date_value := (source_value->>'report_date')::date;
  else
    category_value := 'accident-incident'; title_value := case p_source_type when 'incident_reports' then coalesce(nullif(source_value->>'incident_type',''),'Incident report') when 'accident_reports' then 'Supervisor accident report' else 'Employee injury report' end;
    date_value := coalesce(nullif(source_value->>'report_date','')::date,nullif(source_value->>'accident_date','')::date);
  end if;
  if date_value is null or coalesce(length(trim(title_value)),0)=0 then raise exception 'The saved report is missing its date or title'; end if;
  perform pg_advisory_xact_lock(hashtextextended('job-board-source:'||b.id::text||':'||p_source_type||':'||p_source_id::text,0));
  select * into d from public.job_board_documents where board_id=b.id and source_type=p_source_type and source_id=p_source_id;
  if d.id is not null then return jsonb_build_object('id',d.id,'status',d.status,'already_attached',true); end if;
  doc := gen_random_uuid();
  insert into public.job_board_documents(id,board_id,category,title,report_date,file_name,mime_type,file_size,object_path,notes,status,visibility,source_type,source_id,source_payload,created_by)
  values(doc,b.id,category_value,left(trim(title_value),200),date_value,'JGC-'||category_value||'-'||date_value::text||'.pdf','application/pdf',1,b.id::text||'/'||doc::text||'/original.pdf','',case when p_source_type='policies' then 'pending' else 'published' end,case when category_value='accident-incident' or p_source_type='policies' then 'restricted' else 'public' end,p_source_type,p_source_id,private.jgc_job_board_clean_snapshot(source_value),auth.uid());
  perform private.jgc_job_board_append(b.id,'upload',doc,p_actor);
  return jsonb_build_object('id',doc,'status',case when p_source_type='policies' then 'pending' else 'published' end,'already_attached',false);
end $$;


-- Existing uploaded paper files and archived documents keep their office-controlled status.
-- New saved staff forms are attached in the same transaction, including equipment QR and offline-sync inserts.
create function private.jgc_job_board_auto_attach_staff_form() returns trigger
language plpgsql security definer set search_path='' as $$
declare b public.job_boards; p public.profiles; source_value jsonb; owner_value text;
begin
  if auth.uid() is null or not private.jgc_job_board_staff() then return new; end if;
  source_value := to_jsonb(new);
  select * into p from public.profiles where id=auth.uid();
  owner_value := case tg_table_name when 'inspection_records' then source_value->>'worker_name' when 'toolbox_talk_reports' then source_value->>'submitted_by_worker' when 'daily_site_reports' then source_value->>'worker_name' when 'incident_reports' then source_value->>'reported_by_worker' else source_value->>'created_by_worker' end;
  if lower(trim(coalesce(owner_value,''))) not in (lower(trim(coalesce(nullif(p.worker_key,''),p.id::text))),p.id::text) then return new; end if;
  if tg_table_name='toolbox_talk_reports' and coalesce((source_value->>'is_duplicate')::boolean,false) then return new; end if;
  for b in select * from public.job_boards j where j.enabled and private.jgc_job_board_source_matches(source_value,j.id,j.job_number) loop
    perform private.jgc_attach_job_board_report_by_id(b.id,tg_table_name,new.id);
  end loop;
  return new;
end $$;
revoke all on function private.jgc_job_board_auto_attach_staff_form() from public,anon,authenticated;
do $$ declare t text; begin
  foreach t in array array['inspection_records','toolbox_talk_reports','daily_site_reports','incident_reports','accident_reports','employee_injury_reports'] loop
    execute format('create trigger jgc_job_board_auto_attach_staff_form after insert on public.%I for each row execute function private.jgc_job_board_auto_attach_staff_form()',t);
  end loop;
end $$;

create function private.jgc_get_job_board_contacts(p_token text,p_visit_token uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare b public.job_boards; result jsonb;
begin
  select * into b from public.job_boards where token=p_token and enabled;
  if b.id is null then raise exception 'Job Board unavailable' using errcode='42501'; end if;
  perform private.jgc_job_board_actor(b.id,p_visit_token);
  select coalesce(jsonb_agg(jsonb_build_object('name',c.name,'role',c.role,'phone',c.phone,'email',c.email) order by c.sort_order,c.name,c.id),'[]'::jsonb)
  into result from public.contacts c where c.is_active;
  return result;
end $$;
create function public.get_job_board_contacts(p_token text,p_visit_token uuid default null) returns jsonb
language sql stable security invoker set search_path='' as $$ select private.jgc_get_job_board_contacts(p_token,p_visit_token) $$;
revoke all on function private.jgc_get_job_board_contacts(text,uuid),public.get_job_board_contacts(text,uuid) from public,anon,authenticated;
grant execute on function private.jgc_get_job_board_contacts(text,uuid),public.get_job_board_contacts(text,uuid) to anon,authenticated;

commit;
