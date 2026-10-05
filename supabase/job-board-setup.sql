-- REVIEW COPY: do not apply to production before specific approval of the Job Board backend.
-- Additive, isolated Job Board metadata, uploads and access. Existing safety records/buckets are unchanged.
begin;
set local lock_timeout = '5s';

create table public.job_boards (
  id uuid primary key default gen_random_uuid(),
  job_id text not null unique check (length(trim(job_id)) between 1 and 200),
  portal_job_id uuid references public.jobs(id),
  job_number text not null check (length(trim(job_number)) between 1 and 100),
  job_name text not null check (length(trim(job_name)) between 1 and 500),
  address text not null default '' check (length(address) <= 1000),
  token text not null unique default (gen_random_uuid()::text || gen_random_uuid()::text),
  enabled boolean not null default true,
  created_by uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);
create index job_boards_portal_job_idx on public.job_boards(portal_job_id);

create table public.job_board_documents (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.job_boards(id),
  category text not null check (category in ('hs-documents','site-specific','jgc-policy','jsa','toolbox-talk','accident-incident','daily-report','permit','inspection','other')),
  title text not null check (length(trim(title)) between 1 and 200),
  report_date date not null,
  file_name text not null check (length(trim(file_name)) between 1 and 255),
  mime_type text not null check (mime_type in ('application/pdf','image/jpeg','image/png','image/webp')),
  file_size bigint not null check (file_size between 1 and 20971520),
  object_path text not null unique,
  notes text not null default '' check (length(notes) <= 4000),
  status text not null default 'uploading' check (status in ('uploading','pending','published','archived')),
  visibility text not null default 'public' check (visibility in ('public','restricted')),
  is_sensitive boolean not null default false,
  source_type text,
  source_id uuid,
  source_payload jsonb check (source_payload is null or (jsonb_typeof(source_payload)='object' and octet_length(source_payload::text)<=2097152)),
  created_by uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  reviewed_by uuid,
  reviewed_at timestamptz,
  constraint job_board_accident_restricted check (category <> 'accident-incident' or visibility='restricted'),
  constraint job_board_sensitive_restricted check (not is_sensitive or visibility='restricted'),
  constraint job_board_original_path check (object_path = board_id::text || '/' || id::text || '/original.' || case mime_type when 'application/pdf' then 'pdf' when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp' end)
);
create index job_board_documents_board_date_idx on public.job_board_documents(board_id,report_date desc,created_at desc);
create index job_board_documents_created_by_idx on public.job_board_documents(created_by);
create index job_board_documents_reviewed_by_idx on public.job_board_documents(reviewed_by);
create unique index job_board_documents_source_idx on public.job_board_documents(board_id,source_type,source_id) where source_id is not null;

create table public.job_board_viewers (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.job_boards(id),
  profile_id uuid not null references public.profiles(id),
  created_by uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  unique(board_id,profile_id)
);
create index job_board_viewers_profile_idx on public.job_board_viewers(profile_id);

create table public.job_board_visitor_sessions (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.job_boards(id),
  token_hash text not null unique,
  profile_id uuid,
  actor_name text not null check (length(trim(actor_name)) between 1 and 150),
  actor_company text not null check (length(trim(actor_company)) between 1 and 150),
  actor_email text not null check (length(actor_email) between 3 and 254),
  identity_type text not null check (identity_type in ('visitor','staff','client')),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default (clock_timestamp()+interval '12 hours'),
  revoked_at timestamptz
);
create index job_board_visits_board_created_idx on public.job_board_visitor_sessions(board_id,created_at desc);
create index job_board_visits_profile_idx on public.job_board_visitor_sessions(profile_id);

create table public.job_board_activity (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.job_boards(id),
  document_id uuid references public.job_board_documents(id),
  document_title text not null default '',
  actor_profile_id uuid,
  actor_name text not null,
  actor_company text not null,
  actor_email text not null,
  identity_type text not null check (identity_type in ('visitor','staff','client','system')),
  action text not null check (action in ('visit','open-board','view-document','email-link','download-request','upload','publish','archive','return-pending','edit-document','disable','enable','rotate-token','grant-viewer','revoke-viewer','create-board')),
  created_at timestamptz not null
);
create unique index job_board_activity_cursor_idx on public.job_board_activity(board_id,created_at desc);
create index job_board_activity_document_idx on public.job_board_activity(document_id);
create index job_board_activity_actor_idx on public.job_board_activity(actor_profile_id);

alter table public.job_boards enable row level security;
alter table public.job_board_documents enable row level security;
alter table public.job_board_viewers enable row level security;
alter table public.job_board_visitor_sessions enable row level security;
alter table public.job_board_activity enable row level security;
revoke all on public.job_boards,public.job_board_documents,public.job_board_viewers,public.job_board_visitor_sessions,public.job_board_activity from public,anon,authenticated;

create function private.jgc_job_board_staff() returns boolean
language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and private.jgc_has_full_portal_access() and exists(
    select 1 from public.profiles p where p.id=auth.uid() and p.account_status='approved' and p.role in ('worker','supervisor','admin'));
$$;
create function private.jgc_job_board_admin() returns boolean
language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and public.is_admin() and private.jgc_job_board_staff();
$$;
create function private.jgc_job_board_restricted(p_board_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select private.jgc_job_board_staff() or exists(
    select 1 from public.job_board_viewers v join public.profiles p on p.id=v.profile_id
    where v.board_id=p_board_id and p.id=auth.uid() and p.account_status in ('approved','limited'));
$$;
create function private.jgc_job_board_token_hash(p_token uuid) returns text
language sql immutable set search_path='' as $$
  select encode(sha256(convert_to(p_token::text,'UTF8')),'hex');
$$;

create function private.jgc_job_board_visit(p_board_id uuid,p_visit_token uuid)
returns public.job_board_visitor_sessions language sql stable security definer set search_path='' as $$
  select s from public.job_board_visitor_sessions s
  where s.board_id=p_board_id and s.token_hash=private.jgc_job_board_token_hash(p_visit_token)
    and s.revoked_at is null and s.expires_at>now()
    and ((s.profile_id is null and auth.uid() is null) or (s.profile_id=auth.uid() and exists(select 1 from public.profiles p where p.id=s.profile_id and p.account_status in ('approved','limited'))));
$$;

create function private.jgc_job_board_actor(p_board_id uuid,p_visit_token uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare p public.profiles; s public.job_board_visitor_sessions;
begin
  if private.jgc_job_board_admin() then
    select * into p from public.profiles where id=auth.uid();
    return jsonb_build_object('profile_id',p.id,'name',coalesce(nullif(trim(p.display_name),''),p.worker_key,'Staff'),'company','John Gordon Construction','email',coalesce(p.email,''),'identity_type','staff');
  end if;
  s := private.jgc_job_board_visit(p_board_id,p_visit_token);
  if s.id is null then raise exception 'Visitor sign-in is required' using errcode='42501'; end if;
  return jsonb_build_object('profile_id',s.profile_id,'name',s.actor_name,'company',s.actor_company,'email',s.actor_email,'identity_type',s.identity_type);
end $$;

create function private.jgc_job_board_append(p_board_id uuid,p_action text,p_document_id uuid,p_actor jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare stamp timestamptz; doc_title text;
begin
  -- Serial timestamp assignment gives the public admin history a lossless timestamp keyset cursor.
  perform pg_advisory_xact_lock(hashtextextended('job-board-history:'||p_board_id::text,0));
  select greatest(clock_timestamp(),coalesce(max(created_at)+interval '1 microsecond',clock_timestamp())) into stamp from public.job_board_activity where board_id=p_board_id;
  if p_document_id is not null then select title into doc_title from public.job_board_documents where id=p_document_id and board_id=p_board_id; end if;
  insert into public.job_board_activity(board_id,document_id,document_title,actor_profile_id,actor_name,actor_company,actor_email,identity_type,action,created_at)
  values(p_board_id,p_document_id,coalesce(doc_title,''),nullif(p_actor->>'profile_id','')::uuid,coalesce(p_actor->>'name',''),coalesce(p_actor->>'company',''),coalesce(p_actor->>'email',''),coalesce(p_actor->>'identity_type','system'),p_action,stamp);
end $$;

create function private.jgc_job_board_model(p_board_id uuid,p_visit_token uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare b public.job_boards; s public.job_board_visitor_sessions; manage boolean; registered boolean; docs jsonb; viewers jsonb;
begin
  select * into b from public.job_boards where id=p_board_id;
  if b.id is null then raise exception 'Job Board unavailable' using errcode='42501'; end if;
  manage := private.jgc_job_board_admin();
  if not b.enabled and not manage then raise exception 'Job Board unavailable' using errcode='42501'; end if;
  s := private.jgc_job_board_visit(b.id,p_visit_token);
  registered := manage or s.id is not null;
  select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'category',d.category,'title',d.title,'report_date',d.report_date,'file_name',d.file_name,'mime_type',d.mime_type,'file_size',d.file_size,'notes',d.notes,'status',d.status,'visibility',d.visibility,'created_by',case when manage or private.jgc_job_board_staff() then d.created_by else null end,'created_at',d.created_at,'updated_at',d.updated_at,'source_type',d.source_type,'source_id',d.source_id) order by d.report_date desc,d.created_at desc),'[]'::jsonb) into docs
  from public.job_board_documents d where d.board_id=b.id and (
    manage or (registered and ((d.status='published' and (d.visibility='public' or private.jgc_job_board_restricted(b.id)))
      or (private.jgc_job_board_staff() and d.created_by=auth.uid() and d.status in ('uploading','pending')))));
  if manage then
    select coalesce(jsonb_agg(jsonb_build_object('id',v.id,'profile_id',v.profile_id,'email',p.email,'display_name',p.display_name,'created_at',v.created_at) order by v.created_at),'[]'::jsonb) into viewers
    from public.job_board_viewers v join public.profiles p on p.id=v.profile_id where v.board_id=b.id;
  else viewers := '[]'::jsonb; end if;
  return jsonb_build_object('id',b.id,'job_id',b.job_id,'portal_job_id',b.portal_job_id,'job_number',b.job_number,'job_name',b.job_name,'address',b.address,'token',b.token,'enabled',b.enabled,'created_at',b.created_at,'updated_at',b.updated_at,'documents',docs,'viewers',viewers,'can_manage',manage,'can_register_as_staff',private.jgc_job_board_staff(),'can_upload',b.enabled and registered and private.jgc_job_board_staff(),'can_read_restricted',registered and private.jgc_job_board_restricted(b.id),'requires_visitor_signin',not registered,'visit_expires_at',s.expires_at);
end $$;

create function private.jgc_get_or_create_job_board(p_job_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j jsonb; portal public.jobs; b public.job_boards; link text;
begin
  if not private.jgc_job_board_admin() then raise exception 'Approved administrator access required' using errcode='42501'; end if;
  if coalesce(length(trim(p_job_id)),0) not between 1 and 200 then raise exception 'Select a valid job'; end if;
  select item into j from public.estimator_workspaces w cross join lateral jsonb_array_elements(coalesce(w.payload->'jobs','[]'::jsonb)) item where w.id='main' and item->>'id'=p_job_id limit 1;
  if j is null then raise exception 'Job not found in the current workspace'; end if;
  link := nullif(trim(j->>'portalJobId'),'');
  if link is not null then
    select * into portal from public.jobs where id::text=link;
    if portal.id is not null and nullif(trim(j->>'jobNumber'),'') is not null and trim(portal.job_number)<>trim(j->>'jobNumber') then raise exception 'Job identity does not match the Portal job'; end if;
  else
    if (select count(*) from public.jobs where trim(job_number)=trim(j->>'jobNumber'))<>1 then raise exception 'Job is not linked to a unique Portal job'; end if;
    select * into portal from public.jobs where trim(job_number)=trim(j->>'jobNumber');
  end if;
  if portal.id is null then raise exception 'Job is not linked to a current Portal job'; end if;
  perform pg_advisory_xact_lock(hashtextextended('job-board-create:'||p_job_id,0));
  select * into b from public.job_boards where job_id=p_job_id;
  if b.id is null then
    insert into public.job_boards(job_id,portal_job_id,job_number,job_name,address,created_by)
    values(p_job_id,portal.id,trim(portal.job_number),portal.job_name,coalesce(portal.address,''),auth.uid()) returning * into b;
    perform private.jgc_job_board_append(b.id,'create-board',null,private.jgc_job_board_actor(b.id,null));
  else
    if b.portal_job_id is distinct from portal.id then raise exception 'The Job Board belongs to a different Portal job'; end if;
    update public.job_boards set job_number=trim(portal.job_number),job_name=portal.job_name,address=coalesce(portal.address,''),updated_at=clock_timestamp() where id=b.id;
  end if;
  return private.jgc_job_board_model(b.id,null);
end $$;

create function private.jgc_get_job_board(p_token text,p_visit_token uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare b public.job_boards;
begin
  select * into b from public.job_boards where token=p_token;
  if b.id is null then raise exception 'Job Board unavailable' using errcode='42501'; end if;
  return private.jgc_job_board_model(b.id,p_visit_token);
end $$;

create function private.jgc_register_job_board_visit(p_token text,p_name text,p_company text,p_email text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.job_boards; p public.profiles; visit uuid; kind text; name_value text; company_value text; email_value text;
begin
  select * into b from public.job_boards where token=p_token and enabled;
  if b.id is null then raise exception 'Job Board unavailable' using errcode='42501'; end if;
  if auth.uid() is not null then
    select * into p from public.profiles where id=auth.uid();
    if p.id is null or p.account_status not in ('approved','limited') then raise exception 'Account access unavailable' using errcode='42501'; end if;
  end if;
  if private.jgc_job_board_staff() then
    kind := 'staff'; name_value := coalesce(nullif(trim(p.display_name),''),nullif(trim(p.worker_key),'')); company_value := 'John Gordon Construction'; email_value := lower(trim(p.email));
  else
    kind := case when p.id is null then 'visitor' else 'client' end;
    name_value := case when p.id is null then trim(p_name) else coalesce(nullif(trim(p.display_name),''),trim(p_name)) end;
    company_value := trim(p_company);
    email_value := lower(trim(case when p.id is null then p_email else p.email end));
  end if;
  if coalesce(length(name_value),0) not between 1 and 150 or coalesce(length(company_value),0) not between 1 and 150 or coalesce(length(email_value),0) not between 3 and 254 or email_value !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then raise exception 'Enter your name, company and valid email'; end if;
  perform pg_advisory_xact_lock(hashtextextended('job-board-visits:'||b.id::text,0));
  if (select count(*) from public.job_board_visitor_sessions where board_id=b.id and created_at>clock_timestamp()-interval '1 minute')>=120
    or (select count(*) from public.job_board_visitor_sessions where board_id=b.id and lower(actor_email)=email_value and created_at>clock_timestamp()-interval '1 minute')>=3 then raise exception 'Too many sign-in requests. Try again in a minute.' using errcode='54000'; end if;
  visit := gen_random_uuid();
  insert into public.job_board_visitor_sessions(board_id,token_hash,profile_id,actor_name,actor_company,actor_email,identity_type)
  values(b.id,private.jgc_job_board_token_hash(visit),p.id,name_value,company_value,email_value,kind);
  perform private.jgc_job_board_append(b.id,'visit',null,jsonb_build_object('profile_id',p.id,'name',name_value,'company',company_value,'email',email_value,'identity_type',kind));
  return jsonb_build_object('visit_token',visit,'expires_at',clock_timestamp()+interval '12 hours');
end $$;

create function private.jgc_begin_job_board_upload(p_board_id uuid,p_category text,p_title text,p_report_date date,p_file_name text,p_mime_type text,p_file_size bigint,p_notes text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare doc uuid; path_value text; extension text;
begin
  if not private.jgc_job_board_staff() then raise exception 'Approved staff access required' using errcode='42501'; end if;
  if not exists(select 1 from public.job_boards where id=p_board_id and enabled) then raise exception 'Job Board unavailable'; end if;
  if p_category is null or p_category not in ('hs-documents','site-specific','jgc-policy','jsa','toolbox-talk','accident-incident','daily-report','permit','inspection','other') then raise exception 'Choose a document category'; end if;
  if coalesce(length(trim(p_title)),0) not between 1 and 200 or coalesce(length(trim(p_file_name)),0) not between 1 and 255 or coalesce(length(p_notes),0)>4000 or p_report_date is null then raise exception 'Enter a title, report date and valid file name'; end if;
  if p_mime_type is null or p_mime_type not in ('application/pdf','image/jpeg','image/png','image/webp') or p_file_size is null or p_file_size not between 1 and 20971520 then raise exception 'Choose a PDF, JPG, PNG or WebP file up to 20 MB'; end if;
  extension := case p_mime_type when 'application/pdf' then 'pdf' when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp' end;
  doc := gen_random_uuid(); path_value := p_board_id::text||'/'||doc::text||'/original.'||extension;
  insert into public.job_board_documents(id,board_id,category,title,report_date,file_name,mime_type,file_size,object_path,notes,visibility,created_by)
  values(doc,p_board_id,p_category,trim(p_title),p_report_date,trim(p_file_name),p_mime_type,p_file_size,path_value,coalesce(p_notes,''),case when p_category='accident-incident' then 'restricted' else 'public' end,auth.uid());
  return jsonb_build_object('id',doc,'object_path',path_value);
end $$;

create function private.jgc_finalize_job_board_upload(p_document_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.job_board_documents; o storage.objects; p public.profiles;
begin
  if not private.jgc_job_board_staff() then raise exception 'Approved staff access required' using errcode='42501'; end if;
  select * into d from public.job_board_documents where id=p_document_id for update;
  if d.id is null or d.created_by<>auth.uid() then raise exception 'Upload unavailable' using errcode='42501'; end if;
  if not exists(select 1 from public.job_boards where id=d.board_id and enabled) then raise exception 'Job Board unavailable'; end if;
  if d.status='pending' then return jsonb_build_object('id',d.id,'status',d.status); end if;
  if d.status<>'uploading' then raise exception 'This upload is already finalized'; end if;
  select * into o from storage.objects where bucket_id='job-board-files' and name=d.object_path;
  if o.id is null or o.metadata->>'size' is distinct from d.file_size::text or o.metadata->>'mimetype' is distinct from d.mime_type then raise exception 'Upload is incomplete or file metadata does not match'; end if;
  update public.job_board_documents set status='pending',updated_at=clock_timestamp() where id=d.id;
  select * into p from public.profiles where id=auth.uid();
  perform private.jgc_job_board_append(d.board_id,'upload',d.id,jsonb_build_object('profile_id',p.id,'name',coalesce(p.display_name,p.worker_key),'company','John Gordon Construction','email',p.email,'identity_type','staff'));
  return jsonb_build_object('id',d.id,'status','pending');
end $$;

create function private.jgc_review_job_board_document(p_document_id uuid,p_status text,p_visibility text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.job_board_documents; visibility_value text;
begin
  if not private.jgc_job_board_admin() then raise exception 'Approved administrator access required' using errcode='42501'; end if;
  if p_status is null or p_status not in ('pending','published','archived') or p_visibility is null or p_visibility not in ('public','restricted') then raise exception 'Choose a valid review status and visibility'; end if;
  select * into d from public.job_board_documents where id=p_document_id for update;
  if d.id is null or d.status='uploading' then raise exception 'Finalize the upload before reviewing it'; end if;
  visibility_value := case when d.category='accident-incident' or d.is_sensitive then 'restricted' else p_visibility end;
  if d.status=p_status and d.visibility=visibility_value then return jsonb_build_object('id',d.id,'status',d.status,'visibility',visibility_value); end if;
  update public.job_board_documents set status=p_status,visibility=visibility_value,reviewed_by=auth.uid(),reviewed_at=clock_timestamp(),updated_at=clock_timestamp() where id=d.id;
  perform private.jgc_job_board_append(d.board_id,case p_status when 'published' then 'publish' when 'archived' then 'archive' else 'return-pending' end,d.id,private.jgc_job_board_actor(d.board_id,null));
  return jsonb_build_object('id',d.id,'status',p_status,'visibility',visibility_value);
end $$;

create function private.jgc_update_job_board_document(p_document_id uuid,p_title text,p_report_date date,p_category text,p_notes text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.job_board_documents;
begin
  if not private.jgc_job_board_admin() then raise exception 'Approved administrator access required' using errcode='42501'; end if;
  if coalesce(length(trim(p_title)),0) not between 1 and 200 or p_report_date is null or coalesce(length(p_notes),0)>4000 or p_category is null or p_category not in ('hs-documents','site-specific','jgc-policy','jsa','toolbox-talk','accident-incident','daily-report','permit','inspection','other') then raise exception 'Enter valid document details'; end if;
  select * into d from public.job_board_documents where id=p_document_id for update;
  if d.id is null then raise exception 'Document unavailable'; end if;
  update public.job_board_documents set title=trim(p_title),report_date=p_report_date,category=p_category,notes=coalesce(p_notes,''),visibility=case when p_category='accident-incident' then 'restricted' else visibility end,updated_at=clock_timestamp() where id=d.id;
  perform private.jgc_job_board_append(d.board_id,'edit-document',d.id,private.jgc_job_board_actor(d.board_id,null));
  return jsonb_build_object('id',d.id);
end $$;

create function private.jgc_configure_job_board(p_board_id uuid,p_enabled boolean,p_rotate_token boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.job_boards; actor jsonb;
begin
  if not private.jgc_job_board_admin() then raise exception 'Approved administrator access required' using errcode='42501'; end if;
  if p_enabled is null or p_rotate_token is null then raise exception 'Choose valid Job Board settings'; end if;
  select * into b from public.job_boards where id=p_board_id for update;
  if b.id is null then raise exception 'Job Board unavailable'; end if;
  actor := private.jgc_job_board_actor(b.id,null);
  update public.job_boards set enabled=p_enabled,token=case when p_rotate_token then gen_random_uuid()::text||gen_random_uuid()::text else token end,updated_at=clock_timestamp() where id=b.id;
  if not p_enabled or p_rotate_token then update public.job_board_visitor_sessions set revoked_at=clock_timestamp() where board_id=b.id and revoked_at is null; end if;
  if b.enabled<>p_enabled then perform private.jgc_job_board_append(b.id,case when p_enabled then 'enable' else 'disable' end,null,actor); end if;
  if p_rotate_token then perform private.jgc_job_board_append(b.id,'rotate-token',null,actor); end if;
  return private.jgc_job_board_model(b.id,null);
end $$;

create function private.jgc_grant_job_board_viewer(p_board_id uuid,p_email text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.profiles; v public.job_board_viewers;
begin
  if not private.jgc_job_board_admin() then raise exception 'Approved administrator access required' using errcode='42501'; end if;
  if not exists(select 1 from public.job_boards where id=p_board_id) then raise exception 'Job Board unavailable'; end if;
  if coalesce(length(trim(p_email)),0) not between 3 and 254 then raise exception 'Enter the existing account email'; end if;
  if (select count(*) from public.profiles where lower(trim(email))=lower(trim(p_email)) and account_status in ('approved','limited'))<>1 then raise exception 'Choose a unique approved or limited client account'; end if;
  select * into p from public.profiles where lower(trim(email))=lower(trim(p_email)) and account_status in ('approved','limited');
  if p.id=auth.uid() then raise exception 'Administrators already have access'; end if;
  insert into public.job_board_viewers(board_id,profile_id,created_by) values(p_board_id,p.id,auth.uid()) on conflict(board_id,profile_id) do nothing returning * into v;
  if v.id is not null then perform private.jgc_job_board_append(p_board_id,'grant-viewer',null,private.jgc_job_board_actor(p_board_id,null)); else select * into v from public.job_board_viewers where board_id=p_board_id and profile_id=p.id; end if;
  return jsonb_build_object('id',v.id,'profile_id',p.id,'email',p.email,'display_name',p.display_name);
end $$;

create function private.jgc_revoke_job_board_viewer(p_board_id uuid,p_viewer_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if not private.jgc_job_board_admin() then raise exception 'Approved administrator access required' using errcode='42501'; end if;
  delete from public.job_board_viewers where id=p_viewer_id and board_id=p_board_id;
  if found then perform private.jgc_job_board_append(p_board_id,'revoke-viewer',null,private.jgc_job_board_actor(p_board_id,null)); end if;
  return jsonb_build_object('ok',true);
end $$;

create function private.jgc_job_board_read_document(p_token text,p_visit_token uuid,p_document_id uuid)
returns public.job_board_documents language plpgsql stable security definer set search_path='' as $$
declare b public.job_boards; d public.job_board_documents; s public.job_board_visitor_sessions;
begin
  select * into b from public.job_boards where token=p_token;
  if b.id is null or (not b.enabled and not private.jgc_job_board_admin()) then raise exception 'Job Board unavailable' using errcode='42501'; end if;
  select * into d from public.job_board_documents where id=p_document_id and board_id=b.id;
  if d.id is null or d.status='uploading' then raise exception 'Document unavailable' using errcode='42501'; end if;
  if private.jgc_job_board_admin() then return d; end if;
  s := private.jgc_job_board_visit(b.id,p_visit_token);
  if s.id is null then raise exception 'Visitor sign-in is required' using errcode='42501'; end if;
  if not ((d.status='published' and (d.visibility='public' or private.jgc_job_board_restricted(b.id))) or (d.status='pending' and d.created_by=auth.uid() and private.jgc_job_board_staff())) then raise exception 'Document access unavailable' using errcode='42501'; end if;
  return d;
end $$;

create function private.jgc_job_board_clean_snapshot(p_value jsonb)
returns jsonb language plpgsql immutable set search_path='' as $$
declare result_value jsonb; item record;
begin
  if jsonb_typeof(p_value)='object' then
    result_value := '{}'::jsonb;
    for item in select key,value from jsonb_each(p_value) loop
      if lower(item.key) not in ('token','qr_token','inspection_qr_token','vehicle_inspection_qr_token','access_token','refresh_token','offline_submission_id','password','service_role_key') then result_value := result_value || jsonb_build_object(item.key,private.jgc_job_board_clean_snapshot(item.value)); end if;
    end loop;
    return result_value;
  elsif jsonb_typeof(p_value)='array' then
    select coalesce(jsonb_agg(private.jgc_job_board_clean_snapshot(value)),'[]'::jsonb) into result_value from jsonb_array_elements(p_value);
    return result_value;
  end if;
  return p_value;
end $$;

create function private.jgc_job_board_project_matches(p_value text,p_number text) returns boolean
language sql immutable set search_path='' as $$
  select trim(coalesce(p_number,''))<>'' and (trim(coalesce(p_value,''))=trim(p_number) or
    (left(trim(coalesce(p_value,'')),length(trim(p_number)))=trim(p_number)
     and substring(trim(coalesce(p_value,'')) from length(trim(p_number))+1 for 1) in (' ','-','–',':')));
$$;

create function private.jgc_job_board_source_matches(p_source jsonb,p_board_id uuid,p_number text) returns boolean
language plpgsql immutable set search_path='' as $$
declare explicit_board text; explicit_number text; project_value text; fields jsonb;
begin
  explicit_board := coalesce(nullif(trim(p_source#>>'{form_data,job_context,job_board_id}'),''),nullif(trim(p_source#>>'{report_details,job_board_id}'),''));
  if explicit_board is not null then return explicit_board=p_board_id::text; end if;
  explicit_number := nullif(trim(p_source#>>'{form_data,job_context,jobNumber}'),'');
  if explicit_number is not null then return explicit_number=trim(p_number); end if;
  project_value := coalesce(nullif(trim(p_source->>'project'),''),nullif(trim(p_source->>'site_location'),''),nullif(trim(p_source->>'accident_location'),''),nullif(trim(p_source#>>'{form_data,job_context,project}'),''));
  if project_value is null then
    fields := case when jsonb_typeof(p_source#>'{form_data,fields}')='array' then p_source#>'{form_data,fields}' else '[]'::jsonb end;
    select f->>'value' into project_value from jsonb_array_elements(fields) f
    where lower(trim(f->>'label')) ~ '^(project( / (job|site))?|job|location of use|project / site|site location|location / building / floor)$' and length(trim(coalesce(f->>'value','')))>0
    order by (lower(trim(f->>'label')) like 'project%' or lower(trim(f->>'label'))='job') desc limit 1;
  end if;
  return private.jgc_job_board_project_matches(project_value,p_number);
end $$;

create function private.jgc_attach_job_board_report_core(p_board_id uuid,p_source_type text,p_source_id uuid,p_actor jsonb)
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
  values(doc,b.id,category_value,left(trim(title_value),200),date_value,'JGC-'||category_value||'-'||date_value::text||'.pdf','application/pdf',1,b.id::text||'/'||doc::text||'/original.pdf','','pending','restricted',p_source_type,p_source_id,private.jgc_job_board_clean_snapshot(source_value),auth.uid());
  perform private.jgc_job_board_append(b.id,'upload',doc,p_actor);
  return jsonb_build_object('id',doc,'status','pending','already_attached',false);
end $$;

create function private.jgc_attach_job_board_report(p_token text,p_visit_token uuid,p_source_type text,p_source_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.job_boards;
begin
  if not private.jgc_job_board_staff() then raise exception 'Approved staff access required' using errcode='42501'; end if;
  select * into b from public.job_boards where token=p_token and enabled;
  if b.id is null then raise exception 'Job Board unavailable'; end if;
  return private.jgc_attach_job_board_report_core(b.id,p_source_type,p_source_id,private.jgc_job_board_actor(b.id,p_visit_token));
end $$;

create function private.jgc_attach_job_board_report_by_id(p_board_id uuid,p_source_type text,p_source_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.profiles;
begin
  if not private.jgc_job_board_staff() then raise exception 'Approved staff access required' using errcode='42501'; end if;
  select * into p from public.profiles where id=auth.uid();
  return private.jgc_attach_job_board_report_core(p_board_id,p_source_type,p_source_id,jsonb_build_object('profile_id',p.id,'name',coalesce(p.display_name,p.worker_key),'company','John Gordon Construction','email',p.email,'identity_type','staff'));
end $$;

create function private.jgc_resolve_job_board_download(p_token text,p_visit_token uuid,p_document_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.job_board_documents;
begin
  d := private.jgc_job_board_read_document(p_token,p_visit_token,p_document_id);
  perform private.jgc_job_board_append(d.board_id,'download-request',d.id,private.jgc_job_board_actor(d.board_id,p_visit_token));
  return jsonb_build_object('id',d.id,'board_id',d.board_id,'bucket','job-board-files','object_path',d.object_path,'file_name',d.file_name,'mime_type',d.mime_type,'file_size',d.file_size,'category',d.category,'title',d.title,'source_type',d.source_type,'source_id',d.source_id,'source_payload',d.source_payload);
end $$;

create function private.jgc_log_job_board_activity(p_token text,p_visit_token uuid,p_action text,p_document_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.job_board_documents; b public.job_boards; actor jsonb;
begin
  if p_action is null or p_action not in ('open-board','view-document','email-link') then raise exception 'Unsupported activity'; end if;
  if p_action='open-board' then
    if p_document_id is not null then raise exception 'A board visit cannot specify a document'; end if;
    select * into b from public.job_boards where token=p_token;
    if b.id is null or (not b.enabled and not private.jgc_job_board_admin()) then raise exception 'Job Board unavailable' using errcode='42501'; end if;
    d.board_id := b.id;
  else
    d := private.jgc_job_board_read_document(p_token,p_visit_token,p_document_id);
  end if;
  actor := private.jgc_job_board_actor(d.board_id,p_visit_token);
  -- Duplicate button/retry activity is bounded without losing a different document/action.
  perform pg_advisory_xact_lock(hashtextextended('job-board-history:'||d.board_id::text,0));
  if not exists(select 1 from public.job_board_activity a where a.board_id=d.board_id and a.document_id is not distinct from d.id and a.action=p_action and a.actor_email=actor->>'email' and a.created_at>clock_timestamp()-interval '5 seconds') then perform private.jgc_job_board_append(d.board_id,p_action,d.id,actor); end if;
  return jsonb_build_object('ok',true);
end $$;

create function private.jgc_get_job_board_activity(p_board_id uuid,p_before timestamptz,p_limit integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare rows_value jsonb; cursor_value timestamptz;
begin
  if not private.jgc_job_board_admin() then raise exception 'Approved administrator access required' using errcode='42501'; end if;
  if not exists(select 1 from public.job_boards where id=p_board_id) then raise exception 'Job Board unavailable'; end if;
  select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at desc),'[]'::jsonb),min(q.created_at) into rows_value,cursor_value from (
    select id,actor_name,actor_company,actor_email,identity_type,action,document_id,document_title,created_at from public.job_board_activity
    where board_id=p_board_id and (p_before is null or created_at<p_before) order by created_at desc limit greatest(1,least(coalesce(p_limit,50),100))) q;
  if not exists(select 1 from public.job_board_activity where board_id=p_board_id and created_at<cursor_value) then cursor_value := null; end if;
  return jsonb_build_object('events',rows_value,'next_before',cursor_value);
end $$;

create function private.jgc_job_board_storage_upload(p_path text) returns boolean
language sql stable security definer set search_path='' as $$
  select private.jgc_job_board_staff() and exists(select 1 from public.job_board_documents d join public.job_boards b on b.id=d.board_id where d.object_path=p_path and d.status='uploading' and d.created_by=auth.uid() and b.enabled);
$$;
create function private.jgc_job_board_storage_read(p_path text) returns boolean
language sql stable security definer set search_path='' as $$
  select private.jgc_job_board_admin() or (private.jgc_job_board_staff() and exists(select 1 from public.job_board_documents d join public.job_boards b on b.id=d.board_id where d.object_path=p_path and d.created_by=auth.uid() and d.status in ('uploading','pending') and b.enabled));
$$;
create function private.jgc_job_board_activity_immutable() returns trigger
language plpgsql set search_path='' as $$ begin raise exception 'Job Board activity is append-only'; end $$;
create trigger job_board_activity_append_only before update or delete on public.job_board_activity for each row execute function private.jgc_job_board_activity_immutable();

create function private.jgc_job_board_document_guard() returns trigger
language plpgsql set search_path='' as $$
begin
  if tg_op='UPDATE' then
    if new.id is distinct from old.id or new.board_id is distinct from old.board_id or new.created_by is distinct from old.created_by or new.object_path is distinct from old.object_path or new.file_name is distinct from old.file_name or new.mime_type is distinct from old.mime_type or new.file_size is distinct from old.file_size or new.created_at is distinct from old.created_at or new.source_type is distinct from old.source_type or new.source_id is distinct from old.source_id or new.source_payload is distinct from old.source_payload then raise exception 'Original document identity and source snapshot are immutable'; end if;
    new.is_sensitive := old.is_sensitive or new.is_sensitive;
  end if;
  new.is_sensitive := new.is_sensitive or new.category='accident-incident' or coalesce(new.source_type in ('incident_reports','accident_reports','employee_injury_reports'),false);
  if new.is_sensitive then new.visibility := 'restricted'; end if;
  return new;
end $$;
create trigger job_board_document_guard before insert or update on public.job_board_documents for each row execute function private.jgc_job_board_document_guard();

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('job-board-files','job-board-files',false,20971520,array['application/pdf','image/jpeg','image/png','image/webp']);
create policy "Job Board original upload" on storage.objects for insert to authenticated with check (bucket_id='job-board-files' and private.jgc_job_board_storage_upload(name));
create policy "Job Board original staff preview" on storage.objects for select to authenticated using (bucket_id='job-board-files' and private.jgc_job_board_storage_read(name));
create policy "Job Board upload cannot inherit another bucket grant" on storage.objects as restrictive for insert to authenticated with check (bucket_id<>'job-board-files' or private.jgc_job_board_storage_upload(name));
create policy "Job Board preview cannot inherit another bucket grant" on storage.objects as restrictive for select to authenticated using (bucket_id<>'job-board-files' or private.jgc_job_board_storage_read(name));
create policy "Job Board originals deny anonymous inherited reads" on storage.objects as restrictive for select to anon using (bucket_id<>'job-board-files');
create policy "Job Board originals deny anonymous inherited uploads" on storage.objects as restrictive for insert to anon with check (bucket_id<>'job-board-files');
create policy "Job Board originals deny inherited replacements" on storage.objects as restrictive for update to anon,authenticated using (bucket_id<>'job-board-files') with check (bucket_id<>'job-board-files');
create policy "Job Board originals deny inherited deletions" on storage.objects as restrictive for delete to anon,authenticated using (bucket_id<>'job-board-files');
-- No client/anon Storage reads and no UPDATE/DELETE policies. Edge signs only a caller-authorized document.

create function public.get_or_create_job_board(p_job_id text) returns jsonb language sql security invoker set search_path='' as $$ select private.jgc_get_or_create_job_board(p_job_id) $$;
create function public.get_job_board(p_token text,p_visit_token uuid default null) returns jsonb language sql security invoker set search_path='' as $$ select private.jgc_get_job_board(p_token,p_visit_token) $$;
create function public.register_job_board_visit(p_token text,p_name text,p_company text,p_email text) returns jsonb language sql security invoker set search_path='' as $$ select private.jgc_register_job_board_visit(p_token,p_name,p_company,p_email) $$;
create function public.begin_job_board_upload(p_board_id uuid,p_category text,p_title text,p_report_date date,p_file_name text,p_mime_type text,p_file_size bigint,p_notes text default '') returns jsonb language sql security invoker set search_path='' as $$ select private.jgc_begin_job_board_upload(p_board_id,p_category,p_title,p_report_date,p_file_name,p_mime_type,p_file_size,p_notes) $$;
create function public.finalize_job_board_upload(p_document_id uuid) returns jsonb language sql security invoker set search_path='' as $$ select private.jgc_finalize_job_board_upload(p_document_id) $$;
create function public.review_job_board_document(p_document_id uuid,p_status text,p_visibility text) returns jsonb language sql security invoker set search_path='' as $$ select private.jgc_review_job_board_document(p_document_id,p_status,p_visibility) $$;
create function public.update_job_board_document(p_document_id uuid,p_title text,p_report_date date,p_category text,p_notes text) returns jsonb language sql security invoker set search_path='' as $$ select private.jgc_update_job_board_document(p_document_id,p_title,p_report_date,p_category,p_notes) $$;
create function public.configure_job_board(p_board_id uuid,p_enabled boolean,p_rotate_token boolean) returns jsonb language sql security invoker set search_path='' as $$ select private.jgc_configure_job_board(p_board_id,p_enabled,p_rotate_token) $$;
create function public.grant_job_board_viewer(p_board_id uuid,p_email text) returns jsonb language sql security invoker set search_path='' as $$ select private.jgc_grant_job_board_viewer(p_board_id,p_email) $$;
create function public.revoke_job_board_viewer(p_board_id uuid,p_viewer_id uuid) returns jsonb language sql security invoker set search_path='' as $$ select private.jgc_revoke_job_board_viewer(p_board_id,p_viewer_id) $$;
create function public.resolve_job_board_download(p_token text,p_visit_token uuid,p_document_id uuid) returns jsonb language sql security invoker set search_path='' as $$ select private.jgc_resolve_job_board_download(p_token,p_visit_token,p_document_id) $$;
create function public.log_job_board_activity(p_token text,p_visit_token uuid,p_action text,p_document_id uuid) returns jsonb language sql security invoker set search_path='' as $$ select private.jgc_log_job_board_activity(p_token,p_visit_token,p_action,p_document_id) $$;
create function public.get_job_board_activity(p_board_id uuid,p_before timestamptz default null,p_limit integer default 50) returns jsonb language sql security invoker set search_path='' as $$ select private.jgc_get_job_board_activity(p_board_id,p_before,p_limit) $$;
create function public.attach_job_board_report(p_token text,p_visit_token uuid,p_source_type text,p_source_id uuid) returns jsonb language sql security invoker set search_path='' as $$ select private.jgc_attach_job_board_report(p_token,p_visit_token,p_source_type,p_source_id) $$;

create function public.attach_job_board_report_by_id(p_board_id uuid,p_source_type text,p_source_id uuid) returns jsonb language sql security invoker set search_path='' as $$ select private.jgc_attach_job_board_report_by_id(p_board_id,p_source_type,p_source_id) $$;

-- Explicit deny-first privileges; grant only API wrappers and the exact private functions they invoke.
do $$ declare f record; begin
  for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname='private' and p.proname like 'jgc_%job_board%') or (n.nspname='public' and p.proname in ('get_or_create_job_board','get_job_board','register_job_board_visit','begin_job_board_upload','finalize_job_board_upload','review_job_board_document','update_job_board_document','configure_job_board','grant_job_board_viewer','revoke_job_board_viewer','resolve_job_board_download','log_job_board_activity','get_job_board_activity','attach_job_board_report','attach_job_board_report_by_id')) loop
    execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  end loop;
end $$;
grant execute on function private.jgc_get_or_create_job_board(text),public.get_or_create_job_board(text),private.jgc_begin_job_board_upload(uuid,text,text,date,text,text,bigint,text),public.begin_job_board_upload(uuid,text,text,date,text,text,bigint,text),private.jgc_finalize_job_board_upload(uuid),public.finalize_job_board_upload(uuid),private.jgc_review_job_board_document(uuid,text,text),public.review_job_board_document(uuid,text,text),private.jgc_update_job_board_document(uuid,text,date,text,text),public.update_job_board_document(uuid,text,date,text,text),private.jgc_configure_job_board(uuid,boolean,boolean),public.configure_job_board(uuid,boolean,boolean),private.jgc_grant_job_board_viewer(uuid,text),public.grant_job_board_viewer(uuid,text),private.jgc_revoke_job_board_viewer(uuid,uuid),public.revoke_job_board_viewer(uuid,uuid),private.jgc_get_job_board_activity(uuid,timestamptz,integer),public.get_job_board_activity(uuid,timestamptz,integer),private.jgc_job_board_storage_upload(text),private.jgc_job_board_storage_read(text) to authenticated;
grant execute on function private.jgc_get_job_board(text,uuid),public.get_job_board(text,uuid),private.jgc_register_job_board_visit(text,text,text,text),public.register_job_board_visit(text,text,text,text),private.jgc_resolve_job_board_download(text,uuid,uuid),public.resolve_job_board_download(text,uuid,uuid),private.jgc_log_job_board_activity(text,uuid,text,uuid),public.log_job_board_activity(text,uuid,text,uuid) to anon,authenticated;
grant execute on function private.jgc_attach_job_board_report(text,uuid,text,uuid),public.attach_job_board_report(text,uuid,text,uuid) to authenticated;
grant execute on function private.jgc_attach_job_board_report_by_id(uuid,text,uuid),public.attach_job_board_report_by_id(uuid,text,uuid) to authenticated;
commit;
