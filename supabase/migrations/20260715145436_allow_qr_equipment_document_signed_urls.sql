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
