-- Public QR safety documents and the signed-in attendance roster.
-- Publish only reviewed safety files. Saved report sources must never become
-- public by being assigned to a safety category.
create function private.jgc_qr_safety_documents(p_board_id uuid)
returns setof public.job_board_documents
language sql stable security invoker set search_path = ''
as $$
  select d.*
  from public.job_board_documents d
  where d.board_id = p_board_id
    and d.status = 'published'
    and d.visibility = 'public'
    and d.is_sensitive is not true
    and d.source_type is null
    and d.category in ('notice-of-project', 'ontario-legislation', 'hs-documents', 'site-specific', 'sds', 'jgc-policy')
  union all
  select policy.*
  from private.jgc_job_board_policy_document(p_board_id, private.jgc_job_board_current_policy()) policy
  where policy.id is not null;
$$;

create function private.jgc_get_job_board_public_safety(p_token text)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  board_id uuid;
begin
  select b.id into board_id from public.job_boards b where b.token = p_token and b.enabled;
  if board_id is null then
    raise exception 'Job Board unavailable' using errcode = '42501';
  end if;

  return jsonb_build_object('documents', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', d.id, 'title', d.title, 'category', d.category, 'status', d.status,
      'visibility', d.visibility, 'report_date', d.report_date, 'created_at', d.created_at,
      'file_name', d.file_name, 'mime_type', d.mime_type, 'file_size', d.file_size
    ) order by d.report_date desc, d.created_at desc, d.id)
    from private.jgc_qr_safety_documents(board_id) d
  ), '[]'::jsonb));
end;
$$;

create function public.get_job_board_public_safety(p_token text)
returns jsonb
language sql stable security invoker set search_path = ''
as $$ select private.jgc_get_job_board_public_safety(p_token) $$;

-- The existing document Edge Function signs storage URLs only for a document
-- resolved by this caller-scoped RPC. Preserve the original signed-in audit.
create or replace function private.jgc_resolve_job_board_download(p_token text, p_visit_token uuid, p_document_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  board public.job_boards;
  visitor public.job_board_visitor_sessions;
  doc public.job_board_documents;
  model jsonb;
begin
  select b.* into board from public.job_boards b where b.token = p_token;
  if board.id is null then
    raise exception 'Job Board unavailable' using errcode = '42501';
  end if;
  visitor := private.jgc_job_board_visit(board.id, p_visit_token);
  if private.jgc_job_board_admin() or visitor.id is not null then
    model := private.jgc_resolve_job_board_download_full_1014(p_token,p_visit_token,p_document_id);
    if private.jgc_job_board_staff() then return model; end if;
    return private.jgc1014_public_safety_model(model);
  end if;

  if not board.enabled then
    raise exception 'Job Board unavailable' using errcode = '42501';
  end if;
  select d.* into doc from private.jgc_qr_safety_documents(board.id) d where d.id = p_document_id;
  if doc.id is null then
    raise exception 'Document unavailable' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'id', doc.id, 'board_id', doc.board_id, 'object_path', doc.object_path,
    'file_name', doc.file_name, 'mime_type', doc.mime_type,
    'source_type', doc.source_type,
    'source_payload', case when doc.source_type = 'policies'
      then jsonb_build_object('file_path',doc.object_path) end
  );
end;
$$;

create function private.jgc_job_board_roster_for_day(p_board_id uuid, p_date date)
returns jsonb
language sql stable security invoker set search_path = ''
as $$
  select coalesce(jsonb_agg(to_jsonb(person) order by person.first_at, person.name), '[]'::jsonb)
  from (
    select min(a.actor_name) as name,
           min(a.actor_company) as company,
           min(a.created_at) as first_at,
           max(a.created_at) as last_at,
           count(*)::integer as count,
           bool_or(a.identity_type = 'staff' and a.actor_profile_id is not null) as staff,
           bool_or(c.event_id is not null) as confirmed
    from public.job_board_activity a
    left join private.jgc_site_signin_confirmations c on c.event_id = a.id
    where a.board_id = p_board_id
      and a.action = 'site-signin'
      and a.created_at >= (p_date::timestamp at time zone 'America/Toronto')
      and a.created_at < ((p_date + 1)::timestamp at time zone 'America/Toronto')
    group by a.actor_profile_id, lower(btrim(a.actor_name)), lower(btrim(a.actor_company))
  ) person;
$$;

create or replace function private.jgc_get_job_board_onsite_today(p_token text)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  board_id uuid;
  today date := (now() at time zone 'America/Toronto')::date;
begin
  if not private.jgc_job_board_staff() then
    raise exception 'Sign in with your JGC account to see who is on site' using errcode = '42501';
  end if;
  select b.id into board_id from public.job_boards b where b.token = p_token and b.enabled;
  if board_id is null then
    raise exception 'Job Board unavailable' using errcode = '42501';
  end if;
  return jsonb_build_object('date', today, 'people', private.jgc_job_board_roster_for_day(board_id,today));
end;
$$;

create function private.jgc_get_job_board_site_roster(p_token text, p_visit_token uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  board_id uuid;
  visitor public.job_board_visitor_sessions;
  today date := (now() at time zone 'America/Toronto')::date;
begin
  select b.id into board_id from public.job_boards b where b.token = p_token and b.enabled;
  if board_id is null then
    raise exception 'Job Board unavailable' using errcode = '42501';
  end if;
  visitor := private.jgc_job_board_visit(board_id,p_visit_token);
  if visitor.id is null then
    raise exception 'Sign in to this Job Board to see who is on site' using errcode = '42501';
  end if;
  return jsonb_build_object('date', today, 'people', private.jgc_job_board_roster_for_day(board_id,today));
end;
$$;

create function public.get_job_board_site_roster(p_token text, p_visit_token uuid)
returns jsonb
language sql stable security invoker set search_path = ''
as $$ select private.jgc_get_job_board_site_roster(p_token,p_visit_token) $$;

revoke all on function private.jgc_qr_safety_documents(uuid), private.jgc_job_board_roster_for_day(uuid,date)
  from public, anon, authenticated;
revoke all on function private.jgc_get_job_board_public_safety(text), public.get_job_board_public_safety(text),
  private.jgc_get_job_board_site_roster(text,uuid), public.get_job_board_site_roster(text,uuid)
  from public, anon, authenticated;
grant execute on function private.jgc_get_job_board_public_safety(text), public.get_job_board_public_safety(text),
  private.jgc_get_job_board_site_roster(text,uuid), public.get_job_board_site_roster(text,uuid)
  to anon, authenticated;
