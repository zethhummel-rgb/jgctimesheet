-- REVIEW COPY: requires Zeth's specific approval before production application.
-- Private shared Job Drawings: approved admins only, immutable PDF originals.
begin;
create table public.job_drawings (
  id uuid primary key default gen_random_uuid(),
  job_id text not null check (length(job_id) between 1 and 200),
  title text not null check (length(title) between 1 and 500),
  file_name text not null check (length(file_name) between 1 and 500),
  object_path text generated always as (id::text || '/original.pdf') stored,
  content jsonb not null default '{"version":1,"marks":[],"scales":{}}'::jsonb
    check (jsonb_typeof(content)='object' and content->>'version'='1' and jsonb_typeof(content->'marks')='array' and jsonb_typeof(content->'scales')='object' and octet_length(content::text)<=2097152),
  revision integer not null default 1 check (revision>0),
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index job_drawings_job_created on public.job_drawings(job_id,created_at desc);
alter table public.job_drawings enable row level security;
revoke all on public.job_drawings from anon, authenticated;
grant select,insert,update on public.job_drawings to authenticated;
create policy "job drawings admin select" on public.job_drawings for select to authenticated using ((select public.is_admin()) and (select private.jgc_has_full_portal_access()));
create policy "job drawings admin insert" on public.job_drawings for insert to authenticated with check ((select public.is_admin()) and (select private.jgc_has_full_portal_access()) and created_by=(select auth.uid()) and revision=1);
create policy "job drawings admin update" on public.job_drawings for update to authenticated using ((select public.is_admin()) and (select private.jgc_has_full_portal_access())) with check ((select public.is_admin()) and (select private.jgc_has_full_portal_access()));
create function private.jgc_drawing_update_guard() returns trigger language plpgsql set search_path=pg_catalog as $$
begin
  if new.id <> old.id or new.job_id <> old.job_id or new.file_name <> old.file_name or new.created_by <> old.created_by or new.created_at <> old.created_at then raise exception 'Drawing source identity is immutable'; end if;
  if new.revision <> old.revision+1 then raise exception 'Drawing revision must increase by one'; end if;
  new.updated_at := now(); return new;
end;
$$;
revoke all on function private.jgc_drawing_update_guard() from public,anon,authenticated;
create trigger job_drawings_update_guard before update on public.job_drawings for each row execute function private.jgc_drawing_update_guard();
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('job-drawings','job-drawings',false,26214400,array['application/pdf']);
create policy "job drawings original upload" on storage.objects for insert to authenticated with check (bucket_id='job-drawings' and (select public.is_admin()) and (select private.jgc_has_full_portal_access()) and name ~ '^[0-9a-f-]{36}/original[.]pdf$');
create policy "job drawings original read" on storage.objects for select to authenticated using (bucket_id='job-drawings' and (select public.is_admin()) and (select private.jgc_has_full_portal_access()));
-- No update/delete policies on originals; no public URLs or service-role keys.
commit;
