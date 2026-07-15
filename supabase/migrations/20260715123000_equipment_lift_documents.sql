create table if not exists public.equipment_documents (
  id uuid primary key default gen_random_uuid(),
  equipment_id uuid not null references public.equipment_vehicles(id) on delete cascade,
  document_type text not null check (document_type in ('manual', 'yearly_inspection')),
  file_name text not null,
  storage_path text not null unique,
  uploaded_by uuid references auth.users(id) on delete set null,
  uploaded_by_name text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists equipment_documents_equipment_idx
  on public.equipment_documents (equipment_id, document_type, created_at desc)
  where is_active = true;

create unique index if not exists equipment_documents_active_yearly_idx
  on public.equipment_documents (equipment_id)
  where document_type = 'yearly_inspection' and is_active = true;

alter table public.equipment_documents enable row level security;

revoke all on public.equipment_documents from public, anon;
grant select, insert, update, delete on public.equipment_documents to authenticated;

drop policy if exists "Admins can manage equipment documents" on public.equipment_documents;
create policy "Admins can manage equipment documents"
on public.equipment_documents
for all
to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'equipment-documents',
  'equipment-documents',
  false,
  26214400,
  array['application/pdf']::text[]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create schema if not exists jgc_private;
revoke all on schema jgc_private from public;
grant usage on schema jgc_private to anon, authenticated;

create or replace function jgc_private.equipment_document_storage_can_read(p_object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.equipment_documents d
    join public.equipment_vehicles e on e.id = d.equipment_id
    where d.storage_path = p_object_name
      and d.is_active = true
      and e.is_active = true
      and nullif(e.inspection_qr_token, '') = (storage.foldername(p_object_name))[1]
  );
$$;

revoke all on function jgc_private.equipment_document_storage_can_read(text) from public;
grant execute on function jgc_private.equipment_document_storage_can_read(text) to anon, authenticated;

drop policy if exists "Admins can upload equipment documents" on storage.objects;
create policy "Admins can upload equipment documents"
on storage.objects
for insert
to authenticated
with check (bucket_id = 'equipment-documents' and (select public.is_admin()));

drop policy if exists "Admins can read equipment documents" on storage.objects;
create policy "Admins can read equipment documents"
on storage.objects
for select
to authenticated
using (bucket_id = 'equipment-documents' and (select public.is_admin()));

drop policy if exists "Admins can update equipment documents" on storage.objects;
create policy "Admins can update equipment documents"
on storage.objects
for update
to authenticated
using (bucket_id = 'equipment-documents' and (select public.is_admin()))
with check (bucket_id = 'equipment-documents' and (select public.is_admin()));

drop policy if exists "Admins can delete equipment documents" on storage.objects;
create policy "Admins can delete equipment documents"
on storage.objects
for delete
to authenticated
using (bucket_id = 'equipment-documents' and (select public.is_admin()));

drop policy if exists "QR scans can read equipment documents" on storage.objects;
create policy "QR scans can read equipment documents"
on storage.objects
for select
to anon, authenticated
using (
  bucket_id = 'equipment-documents'
  and storage.allow_any_operation(array['object.get_authenticated_info', 'object.get_authenticated', 'object.sign'])
  and jgc_private.equipment_document_storage_can_read(name)
);

create or replace function public.get_public_equipment_documents(p_token text)
returns table (
  document_id uuid,
  document_type text,
  file_name text,
  storage_path text,
  uploaded_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    d.id,
    d.document_type,
    d.file_name,
    d.storage_path,
    d.created_at
  from public.equipment_documents d
  join public.equipment_vehicles e on e.id = d.equipment_id
  where nullif(trim(p_token), '') is not null
    and e.inspection_qr_token = trim(p_token)
    and e.is_active = true
    and d.is_active = true
  order by
    case d.document_type when 'yearly_inspection' then 1 else 2 end,
    d.created_at desc;
$$;

revoke all on function public.get_public_equipment_documents(text) from public, anon, authenticated;
grant execute on function public.get_public_equipment_documents(text) to anon, authenticated;
