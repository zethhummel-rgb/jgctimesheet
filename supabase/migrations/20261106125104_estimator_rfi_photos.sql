create table public.estimator_rfi_photos (
  id uuid primary key,
  rfi_id uuid not null,
  position smallint not null default 0 check (position between 0 and 7),
  name text not null check (char_length(name) between 1 and 200),
  jpeg text not null check (length(jpeg) between 4 and 4000000 and left(jpeg,4) = '/9j/'),
  created_at timestamptz not null default now()
);
create index estimator_rfi_photos_rfi_idx on public.estimator_rfi_photos(rfi_id, created_at, id);
alter table public.estimator_rfi_photos enable row level security;
revoke all on public.estimator_rfi_photos from public, anon, authenticated;
grant select, insert, delete on public.estimator_rfi_photos to authenticated;
create policy rfi_photos_admin on public.estimator_rfi_photos for all to authenticated
using ((select public.is_admin()) and (select private.jgc_has_full_portal_access()))
with check ((select public.is_admin()) and (select private.jgc_has_full_portal_access()));

create function private.require_saved_rfi_for_photo() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not exists (
    select 1 from public.estimator_workspaces w
    cross join lateral jsonb_array_elements(w.payload->'jobs') j
    cross join lateral jsonb_array_elements(case when jsonb_typeof(j->'rfis')='array' then j->'rfis' else '[]'::jsonb end) r
    where w.id = 'main' and r->>'id' = new.rfi_id::text
  ) then raise exception 'Wait for the RFI to finish saving.' using errcode = '40001';
  end if;
  return new;
end;
$$;
revoke all on function private.require_saved_rfi_for_photo() from public, anon, authenticated;
create trigger require_saved_rfi_for_photo before insert on public.estimator_rfi_photos
for each row execute function private.require_saved_rfi_for_photo();
