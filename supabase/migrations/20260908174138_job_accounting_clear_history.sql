begin;

-- This migration installs the confirmed-reset capability. It does not execute
-- a reset or remove any existing versions. The starting master stays untouched.
create table private.job_accounting_reset_control (
  id text primary key check (id = 'main'),
  cycle integer not null check (cycle > 0),
  last_request_id uuid,
  expected_cycle integer,
  expected_export_id uuid,
  reset_by uuid,
  reset_at timestamptz
);
insert into private.job_accounting_reset_control(id,cycle)
  select 'main',coalesce(max(cycle),1) from public.job_accounting_export_resets;
alter table private.job_accounting_reset_control enable row level security;
revoke all on private.job_accounting_reset_control from public, anon, authenticated, service_role;
grant select on private.job_accounting_reset_control to authenticated;
create policy job_accounting_reset_control_read on private.job_accounting_reset_control
  for select to authenticated using ((select private.jgc_has_accounting_access()));

create or replace function public.get_job_accounting_export_state()
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare control private.job_accounting_reset_control; previous public.job_accounting_exports;
begin
  if auth.uid() is null or not private.jgc_has_accounting_access() then
    raise exception 'Approved administrator access is required.' using errcode = '42501';
  end if;
  select * into strict control from private.job_accounting_reset_control where id='main';
  select * into previous from public.job_accounting_exports where cycle=control.cycle order by version desc limit 1;
  return jsonb_build_object('cycle',control.cycle,
    'nextVersion',case when previous.id is not null then previous.version+1 when control.cycle>1 then 0 else 1 end,
    'latestExportId',previous.id);
end;
$$;

-- A private definer owns the narrow, explicitly confirmed destructive action.
-- Browsers receive no DELETE, UPDATE or TRUNCATE privileges on history tables.
-- The single receipt prevents a retry from deleting a newly created V0.
create function private.clear_job_accounting_download_history(
  p_reset_id uuid, p_expected_cycle integer, p_expected_export_id uuid, p_confirmation text)
returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '3s' as $$
declare control private.job_accounting_reset_control; latest_id uuid; deleted_files bigint; deleted_logs bigint;
begin
  if auth.uid() is null or not private.jgc_has_accounting_access() then
    raise exception 'Approved administrator access is required.' using errcode = '42501';
  end if;
  if p_reset_id is null or p_expected_cycle is null or p_expected_cycle < 1 or p_expected_export_id is null
     or p_confirmation is distinct from 'DELETE HISTORY' then
    raise exception 'Type DELETE HISTORY to confirm permanently deleting saved accounting downloads and logs.' using errcode = '22023';
  end if;
  if not pg_try_advisory_xact_lock(726481,1) then
    raise exception 'Another accounting action is in progress. Refresh history and retry.' using errcode = '40001';
  end if;
  select * into strict control from private.job_accounting_reset_control where id='main' for update;
  if control.last_request_id = p_reset_id then
    if control.expected_cycle is distinct from p_expected_cycle
       or control.expected_export_id is distinct from p_expected_export_id
       or control.reset_by is distinct from auth.uid() then
      raise exception 'This reset request does not match the original request.' using errcode = '40001';
    end if;
    return jsonb_build_object('id',p_reset_id,'cycle',control.cycle,'reused',true);
  end if;
  select id into latest_id from public.job_accounting_exports where cycle=control.cycle order by version desc limit 1;
  if control.cycle is distinct from p_expected_cycle or latest_id is null or latest_id is distinct from p_expected_export_id then
    raise exception 'Download history changed or is already empty. Refresh history before resetting.' using errcode = '40001';
  end if;
  select count(*) into deleted_files from public.job_accounting_exports;
  select count(*) into deleted_logs from public.job_accounting_export_downloads;
  -- Exact accounting-only tables, no CASCADE and no descendants. Existing
  -- immutable UPDATE/DELETE triggers and RLS remain in place for ordinary use.
  truncate table only public.job_accounting_export_downloads,
    only public.job_accounting_export_resets, only public.job_accounting_exports restrict;
  update private.job_accounting_reset_control set cycle=control.cycle+1,
    last_request_id=p_reset_id,expected_cycle=p_expected_cycle,
    expected_export_id=p_expected_export_id,reset_by=auth.uid(),reset_at=clock_timestamp()
    where id='main';
  return jsonb_build_object('id',p_reset_id,'cycle',control.cycle+1,'reused',false,
    'deletedFiles',deleted_files,'deletedLogs',deleted_logs);
exception when lock_not_available then
  raise exception 'An accounting download is in progress. Refresh history and retry.' using errcode = '40001';
end;
$$;
revoke all on function private.clear_job_accounting_download_history(uuid,integer,uuid,text) from public, anon;
grant execute on function private.clear_job_accounting_download_history(uuid,integer,uuid,text) to authenticated;

create function public.clear_job_accounting_download_history(
  p_reset_id uuid, p_expected_cycle integer, p_expected_export_id uuid, p_confirmation text)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.clear_job_accounting_download_history(p_reset_id,p_expected_cycle,p_expected_export_id,p_confirmation);
$$;
revoke all on function public.clear_job_accounting_download_history(uuid,integer,uuid,text) from public, anon;
grant execute on function public.clear_job_accounting_download_history(uuid,integer,uuid,text) to authenticated;

-- Older open clients must refresh and explicitly consent to deletion.
create or replace function public.reset_job_accounting_exports(
  p_reset_id uuid, p_expected_cycle integer, p_expected_export_id uuid, p_confirmation text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
begin
  if auth.uid() is null or not private.jgc_has_accounting_access() then
    raise exception 'Approved administrator access is required.' using errcode = '42501';
  end if;
  raise exception 'Reset behavior changed. Refresh the page and use the delete-history confirmation.' using errcode = '22023';
end;
$$;
revoke insert on public.job_accounting_export_resets from authenticated;
revoke all on function public.get_job_accounting_export_state() from public, anon;
grant execute on function public.get_job_accounting_export_state() to authenticated;

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
    or coalesce(r->>'color','') not in ('white','green','yellow','red')
    or jsonb_typeof(r->'cells') is distinct from 'array'
    or jsonb_array_length(r->'cells') <> 16)
    or (select count(*) from jsonb_array_elements(new.rows)) <>
       (select count(distinct r->>'jobNumber') from jsonb_array_elements(new.rows) r) then
    raise exception 'The accounting file contains invalid or duplicate job rows.' using errcode = '22023';
  end if;
  bytes := decode(new.file_base64,'base64');
  if substring(bytes from 1 for 4) <> decode('504b0304','hex')
    or encode(extensions.digest(bytes,'sha256'),'hex') <> new.file_sha256 then
    raise exception 'The Excel file failed its integrity check. No version was saved.' using errcode = '22023';
  end if;
  new.exported_by := auth.uid();
  select coalesce(nullif(btrim(p.display_name),''),'Administrator') into new.exported_by_name from public.profiles p where p.id = auth.uid();
  new.exported_at := clock_timestamp();
  new.file_name := 'JGC Accounting Job List - v' || lpad(new.version::text,greatest(4,length(new.version::text)),'0')
    || '.xlsx';
  return new;
end;
$$;

comment on table private.job_accounting_reset_control is 'Current internal generation and last reset receipt only; no historical files, job data or download logs. Used for concurrency and safe retries.';
comment on table public.job_accounting_export_resets is 'Legacy reset history, cleared with saved accounting versions only by the new explicitly confirmed admin reset.';
comment on column public.job_accounting_exports.cycle is 'Internal generation preventing stale saves after a reset. Not a visible archive or file revision.';
commit;
