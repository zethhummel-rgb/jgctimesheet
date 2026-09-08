-- Additive metadata only. Keep canonical IDs, employee access policies,
-- document links and all connected timesheet/PO/WO records unchanged.
begin;
set local lock_timeout = '5s';
alter table public.jobs
  add column if not exists site_name text,
  add column if not exists last_imported_at timestamptz;
comment on column public.jobs.site_name is 'Current editable job site; NULL retains the accepted quote site fallback.';
comment on column public.jobs.last_imported_at is 'Timestamp of a saved Excel import touching this job; ordinary job edits must not update this value. Legacy import dates are unknown.';
commit;
