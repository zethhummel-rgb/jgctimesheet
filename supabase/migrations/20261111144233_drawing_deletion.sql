begin;

alter table public.job_drawings add column deleting_at timestamptz;
alter policy "job drawings admin insert" on public.job_drawings
  with check ((select private.shop_transmittal_access()) and created_by = (select auth.uid())
    and revision = 1 and deleting_at is null);
alter policy "job drawings admin update" on public.job_drawings
  using ((select private.shop_transmittal_access()) and deleting_at is null)
  with check ((select private.shop_transmittal_access()) and deleting_at is null);

create index job_drawings_delete_path on public.job_drawings (object_path) where deleting_at is not null;
create policy "job drawings original delete" on storage.objects for delete to authenticated
  using (bucket_id = 'job-drawings' and (select private.shop_transmittal_access()) and exists (
    select 1 from public.job_drawings d where d.object_path = name and d.deleting_at is not null
  ));

create table private.shop_drawing_deletions (
  job_id text not null,
  drawing_id text not null,
  primary key (job_id, drawing_id)
);
alter table private.shop_drawing_deletions enable row level security;
revoke all on private.shop_drawing_deletions from public, anon, authenticated;

-- Serialize reservations and file uploads with deletion of this shop drawing.
create function private.lock_shop_drawing(job_key text, drawing_key text)
returns void language sql set search_path = '' as $$
  select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(jsonb_build_array(job_key, drawing_key)::text, 0))
$$;
revoke all on function private.lock_shop_drawing(text,text) from public, anon, authenticated;

create function private.prevent_deleted_shop_drawing_reservation()
returns trigger language plpgsql set search_path = '' as $$
begin
  perform private.lock_shop_drawing(new.job_id, new.drawing_id);
  if exists (select 1 from private.shop_drawing_deletions
    where job_id = new.job_id and drawing_id = new.drawing_id) then
    raise exception 'This shop drawing is being deleted.' using errcode = '40001';
  end if;
  return new;
end
$$;
revoke all on function private.prevent_deleted_shop_drawing_reservation() from public, anon, authenticated;
create trigger prevent_deleted_shop_drawing_reservation before insert on private.shop_drawing_transmittals
for each row execute function private.prevent_deleted_shop_drawing_reservation();

create or replace function private.shop_transmittal_object_allowed(object_name text, operation text)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare
  entry private.shop_drawing_transmittals;
  removing boolean;
begin
  if not coalesce(private.shop_transmittal_access(), false)
    or object_name !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.pdf$' then return false; end if;
  select * into entry from private.shop_drawing_transmittals where id = left(object_name, 36)::uuid;
  if not found then return false; end if;
  if operation = 'upload' then
    perform private.lock_shop_drawing(entry.job_id, entry.drawing_id);
    select * into entry from private.shop_drawing_transmittals where id = left(object_name, 36)::uuid;
    if not found then return false; end if;
  end if;
  select exists (select 1 from private.shop_drawing_deletions
    where job_id = entry.job_id and drawing_id = entry.drawing_id) into removing;
  return case operation
    when 'read' then removing or entry.ready_at is not null or entry.created_by = auth.uid()
    when 'upload' then not removing and entry.created_by = auth.uid() and entry.ready_at is null and entry.abandoned_at is null
    when 'delete' then removing or entry.downloaded_at is not null or (entry.abandoned_at is not null and entry.created_by = auth.uid())
    else false
  end;
end
$$;

create function private.manage_drawing_deletion(
  target text, action text, job_key text, drawing_key text, expected text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  drawing public.job_drawings;
  shop_drawing jsonb;
  paths jsonb;
begin
  if not coalesce(private.shop_transmittal_access(), false) then
    raise exception 'Approved administrator access is required.' using errcode = '42501';
  end if;
  if action is null or action not in ('prepare', 'finish') then
    raise exception 'Unsupported drawing deletion action.' using errcode = '22023';
  end if;

  if target = 'drawing' then
    select * into drawing from public.job_drawings where id = drawing_key::uuid and job_id = job_key for update;
    if not found then
      if action = 'finish' then return '[]'::jsonb; end if;
      raise exception 'This drawing could not be found.' using errcode = '40001';
    end if;
    if action = 'prepare' then
      if drawing.deleting_at is null then
        if drawing.revision::text is distinct from expected then
          raise exception 'This drawing changed. Refresh drawings before deleting it.' using errcode = '40001';
        end if;
        update public.job_drawings set deleting_at = now(), revision = revision + 1 where id = drawing.id;
      end if;
      select coalesce(jsonb_agg(o.name), '[]'::jsonb) into paths from storage.objects o
        where o.bucket_id = 'job-drawings' and o.name = drawing.object_path;
      return paths;
    end if;
    if drawing.deleting_at is null or exists (select 1 from storage.objects o
      where o.bucket_id = 'job-drawings' and o.name = drawing.object_path) then
      raise exception 'The original PDF has not been cleared. Finish deleting the drawing to retry.' using errcode = '40001';
    end if;
    delete from public.job_drawings where id = drawing.id;
    return '[]'::jsonb;
  end if;

  if target <> 'shop' or target is null then
    raise exception 'Unsupported drawing type.' using errcode = '22023';
  end if;
  perform private.lock_shop_drawing(job_key, drawing_key);
  if action = 'prepare' then
    select item into shop_drawing
    from public.estimator_workspaces w
    cross join lateral jsonb_array_elements(w.payload->'jobs') j
    cross join lateral jsonb_array_elements(coalesce(j->'shopDrawings', '[]'::jsonb)) item
    where w.id = 'main' and j->>'id' = job_key and item->>'id' = drawing_key for share of w;
    if shop_drawing is null or coalesce(shop_drawing->>'updatedAt', shop_drawing->>'createdAt', '') is distinct from expected then
      raise exception 'This shop drawing changed. Refresh the job before deleting it.' using errcode = '40001';
    end if;
    insert into private.shop_drawing_deletions values (job_key, drawing_key) on conflict do nothing;
  elsif not exists (select 1 from private.shop_drawing_deletions where job_id = job_key and drawing_id = drawing_key) then
    raise exception 'Start the shop drawing deletion before clearing its history.' using errcode = '40001';
  end if;

  select coalesce(jsonb_agg(o.name), '[]'::jsonb) into paths
  from private.shop_drawing_transmittals t
  join storage.objects o on o.bucket_id = 'shop-drawing-transmittals' and o.name = t.id::text || '.pdf'
  where t.job_id = job_key and t.drawing_id = drawing_key;
  if action = 'prepare' then return paths; end if;
  if jsonb_array_length(paths) > 0 then
    raise exception 'A transmittal PDF has not been cleared. Retry deleting the shop drawing.' using errcode = '40001';
  end if;
  delete from private.shop_drawing_transmittals where job_id = job_key and drawing_id = drawing_key;
  return '[]'::jsonb;
end
$$;
revoke all on function private.manage_drawing_deletion(text,text,text,text,text) from public, anon, authenticated;
grant execute on function private.manage_drawing_deletion(text,text,text,text,text) to authenticated;

create function public.manage_drawing_deletion(target text, action text, job_key text, drawing_key text, expected text)
returns jsonb language sql set search_path = '' as $$
  select private.manage_drawing_deletion(target, action, job_key, drawing_key, expected)
$$;
revoke all on function public.manage_drawing_deletion(text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.manage_drawing_deletion(text,text,text,text,text) to authenticated;

commit;
