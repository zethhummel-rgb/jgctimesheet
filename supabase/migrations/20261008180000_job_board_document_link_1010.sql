-- Release 1010 (Zeth, 2026-10-08): the Job Board shows the job's drawings/documents link (jobs.document_link, the
-- same link as on the Portal Jobs page) to anyone signed in to that board, staff and visitors alike. Someone who
-- has only scanned the QR code doesn't receive it, and only https links are passed on.

create or replace function pg_temp.jgc_patch(def text, pattern text, replacement text, expected int)
returns text language plpgsql as $f$
declare found int;
begin
  select count(*) into found from regexp_matches(def, pattern, 'g');
  if found <> expected then
    raise exception 'Expected % match(es) of %, found %', expected, pattern, found;
  end if;
  return regexp_replace(def, pattern, replacement, 'g');
end $f$;

create or replace function private.jgc_job_board_document_link(p_portal_job_id uuid)
returns jsonb language sql stable security definer set search_path to '' as $f$
  select jsonb_build_object('url', trim(j.document_link), 'label', coalesce(nullif(trim(j.document_link_label), ''), 'Drawings & documents'))
  from public.jobs j
  where j.id = p_portal_job_id and trim(coalesce(j.document_link, '')) ~* '^https://[^[:space:]]+$'
$f$;
revoke all on function private.jgc_job_board_document_link(uuid) from public, anon, authenticated;

do $do$
declare def text;
begin
  def := pg_get_functiondef('private.jgc_job_board_model(uuid,uuid)'::regprocedure);
  def := pg_temp.jgc_patch(def, '''visit_expires_at'',s\.expires_at\);',
    '''visit_expires_at'',s.expires_at,''document_link'',case when registered then private.jgc_job_board_document_link(b.portal_job_id) end);', 1);
  execute def;
end $do$;
