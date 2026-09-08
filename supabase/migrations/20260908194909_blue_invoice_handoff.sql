begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Change only the next-download rule. Saved workbooks, job flags and the
-- operational uploader remain untouched.
comment on column public.jobs.invoice_review_at is
  'Closed with an invoicing discussion requested. Blue on the first accounting hand-off for this status event; yellow in later downloads. Saved versions retain their original colours.';

create or replace function private.prepare_job_accounting_export()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare preview jsonb; bytes bytea;
begin
  if auth.uid() is null or not private.jgc_has_accounting_access() then
    raise exception 'Approved administrator access is required.' using errcode = '42501';
  end if;
  if not pg_try_advisory_xact_lock(726481,1) then
    raise exception 'Another accounting action is in progress. Refresh the preview and try again.' using errcode = '40001';
  end if;
  preview := public.get_job_accounting_export_preview();
  if new.source_snapshot is distinct from preview->'sourceSnapshot'
     or new.previous_export_id::text is distinct from preview->>'previousExportId'
     or new.version is distinct from (preview->>'version')::integer
     or new.cycle is distinct from (preview->>'cycle')::integer then
    raise exception 'Jobs or download history changed. Refresh the preview before creating a new version.' using errcode = '40001';
  end if;
  if exists (select 1 from jsonb_array_elements(new.rows) r where
    length(coalesce(r->>'jobNumber','')) not between 1 and 100
    or coalesce(r->>'color','') not in ('white','green','yellow','red','blue')
    or jsonb_typeof(r->'cells') is distinct from 'array'
    or jsonb_array_length(r->'cells') <> 16)
    or (select count(*) from jsonb_array_elements(new.rows)) <>
       (select count(distinct r->>'jobNumber') from jsonb_array_elements(new.rows) r) then
    raise exception 'The accounting file contains invalid or duplicate job rows.' using errcode = '22023';
  end if;
  -- A first/new discussion event is blue. Once handed off it is yellow, even
  -- after detail-only edits. A reset has no previous export and starts blue.
  -- Reject stale clients rather than letting them omit or recolour the event.
  if exists (
    select 1 from jsonb_array_elements(preview->'sourceSnapshot') j
    where nullif(j->>'invoiceReviewAt','') is not null
      and not exists (
        select 1 from jsonb_array_elements(new.rows) r
        where lower(btrim(r->>'jobNumber')) = lower(btrim(j->>'jobNumber'))
          and r->>'color' = case when preview->>'previousExportId' is not null
            and exists (
              select 1 from jsonb_array_elements(preview->'previousRows') old_row
              where lower(btrim(old_row->>'jobNumber')) = lower(btrim(j->>'jobNumber'))
                and old_row->>'color' in ('blue','yellow')
            )
            and not exists (
              select 1 from jsonb_array_elements(preview->'previousSnapshot') before_job
              where lower(btrim(before_job->>'jobNumber')) = lower(btrim(j->>'jobNumber'))
                and (before_job->>'statusChangedAt' is distinct from j->>'statusChangedAt'
                  or before_job->>'active' is distinct from j->>'active'
                  or before_job->>'cancelledAt' is distinct from j->>'cancelledAt'
                  or before_job->>'invoiceReviewAt' is distinct from j->>'invoiceReviewAt')
            ) then 'yellow' else 'blue' end
      )
  ) then
    raise exception 'Invoice discussion hand-offs changed. Refresh Estimate Desk before creating this download.' using errcode = '40001';
  end if;
  bytes := decode(new.file_base64,'base64');
  if substring(bytes from 1 for 4) <> decode('504b0304','hex')
    or encode(extensions.digest(bytes,'sha256'),'hex') <> new.file_sha256 then
    raise exception 'The Excel file failed its integrity check. No version was saved.' using errcode = '22023';
  end if;
  new.exported_by := auth.uid();
  select coalesce(nullif(btrim(p.display_name),''),'Administrator') into new.exported_by_name from public.profiles p where p.id = auth.uid();
  new.exported_at := clock_timestamp();
  new.file_name := 'JGC Accounting Job List - v' || lpad(new.version::text,greatest(4,length(new.version::text)),'0') || '.xlsx';
  return new;
end;
$$;
commit;
