-- Prepared JSAs have no inspection or acknowledgement rows until activation.
create table public.jsa_preparations (
  id uuid primary key,
  revision integer not null default 1 check (revision > 0),
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 1048576),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  activated_at timestamptz,
  activated_by uuid references auth.users(id),
  record_id uuid unique references public.inspection_records(id),
  acknowledgement_mode text check (acknowledgement_mode in ('qr','employees','creator')),
  check ((activated_at is null and record_id is null and activated_by is null and acknowledgement_mode is null)
    or (activated_at is not null and record_id is not null and activated_by is not null and acknowledgement_mode is not null))
);
alter table public.jsa_preparations enable row level security;
revoke all on public.jsa_preparations from public, anon, authenticated;
grant select on public.jsa_preparations to authenticated;
create policy "Approved admins read prepared JSAs" on public.jsa_preparations for select to authenticated using ((select public.is_admin()));
create index jsa_preparations_updated_at_idx on public.jsa_preparations(updated_at desc);
create index jsa_preparations_created_by_idx on public.jsa_preparations(created_by);
create index jsa_preparations_activated_by_idx on public.jsa_preparations(activated_by);

-- Restricted mutations protect revision checks and one-time activation from
-- direct REST updates. Existing inspection/acknowledgement policies are unchanged.
create function private.jgc_save_prepared_jsa(p_id uuid, p_revision integer, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare item public.jsa_preparations;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Admin access required' using errcode='42501'; end if;
  if p_id is null or p_payload is null or jsonb_typeof(p_payload) <> 'object'
    or jsonb_typeof(p_payload->'record') is distinct from 'object'
    or jsonb_typeof(p_payload#>'{record,form_data,fields}') is distinct from 'array'
    or jsonb_typeof(p_payload#>'{record,form_data,rows}') is distinct from 'array'
    or octet_length(p_payload::text) > 1048576 then raise exception 'Invalid JSA draft'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_id::text, 0));
  select * into item from public.jsa_preparations where id=p_id for update;
  if found then
    if item.activated_at is not null then raise exception 'This JSA is already active'; end if;
    if item.payload=p_payload then return to_jsonb(item); end if; -- uncertain-save retry
    if item.revision is distinct from p_revision then raise exception 'This draft changed elsewhere. Reopen it before saving.' using errcode='40001'; end if;
    update public.jsa_preparations set payload=p_payload, revision=revision+1,updated_at=now() where id=p_id returning * into item;
  else
    if p_revision is distinct from 0 then raise exception 'Draft not found'; end if;
    insert into public.jsa_preparations(id,payload,created_by) values(p_id,p_payload,auth.uid()) returning * into item;
  end if;
  return to_jsonb(item);
end $$;

create function private.jgc_activate_prepared_jsa(p_id uuid, p_revision integer, p_mode text, p_attendees jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare item public.jsa_preparations; rec public.inspection_records; person public.profiles; source jsonb; entry jsonb; token text;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Admin access required' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_id::text, 0));
  select * into item from public.jsa_preparations where id=p_id for update;
  if not found then raise exception 'Draft not found'; end if;
  if item.activated_at is null then
    if item.revision is distinct from p_revision then raise exception 'This draft changed elsewhere. Reopen it before activation.' using errcode='40001'; end if;
    if p_mode is null or p_mode not in ('qr','employees','creator') then raise exception 'Choose a sign-off method'; end if;
    source := item.payload->'record';
    if nullif(source->>'inspection_date','') is null
      or not exists(select 1 from jsonb_array_elements(source#>'{form_data,fields}') f where f->>'label'='Project / Job' and length(trim(f->>'value'))>0)
      or jsonb_array_length(source#>'{form_data,rows}')=0
      or exists(select 1 from jsonb_array_elements(source#>'{form_data,rows}') r where coalesce(length(trim(r#>>'{cells,0}')),0)=0 or coalesce(length(trim(r#>>'{cells,1}')),0)=0 or coalesce(length(trim(r#>>'{cells,2}')),0)=0)
      then raise exception 'Project, date, task, hazards and controls are required before activation'; end if;
    if p_attendees is null or jsonb_typeof(p_attendees)<>'array' or jsonb_array_length(p_attendees) not between 1 and 500 then raise exception 'Crew information is required'; end if;
    select * into person from public.profiles where id=auth.uid();
    token := gen_random_uuid()::text || gen_random_uuid()::text;
    insert into public.inspection_records(id,worker_name,worker_display_name,inspection_type,inspection_date,title,summary,form_data,email_body)
    values(item.id,coalesce(nullif(person.worker_key,''),person.id::text),coalesce(nullif(person.display_name,''),person.email),'JSA',(source->>'inspection_date')::date,
      'JSA - '||(source->>'inspection_date'),coalesce(source->'summary','{}'::jsonb),
      (source->'form_data')||jsonb_build_object('prepared_jsa_id',item.id,'prepared_at',item.created_at,'activated_at',now()),source->>'email_body') returning * into rec;
    for entry in select value from jsonb_array_elements(p_attendees) loop
      if coalesce(length(trim(entry->>'attendee_name')),0)=0 or coalesce(length(trim(entry->>'attendee_key')),0)=0 then raise exception 'Invalid crew member'; end if;
      insert into public.safety_acknowledgements(record_type,record_id,record_title,record_date,project,location,job_number,job_name,attendee_name,attendee_key,attendee_company,attendee_type,matched_employee_id,matched_employee_email,qr_token,created_by,created_by_name)
      values('jsa',rec.id,rec.title,rec.inspection_date,source#>>'{form_data,job_context,project}',source#>>'{form_data,job_context,location}',source#>>'{form_data,job_context,jobNumber}',source#>>'{form_data,job_context,jobName}',entry->>'attendee_name',entry->>'attendee_key',coalesce(entry->>'attendee_company',''),coalesce(entry->>'attendee_type','unknown'),nullif(entry->>'matched_employee_id','')::uuid,coalesce(entry->>'matched_employee_email',''),token,auth.uid()::text,rec.worker_display_name);
    end loop;
    update public.jsa_preparations set activated_at=now(),activated_by=auth.uid(),record_id=rec.id,acknowledgement_mode=p_mode,updated_at=now() where id=item.id returning * into item;
  else
    select * into rec from public.inspection_records where id=item.record_id;
  end if;
  return jsonb_build_object('draft',to_jsonb(item),'record',to_jsonb(rec),'acknowledgements',coalesce((select jsonb_agg(a order by a.created_at) from public.safety_acknowledgements a where record_type='jsa' and record_id=item.record_id and removed_at is null),'[]'::jsonb));
end $$;

revoke all on function private.jgc_save_prepared_jsa(uuid,integer,jsonb) from public, anon;
revoke all on function private.jgc_activate_prepared_jsa(uuid,integer,text,jsonb) from public, anon;
grant execute on function private.jgc_save_prepared_jsa(uuid,integer,jsonb),private.jgc_activate_prepared_jsa(uuid,integer,text,jsonb) to authenticated;
create function public.save_prepared_jsa(p_id uuid,p_revision integer,p_payload jsonb) returns jsonb language sql security invoker set search_path='' as $$ select private.jgc_save_prepared_jsa(p_id,p_revision,p_payload) $$;
create function public.activate_prepared_jsa(p_id uuid,p_revision integer,p_mode text,p_attendees jsonb) returns jsonb language sql security invoker set search_path='' as $$ select private.jgc_activate_prepared_jsa(p_id,p_revision,p_mode,p_attendees) $$;
revoke all on function public.save_prepared_jsa(uuid,integer,jsonb),public.activate_prepared_jsa(uuid,integer,text,jsonb) from public,anon;
grant execute on function public.save_prepared_jsa(uuid,integer,jsonb),public.activate_prepared_jsa(uuid,integer,text,jsonb) to authenticated;
