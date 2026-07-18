begin;

alter table public.certificates enable row level security;
alter table public.inspection_records enable row level security;
alter table public.toolbox_talk_assignments enable row level security;

drop policy if exists "Public can delete certificates" on public.certificates;
drop policy if exists "Anyone can delete inspection records" on public.inspection_records;
drop policy if exists "Toolbox assignments are deleteable" on public.toolbox_talk_assignments;
drop policy if exists "Public can delete certificate files" on storage.objects;

revoke delete on table public.certificates from public, anon;
revoke delete on table public.inspection_records from public, anon;
revoke delete on table public.toolbox_talk_assignments from public, anon;

grant delete on table public.certificates to authenticated;
grant delete on table public.inspection_records to authenticated;
grant delete on table public.toolbox_talk_assignments to authenticated;

create policy "Approved admins can delete certificates"
on public.certificates
for delete
to authenticated
using ((select public.is_admin()));

create policy "Approved admins can delete inspection records"
on public.inspection_records
for delete
to authenticated
using ((select public.is_admin()));

create policy "Approved admins can delete toolbox assignments"
on public.toolbox_talk_assignments
for delete
to authenticated
using ((select public.is_admin()));

create policy "Approved admins can delete certificate files"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'certificates'
  and (select public.is_admin())
);

commit;
