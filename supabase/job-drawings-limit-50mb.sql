-- Release 966: Zeth approved this limit-only change on 2026-10-02.
-- Applied and verified in production; do not repeat setup from release 965.
-- This preserves the existing private, PDF-only bucket and access policies.
begin;
update storage.buckets
set file_size_limit = 52428800
where id = 'job-drawings' and public = false and file_size_limit = 26214400;
select id, public, file_size_limit, allowed_mime_types
from storage.buckets where id = 'job-drawings';
commit;
