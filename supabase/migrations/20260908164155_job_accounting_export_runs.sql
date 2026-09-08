begin;

-- A reset starts a new numbered run. No saved file, master reference, job,
-- status, import, timesheet or purchasing record is modified or deleted.
alter table public.job_accounting_exports add column cycle integer not null default 1 check (cycle > 0);
alter table public.job_accounting_exports drop constraint job_accounting_exports_version_key;
alter table public.job_accounting_exports add constraint job_accounting_exports_cycle_version_key unique (cycle, version);

create table public.job_accounting_export_resets (
  id uuid primary key,
  cycle integer not null unique check (cycle > 1),
  previous_export_id uuid not null references public.job_accounting_exports(id) on delete restrict,
  reset_by uuid not null references public.profiles(id) on delete restrict,
  reset_by_name text not null,
  reset_at timestamptz not null default now()
);
create index job_accounting_resets_previous_idx on public.job_accounting_export_resets(previous_export_id);
create index job_accounting_resets_author_idx on public.job_accounting_export_resets(reset_by);
alter table public.job_accounting_export_resets enable row level security;
revoke all on public.job_accounting_export_resets from public, anon, authenticated;
grant select, insert on public.job_accounting_export_resets to authenticated;
grant select on public.job_accounting_export_resets to service_role;
create policy job_accounting_resets_read on public.job_accounting_export_resets for select to authenticated
  using ((select private.jgc_has_accounting_access()));
create policy job_accounting_resets_insert on public.job_accounting_export_resets for insert to authenticated
  with check ((select private.jgc_has_accounting_access()) and reset_by = (select auth.uid()));
create trigger immutable_job_accounting_resets before update or delete on public.job_accounting_export_resets
  for each row execute function private.reject_job_accounting_history_change();

create function public.get_job_accounting_export_state()
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare last_reset public.job_accounting_export_resets; previous public.job_accounting_exports; current_cycle integer;
begin
  if auth.uid() is null or not private.jgc_has_accounting_access() then
    raise exception 'Approved administrator access is required.' using errcode = '42501';
  end if;
  select * into last_reset from public.job_accounting_export_resets order by cycle desc limit 1;
  current_cycle := coalesce(last_reset.cycle,1);
  select * into previous from public.job_accounting_exports where cycle = current_cycle order by version desc limit 1;
  return jsonb_build_object('cycle', current_cycle, 'nextVersion', coalesce(previous.version,0)+1,
    'latestExportId', previous.id, 'lastResetAt', last_reset.reset_at, 'lastResetBy', last_reset.reset_by_name);
end;
$$;
revoke all on function public.get_job_accounting_export_state() from public, anon;
grant execute on function public.get_job_accounting_export_state() to authenticated;

create or replace function public.get_job_accounting_export_preview()
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare setup public.job_accounting_export_setup; previous public.job_accounting_exports; state jsonb;
begin
  state := public.get_job_accounting_export_state();
  select * into setup from public.job_accounting_export_setup where id = 'main';
  if not found then raise exception 'The accounting reference workbook has not been configured yet.' using errcode = '55000'; end if;
  select * into previous from public.job_accounting_exports where id = (state->>'latestExportId')::uuid;
  return jsonb_build_object('cycle', (state->>'cycle')::integer, 'version', (state->>'nextVersion')::integer,
    'previousExportId', previous.id, 'sourceSnapshot', private.job_accounting_source_snapshot(),
    'previousSnapshot', coalesce(previous.source_snapshot, setup.baseline_snapshot),
    'previousRows', coalesce(previous.rows,'[]'::jsonb), 'baselineSnapshot', setup.baseline_snapshot,
    'masterRows', setup.master_rows, 'sourceName', setup.source_name, 'sourceSha256', setup.source_sha256,
    'trackingStartedAt', setup.created_at);
end;
$$;

create function private.prepare_job_accounting_reset()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare state jsonb;
begin
  if auth.uid() is null or not private.jgc_has_accounting_access() then
    raise exception 'Approved administrator access is required.' using errcode = '42501';
  end if;
  if not pg_try_advisory_xact_lock(726481,1) then
    raise exception 'Another accounting action is in progress. Refresh history and retry.' using errcode = '40001';
  end if;
  state := public.get_job_accounting_export_state();
  if state->>'latestExportId' is null or new.cycle is distinct from (state->>'cycle')::integer+1
     or new.previous_export_id::text is distinct from state->>'latestExportId' then
    raise exception 'Download history changed or is already at V1. Refresh history before resetting.' using errcode = '40001';
  end if;
  new.reset_by := auth.uid();
  select coalesce(nullif(btrim(p.display_name),''),'Administrator') into new.reset_by_name from public.profiles p where p.id = auth.uid();
  new.reset_at := clock_timestamp();
  return new;
end;
$$;
revoke all on function private.prepare_job_accounting_reset() from public, anon, authenticated;
create trigger prepare_job_accounting_reset before insert on public.job_accounting_export_resets
  for each row execute function private.prepare_job_accounting_reset();

create function public.reset_job_accounting_exports(p_reset_id uuid, p_expected_cycle integer, p_expected_export_id uuid, p_confirmation text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare saved public.job_accounting_export_resets;
begin
  if auth.uid() is null or not private.jgc_has_accounting_access() then
    raise exception 'Approved administrator access is required.' using errcode = '42501';
  end if;
  if p_reset_id is null or p_expected_cycle is null or p_expected_cycle < 1 or p_expected_export_id is null
     or p_confirmation is distinct from 'RESET TO V1' then
    raise exception 'Type RESET TO V1 to confirm restarting the current download history.' using errcode = '22023';
  end if;
  if not pg_try_advisory_xact_lock(726481,1) then
    raise exception 'Another accounting action is in progress. Refresh history and retry.' using errcode = '40001';
  end if;
  select * into saved from public.job_accounting_export_resets where id = p_reset_id;
  if found then
    if saved.cycle <> p_expected_cycle+1 or saved.previous_export_id <> p_expected_export_id or saved.reset_by <> auth.uid() then
      raise exception 'This reset request does not match the original request.' using errcode = '40001';
    end if;
    return jsonb_build_object('id',saved.id,'cycle',saved.cycle,'resetAt',saved.reset_at,'reused',true);
  end if;
  insert into public.job_accounting_export_resets(id,cycle,previous_export_id,reset_by,reset_by_name)
    values(p_reset_id,p_expected_cycle+1,p_expected_export_id,auth.uid(),'assigned by database') returning * into saved;
  return jsonb_build_object('id',saved.id,'cycle',saved.cycle,'resetAt',saved.reset_at,'reused',false);
end;
$$;
revoke all on function public.reset_job_accounting_exports(uuid,integer,uuid,text) from public, anon;
grant execute on function public.reset_job_accounting_exports(uuid,integer,uuid,text) to authenticated;

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
    || case when new.cycle > 1 then ' - run' || new.cycle::text else '' end || '.xlsx';
  return new;
end;
$$;
comment on table public.job_accounting_export_resets is 'Append-only admin reset audit. Each reset starts a new V1 without changing historical files, the starting master, jobs or imports.';
comment on column public.job_accounting_exports.cycle is 'Download run. Versions restart at 1 after a confirmed reset; earlier runs remain immutable.';
commit;
