begin;

create table private.shop_drawing_transmittals (
  id uuid primary key,
  job_id text not null check (length(job_id) between 1 and 200),
  drawing_id text not null check (length(drawing_id) between 1 and 200),
  revision integer not null check (revision >= 0),
  drawing_updated_at text not null check (length(drawing_updated_at) <= 60),
  reference text not null check (length(reference) between 1 and 100),
  filename text not null check (length(filename) between 5 and 180 and right(filename, 4) = '.pdf'),
  source_name text not null check (length(source_name) between 1 and 250),
  recipient text not null check (length(trim(recipient)) between 1 and 180),
  reviewer text not null check (length(trim(reviewer)) between 1 and 120),
  review_status text not null check (review_status in ('Reviewed', 'Reviewed as noted', 'Revise and resubmit', 'For record only')),
  review_date date not null,
  transmittal_date date not null,
  notes text not null default '' check (length(notes) <= 1500),
  page_count integer not null check (page_count between 1 and 1000),
  stamped_pages integer[] not null check (
    cardinality(stamped_pages) between 1 and page_count
    and array_position(stamped_pages, null) is null
    and 1 <= all(stamped_pages) and page_count >= all(stamped_pages)
  ),
  byte_count integer not null check (byte_count between 1 and 52428800),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  ready_at timestamptz,
  downloaded_at timestamptz,
  abandoned_at timestamptz,
  check (downloaded_at is null or ready_at is not null),
  check (abandoned_at is null or ready_at is null)
);

alter table private.shop_drawing_transmittals enable row level security;
revoke all on private.shop_drawing_transmittals from public, anon, authenticated;
create index shop_drawing_transmittals_register_idx
  on private.shop_drawing_transmittals (job_id, drawing_id, created_at desc);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('shop-drawing-transmittals', 'shop-drawing-transmittals', false, 52428800, array['application/pdf']);

create function private.shop_transmittal_access()
returns boolean language sql stable set search_path = '' as $$
  select auth.uid() is not null and public.is_admin() and private.jgc_has_full_portal_access()
$$;
revoke all on function private.shop_transmittal_access() from public, anon, authenticated;
grant execute on function private.shop_transmittal_access() to authenticated;

create function private.shop_transmittal_object_allowed(object_name text, operation text)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.shop_transmittal_access() and exists (
    select 1 from private.shop_drawing_transmittals t
    where t.id = case
      when object_name ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.pdf$'
      then left(object_name, 36)::uuid
    end
    and case operation
      when 'read' then t.ready_at is not null or t.created_by = auth.uid()
      when 'upload' then t.created_by = auth.uid() and t.ready_at is null and t.abandoned_at is null
      when 'delete' then t.downloaded_at is not null or (t.abandoned_at is not null and t.created_by = auth.uid())
      else false
    end
  )
$$;
revoke all on function private.shop_transmittal_object_allowed(text, text) from public, anon, authenticated;
grant execute on function private.shop_transmittal_object_allowed(text, text) to authenticated;

create policy shop_transmittal_pdf_read on storage.objects for select to authenticated
using (bucket_id = 'shop-drawing-transmittals' and private.shop_transmittal_object_allowed(name, 'read'));
create policy shop_transmittal_pdf_upload on storage.objects for insert to authenticated
with check (bucket_id = 'shop-drawing-transmittals' and private.shop_transmittal_object_allowed(name, 'upload'));
create policy shop_transmittal_pdf_delete on storage.objects for delete to authenticated
using (bucket_id = 'shop-drawing-transmittals' and private.shop_transmittal_object_allowed(name, 'delete'));

create function private.shop_transmittal_summary(t private.shop_drawing_transmittals)
returns jsonb language sql stable set search_path = '' as $$
  select (to_jsonb(t) - 'created_by' - 'drawing_updated_at') || jsonb_build_object('has_pdf', exists (
    select 1 from storage.objects o
    where o.bucket_id = 'shop-drawing-transmittals' and o.name = t.id::text || '.pdf'
  ))
$$;
revoke all on function private.shop_transmittal_summary(private.shop_drawing_transmittals) from public, anon, authenticated;

create function private.manage_shop_transmittal(
  operation text, transmittal_id uuid, job_key text, drawing_key text, details jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  entry private.shop_drawing_transmittals;
  drawing jsonb;
begin
  if not coalesce(private.shop_transmittal_access(), false) then
    raise exception 'Approved administrator access is required.' using errcode = '42501';
  end if;

  if operation = 'list' then
    return coalesce((
      select jsonb_agg(private.shop_transmittal_summary(t) order by t.created_at desc, t.id)
      from private.shop_drawing_transmittals t
      where t.job_id = job_key and t.drawing_id = drawing_key
        and (t.ready_at is not null or t.created_by = auth.uid())
    ), '[]'::jsonb);
  end if;

  select * into entry from private.shop_drawing_transmittals
    where id = transmittal_id and job_id = job_key and drawing_id = drawing_key for update;

  if operation = 'reserve' and entry.id is null then
    select item into drawing
    from public.estimator_workspaces w
    cross join lateral jsonb_array_elements(case when jsonb_typeof(w.payload->'jobs') = 'array' then w.payload->'jobs' else '[]'::jsonb end) j
    cross join lateral jsonb_array_elements(case when jsonb_typeof(j->'shopDrawings') = 'array' then j->'shopDrawings' else '[]'::jsonb end) item
    where w.id = 'main' and j->>'id' = job_key and item->>'id' = drawing_key;

    if drawing is null or coalesce(drawing->>'revision', '0') <> details->>'revision'
      or (coalesce(drawing->>'updatedAt', drawing->>'createdAt', '') <> ''
        and coalesce(drawing->>'updatedAt', drawing->>'createdAt') <> details->>'drawing_updated_at') then
      raise exception 'The shop drawing changed. Reopen the current revision and review it again.' using errcode = '40001';
    end if;

    insert into private.shop_drawing_transmittals (
      id, job_id, drawing_id, revision, drawing_updated_at, reference, filename,
      source_name, recipient, reviewer, review_status, review_date, transmittal_date,
      notes, page_count, stamped_pages, byte_count, created_by
    ) values (
      transmittal_id, job_key, drawing_key, (details->>'revision')::integer,
      details->>'drawing_updated_at', details->>'reference', details->>'filename',
      details->>'source_name', trim(details->>'recipient'), trim(details->>'reviewer'),
      details->>'review_status', (details->>'review_date')::date, (details->>'transmittal_date')::date,
      coalesce(details->>'notes', ''), (details->>'page_count')::integer,
      array(select distinct value::integer from jsonb_array_elements_text(details->'stamped_pages') order by 1),
      (details->>'byte_count')::integer, auth.uid()
    ) on conflict (id) do nothing;

    select * into entry from private.shop_drawing_transmittals
      where id = transmittal_id and job_id = job_key and drawing_id = drawing_key for update;
  end if;

  if entry.id is null or (entry.ready_at is null and entry.created_by <> auth.uid()) then
    raise exception 'This transmittal could not be found.' using errcode = '42501';
  end if;

  case operation
    when 'reserve' then
      if entry.created_by <> auth.uid() or entry.abandoned_at is not null then
        raise exception 'Start a new transmittal to save this PDF.' using errcode = '42501';
      end if;
    when 'publish' then
      if entry.abandoned_at is not null or entry.created_by <> auth.uid() then
        raise exception 'This transmittal can no longer be saved.' using errcode = '42501';
      end if;
      if entry.ready_at is null then
        if not exists (
          select 1 from storage.objects o where o.bucket_id = 'shop-drawing-transmittals'
            and o.name = entry.id::text || '.pdf' and o.metadata->>'size' = entry.byte_count::text
        ) then raise exception 'The PDF upload has not finished.' using errcode = '40001'; end if;
        update private.shop_drawing_transmittals set ready_at = now()
          where id = entry.id returning * into entry;
      end if;
    when 'confirm' then
      if entry.ready_at is null then
        raise exception 'Save the transmittal before downloading it.' using errcode = '40001';
      end if;
      if entry.downloaded_at is null then
        update private.shop_drawing_transmittals set downloaded_at = now()
          where id = entry.id returning * into entry;
      end if;
    when 'discard' then
      if entry.ready_at is not null or entry.created_by <> auth.uid() then
        raise exception 'Only your unfinished transmittal can be discarded.' using errcode = '42501';
      end if;
      update private.shop_drawing_transmittals set abandoned_at = coalesce(abandoned_at, now())
        where id = entry.id returning * into entry;
    when 'forget' then
      if entry.abandoned_at is null or (private.shop_transmittal_summary(entry)->>'has_pdf')::boolean then
        raise exception 'Clear the unfinished PDF first.' using errcode = '40001';
      end if;
      delete from private.shop_drawing_transmittals where id = entry.id;
      return null;
    else
      raise exception 'Unsupported transmittal action.' using errcode = '22023';
  end case;

  return private.shop_transmittal_summary(entry);
end
$$;
revoke all on function private.manage_shop_transmittal(text, uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function private.manage_shop_transmittal(text, uuid, text, text, jsonb) to authenticated;

create function public.manage_shop_transmittal(
  operation text, transmittal_id uuid, job_key text, drawing_key text, details jsonb default '{}'::jsonb
)
returns jsonb language sql set search_path = '' as $$
  select private.manage_shop_transmittal(operation, transmittal_id, job_key, drawing_key, details)
$$;
revoke all on function public.manage_shop_transmittal(text, uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.manage_shop_transmittal(text, uuid, text, text, jsonb) to authenticated;

commit;
