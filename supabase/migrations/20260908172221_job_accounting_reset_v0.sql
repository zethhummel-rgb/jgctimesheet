begin;

-- Future resets start at V0. Existing versions, reset runs, files, colours,
-- download logs, master reference and operational job data remain untouched.
alter table public.job_accounting_exports drop constraint job_accounting_exports_version_check;
alter table public.job_accounting_exports add constraint job_accounting_exports_version_check check (version >= 0);

create or replace function public.get_job_accounting_export_state()
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare last_reset public.job_accounting_export_resets; previous public.job_accounting_exports; current_cycle integer;
begin
  if auth.uid() is null or not private.jgc_has_accounting_access() then
    raise exception 'Approved administrator access is required.' using errcode = '42501';
  end if;
  select * into last_reset from public.job_accounting_export_resets order by cycle desc limit 1;
  current_cycle := coalesce(last_reset.cycle,1);
  select * into previous from public.job_accounting_exports where cycle = current_cycle order by version desc limit 1;
  return jsonb_build_object('cycle', current_cycle, 'nextVersion', case when previous.id is not null then previous.version+1 when current_cycle > 1 then 0 else 1 end,
    'latestExportId', previous.id, 'lastResetAt', last_reset.reset_at, 'lastResetBy', last_reset.reset_by_name);
end;
$$;

create or replace function private.prepare_job_accounting_reset()
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
    raise exception 'Download history changed or is already at V0. Refresh history before resetting.' using errcode = '40001';
  end if;
  new.reset_by := auth.uid();
  select coalesce(nullif(btrim(p.display_name),''),'Administrator') into new.reset_by_name from public.profiles p where p.id = auth.uid();
  new.reset_at := clock_timestamp();
  return new;
end;
$$;

create or replace function public.reset_job_accounting_exports(p_reset_id uuid, p_expected_cycle integer, p_expected_export_id uuid, p_confirmation text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare saved public.job_accounting_export_resets;
begin
  if auth.uid() is null or not private.jgc_has_accounting_access() then
    raise exception 'Approved administrator access is required.' using errcode = '42501';
  end if;
  if p_reset_id is null or p_expected_cycle is null or p_expected_cycle < 1 or p_expected_export_id is null
     or p_confirmation is distinct from 'RESET TO V0' then
    raise exception 'Type RESET TO V0 to confirm restarting the current download history.' using errcode = '22023';
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

revoke all on function public.get_job_accounting_export_state() from public, anon;
grant execute on function public.get_job_accounting_export_state() to authenticated;
revoke all on function private.prepare_job_accounting_reset() from public, anon, authenticated;
revoke all on function public.reset_job_accounting_exports(uuid,integer,uuid,text) from public, anon;
grant execute on function public.reset_job_accounting_exports(uuid,integer,uuid,text) to authenticated;

comment on table public.job_accounting_export_resets is 'Append-only admin reset audit. Future resets start a new V0 without changing historical files, the starting master, jobs or imports.';
comment on column public.job_accounting_exports.cycle is 'Download run. Future confirmed resets restart versions at 0; earlier runs remain immutable.';
commit;
