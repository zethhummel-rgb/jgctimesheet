-- REVIEW COPY: additive correction after job-board-setup.sql and job-board-sources.sql.
-- No table, Storage policy, or source-policy writes. Only the current published company
-- safety PDF is derived into each authorized board; office-managed policy updates apply
-- on the next request. Other active employee policies are not automatically shared.
-- Eligible: exact title JGC Safety Policy (case-insensitive), is_active=true, PDF MIME,
-- safe private-bucket path and an existing policies Storage object. Newest updated wins.
begin;
set local lock_timeout = '5s';

create or replace function private.jgc_job_board_current_policy()
returns public.policies language sql stable security definer set search_path='' as $$
  select p from public.policies p
  join storage.objects o on o.bucket_id='policies' and o.name=p.file_path
  join storage.buckets bucket on bucket.id=o.bucket_id and bucket.public=false
  where p.is_active=true and lower(trim(p.title))='jgc safety policy'
    and lower(coalesce(p.file_type,''))='application/pdf'
    and length(trim(coalesce(p.file_path,''))) between 1 and 1024
    and p.file_path not like '/%' and position('..' in p.file_path)=0
    and lower(coalesce(nullif(o.metadata->>'mimetype',''),'application/pdf'))='application/pdf'
  order by p.updated_at desc,p.created_at desc,p.id desc limit 1;
$$;
revoke all on function private.jgc_job_board_current_policy() from public,anon,authenticated;

create or replace function private.jgc_job_board_policy_document(p_board_id uuid,p_policy public.policies)
returns public.job_board_documents language plpgsql stable security definer set search_path='' as $$
declare d public.job_board_documents; object_size text;
begin
  if p_policy.id is null then return d; end if;
  select o.metadata->>'size' into object_size from storage.objects o where o.bucket_id='policies' and o.name=p_policy.file_path;
  d.id := p_policy.id; d.board_id := p_board_id; d.category := 'jgc-policy';
  d.title := p_policy.title; d.report_date := (p_policy.updated_at at time zone 'America/Toronto')::date;
  d.file_name := coalesce(nullif(trim(p_policy.file_name),''),'JGC Safety Policy.pdf');
  d.mime_type := 'application/pdf';
  d.file_size := case when object_size ~ '^[0-9]{1,12}$' then greatest(object_size::bigint,1) else 1 end;
  d.object_path := p_policy.file_path; d.notes := 'Current company safety policy. Automatically included.';
  d.status := 'published'; d.visibility := 'public'; d.is_sensitive := false;
  d.source_type := 'policies'; d.source_id := p_policy.id;
  d.source_payload := jsonb_build_object('id',p_policy.id,'title',p_policy.title,'file_path',p_policy.file_path,'file_name',d.file_name,'file_type','application/pdf');
  d.created_at := p_policy.created_at; d.updated_at := p_policy.updated_at;
  return d;
end $$;
revoke all on function private.jgc_job_board_policy_document(uuid,public.policies) from public,anon,authenticated;

create or replace function private.jgc_job_board_model(p_board_id uuid,p_visit_token uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare b public.job_boards; s public.job_board_visitor_sessions; manage boolean; registered boolean; docs jsonb; viewers jsonb; policy public.policies; automatic_doc public.job_board_documents;
begin
  select * into b from public.job_boards where id=p_board_id;
  if b.id is null then raise exception 'Job Board unavailable' using errcode='42501'; end if;
  manage := private.jgc_job_board_admin();
  if not b.enabled and not manage then raise exception 'Job Board unavailable' using errcode='42501'; end if;
  s := private.jgc_job_board_visit(b.id,p_visit_token);
  registered := manage or s.id is not null;
  if registered then policy := private.jgc_job_board_current_policy(); end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'category',d.category,'title',d.title,'report_date',d.report_date,'file_name',d.file_name,'mime_type',d.mime_type,'file_size',d.file_size,'notes',d.notes,'status',d.status,'visibility',d.visibility,'created_by',case when manage or private.jgc_job_board_staff() then d.created_by else null end,'created_at',d.created_at,'updated_at',d.updated_at,'source_type',d.source_type,'source_id',d.source_id) order by d.report_date desc,d.created_at desc),'[]'::jsonb) into docs
  from public.job_board_documents d where d.board_id=b.id
    and not (policy.id is not null and coalesce(d.source_type='policies' and d.source_id=policy.id,false))
    and (manage or (registered and ((d.status='published' and (d.visibility='public' or private.jgc_job_board_restricted(b.id)))
      or (private.jgc_job_board_staff() and d.created_by=auth.uid() and d.status in ('uploading','pending')))));
  if policy.id is not null then
    automatic_doc := private.jgc_job_board_policy_document(b.id,policy);
    docs := docs || jsonb_build_array(jsonb_build_object('id',automatic_doc.id,'category',automatic_doc.category,'title',automatic_doc.title,'report_date',automatic_doc.report_date,'file_name',automatic_doc.file_name,'mime_type',automatic_doc.mime_type,'file_size',automatic_doc.file_size,'notes',automatic_doc.notes,'status',automatic_doc.status,'visibility',automatic_doc.visibility,'created_by',null,'created_at',automatic_doc.created_at,'updated_at',automatic_doc.updated_at,'source_type','policies','source_id',policy.id,'automatic',true));
  end if;
  if manage then
    select coalesce(jsonb_agg(jsonb_build_object('id',v.id,'profile_id',v.profile_id,'email',p.email,'display_name',p.display_name,'created_at',v.created_at) order by v.created_at),'[]'::jsonb) into viewers
    from public.job_board_viewers v join public.profiles p on p.id=v.profile_id where v.board_id=b.id;
  else viewers := '[]'::jsonb; end if;
  return jsonb_build_object('id',b.id,'job_id',b.job_id,'portal_job_id',b.portal_job_id,'job_number',b.job_number,'job_name',b.job_name,'address',b.address,'token',b.token,'enabled',b.enabled,'created_at',b.created_at,'updated_at',b.updated_at,'documents',docs,'viewers',viewers,'can_manage',manage,'can_register_as_staff',private.jgc_job_board_staff(),'can_upload',b.enabled and registered and private.jgc_job_board_staff(),'can_read_restricted',registered and private.jgc_job_board_restricted(b.id),'requires_visitor_signin',not registered,'visit_expires_at',s.expires_at);
end $$;

create or replace function private.jgc_job_board_read_document(p_token text,p_visit_token uuid,p_document_id uuid)
returns public.job_board_documents language plpgsql stable security definer set search_path='' as $$
declare b public.job_boards; d public.job_board_documents; s public.job_board_visitor_sessions; policy public.policies; manage boolean;
begin
  select * into b from public.job_boards where token=p_token;
  manage := private.jgc_job_board_admin();
  if b.id is null or (not b.enabled and not manage) then raise exception 'Job Board unavailable' using errcode='42501'; end if;
  if not manage then
    s := private.jgc_job_board_visit(b.id,p_visit_token);
    if s.id is null then raise exception 'Visitor sign-in is required' using errcode='42501'; end if;
  end if;
  policy := private.jgc_job_board_current_policy();
  if policy.id=p_document_id then return private.jgc_job_board_policy_document(b.id,policy); end if;
  select * into d from public.job_board_documents where id=p_document_id and board_id=b.id;
  if d.id is null or d.status='uploading' then raise exception 'Document unavailable' using errcode='42501'; end if;
  if manage then return d; end if;
  if not ((d.status='published' and (d.visibility='public' or private.jgc_job_board_restricted(b.id))) or (d.status='pending' and d.created_by=auth.uid() and private.jgc_job_board_staff())) then raise exception 'Document access unavailable' using errcode='42501'; end if;
  return d;
end $$;

create or replace function private.jgc_job_board_append(p_board_id uuid,p_action text,p_document_id uuid,p_actor jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare stamp timestamptz; doc_title text; audit_document_id uuid := p_document_id; policy public.policies;
begin
  perform pg_advisory_xact_lock(hashtextextended('job-board-history:'||p_board_id::text,0));
  select greatest(clock_timestamp(),coalesce(max(created_at)+interval '1 microsecond',clock_timestamp())) into stamp from public.job_board_activity where board_id=p_board_id;
  if p_document_id is not null then
    select title into doc_title from public.job_board_documents where id=p_document_id and board_id=p_board_id;
    if not found then
      policy := private.jgc_job_board_current_policy();
      if policy.id is distinct from p_document_id then raise exception 'Document unavailable' using errcode='42501'; end if;
      doc_title := policy.title; audit_document_id := null;
    end if;
  end if;
  insert into public.job_board_activity(board_id,document_id,document_title,actor_profile_id,actor_name,actor_company,actor_email,identity_type,action,created_at)
  values(p_board_id,audit_document_id,coalesce(doc_title,''),nullif(p_actor->>'profile_id','')::uuid,coalesce(p_actor->>'name',''),coalesce(p_actor->>'company',''),coalesce(p_actor->>'email',''),coalesce(p_actor->>'identity_type','system'),p_action,stamp);
end $$;

create or replace function private.jgc_log_job_board_activity(p_token text,p_visit_token uuid,p_action text,p_document_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.job_board_documents; b public.job_boards; actor jsonb; audit_document_id uuid; automatic_policy boolean := false;
begin
  if p_action is null or p_action not in ('open-board','view-document','email-link') then raise exception 'Unsupported activity'; end if;
  if p_action='open-board' then
    if p_document_id is not null then raise exception 'A board visit cannot specify a document'; end if;
    select * into b from public.job_boards where token=p_token;
    if b.id is null or (not b.enabled and not private.jgc_job_board_admin()) then raise exception 'Job Board unavailable' using errcode='42501'; end if;
    d.board_id := b.id;
  else
    d := private.jgc_job_board_read_document(p_token,p_visit_token,p_document_id);
    automatic_policy := coalesce(d.source_type='policies' and d.id=d.source_id,false);
  end if;
  actor := private.jgc_job_board_actor(d.board_id,p_visit_token);
  audit_document_id := case when automatic_policy then null else d.id end;
  perform pg_advisory_xact_lock(hashtextextended('job-board-history:'||d.board_id::text,0));
  if not exists(select 1 from public.job_board_activity a where a.board_id=d.board_id and a.document_id is not distinct from audit_document_id and (not automatic_policy or a.document_title=d.title) and a.action=p_action and a.actor_email=actor->>'email' and a.created_at>clock_timestamp()-interval '5 seconds') then
    perform private.jgc_job_board_append(d.board_id,p_action,d.id,actor);
  end if;
  return jsonb_build_object('ok',true);
end $$;

-- Existing public RPC contracts and their grants are preserved by CREATE OR REPLACE.
-- New private helpers remain inaccessible directly; no additional public grants.
revoke all on function private.jgc_job_board_model(uuid,uuid),private.jgc_job_board_read_document(text,uuid,uuid),private.jgc_job_board_append(uuid,text,uuid,jsonb) from public,anon,authenticated;
commit;
