-- Publish only after the existing upload ownership and Storage checks succeed.
-- Keep older pending documents pending and preserve the existing access rules.
do $migration$
declare
  definition text := pg_get_functiondef('private.jgc_finalize_job_board_upload(uuid)'::regprocedure);
  original text := definition;
begin
  if position($old$if d.status='pending' then return jsonb_build_object('id',d.id,'status',d.status); end if;$old$ in definition) = 0
     or position($old$update public.job_board_documents set status='pending',updated_at=clock_timestamp() where id=d.id;$old$ in definition) = 0
     or position($old$return jsonb_build_object('id',d.id,'status','pending');$old$ in definition) = 0 then
    raise exception 'Upload finalizer differs from the audited version; review before applying';
  end if;
  definition := replace(definition, $old$if d.status='pending' then return jsonb_build_object('id',d.id,'status',d.status); end if;$old$, $new$if d.status in ('pending','published') then return jsonb_build_object('id',d.id,'status',d.status); end if;$new$);
  definition := replace(definition, $old$update public.job_board_documents set status='pending',updated_at=clock_timestamp() where id=d.id;$old$, $new$update public.job_board_documents set status='published',visibility=case when d.category='accident-incident' or d.is_sensitive then 'restricted' else d.visibility end,updated_at=clock_timestamp() where id=d.id;$new$);
  definition := replace(definition, $old$return jsonb_build_object('id',d.id,'status','pending');$old$, $new$return jsonb_build_object('id',d.id,'status','published');$new$);
  if definition = original then raise exception 'Upload finalizer was not updated'; end if;
  execute definition;
end
$migration$;
