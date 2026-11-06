create or replace function private.require_saved_rfi_for_photo() returns trigger
language plpgsql set search_path = '' as $$
begin
  perform 1 from public.estimator_workspaces where id='main' for share;
  if not exists (
    select 1 from public.estimator_workspaces w
    cross join lateral jsonb_array_elements(w.payload->'jobs') j
    cross join lateral jsonb_array_elements(case when jsonb_typeof(j->'rfis')='array' then j->'rfis' else '[]'::jsonb end) r
    where w.id = 'main' and r->>'id' = new.rfi_id::text and nullif(r->>'deletedAt','') is null
  ) then raise exception 'Wait for the RFI to finish saving.' using errcode = '40001';
  end if;
  return new;
end;
$$;

create function private.clear_deleted_rfi_photos() returns trigger
language plpgsql set search_path = '' as $$
begin
  if exists(select from public.estimator_rfi_photos) then
    delete from public.estimator_rfi_photos photos using
      jsonb_array_elements(new.payload->'jobs') j,
      lateral jsonb_array_elements(case when jsonb_typeof(j->'rfis')='array' then j->'rfis' else '[]'::jsonb end) r
    where r->>'id'=photos.rfi_id::text and nullif(r->>'deletedAt','') is not null;
  end if;
  return new;
end;
$$;
revoke all on function private.clear_deleted_rfi_photos() from public, anon, authenticated;
create trigger clear_deleted_rfi_photos after update of payload on public.estimator_workspaces
for each row when (new.id='main') execute function private.clear_deleted_rfi_photos();
