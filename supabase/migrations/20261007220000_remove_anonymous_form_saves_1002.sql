-- Release 1002: forms save only as a signed-in Portal account.
-- These anonymous permissions served the retired Subcontractor Access sign-in (release 1001). The public
-- QR flows (Job Board, safety acknowledgement QR, equipment QR) all go through SECURITY DEFINER functions
-- and never relied on them. Employees keep their own "Authenticated users can add ..." policies.

-- Form tables: no anonymous inserts.
drop policy if exists "Anonymous users can submit inspection records" on public.inspection_records;
drop policy if exists "Anonymous users can submit incident reports" on public.incident_reports;
drop policy if exists "Anonymous users can submit accident reports" on public.accident_reports;
drop policy if exists "Anonymous users can submit accident acknowledgements" on public.accident_report_acknowledgements;
drop policy if exists "Anonymous users can submit employee injury reports" on public.employee_injury_reports;
drop policy if exists "Anonymous users can submit employee injury acknowledgements" on public.employee_injury_acknowledgements;
drop policy if exists "Anonymous users can submit toolbox talk reports" on public.toolbox_talk_reports;
drop policy if exists "Anonymous users can submit toolbox attendance" on public.toolbox_talk_attendance;
drop policy if exists "Anonymous users can create pending safety acknowledgements" on public.safety_acknowledgements;

-- Toolbox talk list: approved accounts already read it through "Authenticated users can read toolbox talks".
drop policy if exists "Anonymous users can read active toolbox talks" on public.toolbox_talks;

-- Incident photos: same rules as before, for signed-in approved accounts only.
drop policy if exists "Incident photos uploadable" on storage.objects;
create policy "Incident photos uploadable" on storage.objects
for insert to authenticated
with check (bucket_id = 'incident-photos' and private.jgc_has_full_portal_access());

drop policy if exists "Incident photos readable by admins and new uploads" on storage.objects;
create policy "Incident photos readable by admins and new uploads" on storage.objects
for select to authenticated
using (bucket_id = 'incident-photos' and ((select public.is_admin()) or (created_at > now() - interval '10 minutes' and private.jgc_has_full_portal_access())));

drop policy if exists "Incident photos replaceable by admins and new uploads" on storage.objects;
create policy "Incident photos replaceable by admins and new uploads" on storage.objects
for update to authenticated
using (bucket_id = 'incident-photos' and ((select public.is_admin()) or (created_at > now() - interval '10 minutes' and private.jgc_has_full_portal_access())))
with check (bucket_id = 'incident-photos' and ((select public.is_admin()) or private.jgc_has_full_portal_access()));

-- Toolbox talk PDFs: signed-in approved accounts only.
drop policy if exists "Toolbox talk PDFs readable" on storage.objects;
create policy "Toolbox talk PDFs readable" on storage.objects
for select to authenticated
using (bucket_id = 'toolbox-talks' and private.jgc_has_full_portal_access());
