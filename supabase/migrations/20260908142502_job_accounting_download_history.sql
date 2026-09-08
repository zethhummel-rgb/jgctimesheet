begin;

-- Separate accounting hand-off history. No import policy, import code, job ID,
-- active flag, employee link, payroll or purchasing record is changed here.
alter table public.jobs add column if not exists accounting_status_changed_at timestamptz;
comment on column public.jobs.accounting_status_changed_at is
  'Explicit Estimate Desk status-action timestamp. Excel imports omit and preserve this field.';

create function private.job_accounting_source_snapshot()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'jobNumber', btrim(j.job_number), 'jobName', j.job_name,
    'active', j.active, 'cancelledAt', j.cancelled_at,
    'statusChangedAt', j.accounting_status_changed_at,
    'projectManager', coalesce(j.project_manager, ''), 'jobType', coalesce(j.job_type, ''),
    'customer', coalesce(j.customer, ''), 'site', coalesce(j.site_name, ''),
    'address', coalesce(j.address, ''), 'startDate', j.start_date, 'targetEndDate', j.target_end_date,
    'price', case when coalesce(e.item->>'quoteId', '') <> '' then e.item->'acceptedRevenue' else null end,
    'extras', case when coalesce(e.item->>'quoteId', '') <> '' then e.item->'approvedRevenueChanges' else null end,
    'acceptedAt', case when coalesce(e.item->>'quoteId', '') <> '' then e.item->>'acceptedAt' else null end,
    'customerPo', coalesce(q.frozen->>'customerPo', ''),
    'quoteReference', coalesce(q.frozen->>'reference', '')
  ) order by btrim(j.job_number)), '[]'::jsonb)
  from public.jobs j
  left join lateral (
    select x.item from public.estimator_workspaces w,
      lateral jsonb_array_elements(coalesce(w.payload->'jobs','[]'::jsonb)) x(item)
    where w.id = 'main' and (x.item->>'portalJobId' = j.id::text
      or (coalesce(x.item->>'portalJobId','') = '' and btrim(x.item->>'jobNumber') = btrim(j.job_number)))
    order by (x.item->>'portalJobId' = j.id::text) desc limit 1
  ) e on true
  left join lateral (
    select case when (e.item->>'acceptedQuoteSnapshot') is json object
      then (e.item->>'acceptedQuoteSnapshot')::jsonb else '{}'::jsonb end as frozen
  ) q on true;
$$;
revoke all on function private.job_accounting_source_snapshot() from public, anon;
grant execute on function private.job_accounting_source_snapshot() to authenticated;

create table public.job_accounting_export_setup (
  id text primary key check (id = 'main'),
  source_name text not null check (length(source_name) between 1 and 200),
  source_sha256 text not null check (source_sha256 ~ '^[a-f0-9]{64}$'),
  master_rows jsonb not null check (jsonb_typeof(master_rows) = 'array' and jsonb_array_length(master_rows) <= 10000),
  baseline_snapshot jsonb not null default '[]',
  created_at timestamptz not null default now()
);

create table public.job_accounting_exports (
  id uuid primary key,
  version integer not null unique check (version > 0),
  previous_export_id uuid references public.job_accounting_exports(id) on delete restrict,
  file_name text not null,
  file_sha256 text not null check (file_sha256 ~ '^[a-f0-9]{64}$'),
  file_base64 text not null check (length(file_base64) between 16 and 12000000),
  source_snapshot jsonb not null check (jsonb_typeof(source_snapshot) = 'array'),
  rows jsonb not null check (jsonb_typeof(rows) = 'array' and jsonb_array_length(rows) between 1 and 10000),
  summary jsonb not null,
  exported_by uuid not null references public.profiles(id) on delete restrict,
  exported_by_name text not null,
  exported_at timestamptz not null default now()
);
create index job_accounting_exports_author_idx on public.job_accounting_exports(exported_by);
create index job_accounting_exports_previous_idx on public.job_accounting_exports(previous_export_id);

create table public.job_accounting_export_downloads (
  id uuid primary key,
  export_id uuid not null references public.job_accounting_exports(id) on delete restrict,
  downloaded_by uuid not null references public.profiles(id) on delete restrict,
  downloaded_by_name text not null,
  requested_at timestamptz not null default now()
);
create index job_accounting_downloads_export_idx on public.job_accounting_export_downloads(export_id, requested_at desc);
create index job_accounting_downloads_author_idx on public.job_accounting_export_downloads(downloaded_by);

alter table public.job_accounting_export_setup enable row level security;
alter table public.job_accounting_exports enable row level security;
alter table public.job_accounting_export_downloads enable row level security;
revoke all on public.job_accounting_export_setup, public.job_accounting_exports, public.job_accounting_export_downloads from public, anon, authenticated;
grant select, insert on public.job_accounting_export_setup, public.job_accounting_exports, public.job_accounting_export_downloads to authenticated;
grant select on public.job_accounting_export_setup, public.job_accounting_exports, public.job_accounting_export_downloads to service_role;

create policy job_accounting_setup_read on public.job_accounting_export_setup for select to authenticated using ((select private.jgc_has_accounting_access()));
create policy job_accounting_setup_insert on public.job_accounting_export_setup for insert to authenticated with check ((select private.jgc_has_accounting_access()));
create policy job_accounting_exports_read on public.job_accounting_exports for select to authenticated using ((select private.jgc_has_accounting_access()));
create policy job_accounting_exports_insert on public.job_accounting_exports for insert to authenticated with check ((select private.jgc_has_accounting_access()) and exported_by = (select auth.uid()));
create policy job_accounting_downloads_read on public.job_accounting_export_downloads for select to authenticated using ((select private.jgc_has_accounting_access()));
create policy job_accounting_downloads_insert on public.job_accounting_export_downloads for insert to authenticated with check ((select private.jgc_has_accounting_access()) and downloaded_by = (select auth.uid()));

create function private.prepare_job_accounting_setup()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if auth.uid() is null or not private.jgc_has_accounting_access() then
    raise exception 'Approved administrator access is required.' using errcode = '42501';
  end if;
  if exists (select 1 from jsonb_array_elements(new.master_rows) r where
    coalesce(r->>'jobNumber','') !~ '^[0-9]{5,}$'
    or coalesce(r->>'color','') not in ('white','green','yellow','red')
    or jsonb_typeof(r->'cells') is distinct from 'array'
    or jsonb_array_length(r->'cells') <> 16)
    or (select count(*) from jsonb_array_elements(new.master_rows)) <>
       (select count(distinct r->>'jobNumber') from jsonb_array_elements(new.master_rows) r) then
    raise exception 'The reference workbook has invalid or duplicate job rows.' using errcode = '22023';
  end if;
  new.baseline_snapshot := private.job_accounting_source_snapshot();
  new.created_at := clock_timestamp();
  return new;
end;
$$;
create trigger prepare_job_accounting_setup before insert on public.job_accounting_export_setup
  for each row execute function private.prepare_job_accounting_setup();

create function public.get_job_accounting_export_preview()
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare setup public.job_accounting_export_setup; previous public.job_accounting_exports;
begin
  if auth.uid() is null or not private.jgc_has_accounting_access() then
    raise exception 'Approved administrator access is required.' using errcode = '42501';
  end if;
  select * into setup from public.job_accounting_export_setup where id = 'main';
  if not found then raise exception 'The accounting reference workbook has not been configured yet.' using errcode = '55000'; end if;
  select * into previous from public.job_accounting_exports order by version desc limit 1;
  return jsonb_build_object('version', coalesce(previous.version,0)+1,
    'previousExportId', previous.id, 'sourceSnapshot', private.job_accounting_source_snapshot(),
    'previousSnapshot', coalesce(previous.source_snapshot, setup.baseline_snapshot),
    'previousRows', coalesce(previous.rows,'[]'::jsonb), 'baselineSnapshot', setup.baseline_snapshot,
    'masterRows', setup.master_rows, 'sourceName', setup.source_name, 'sourceSha256', setup.source_sha256,
    'trackingStartedAt', setup.created_at);
end;
$$;
revoke all on function public.get_job_accounting_export_preview() from public, anon;
grant execute on function public.get_job_accounting_export_preview() to authenticated;

create function private.prepare_job_accounting_export()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare preview jsonb; bytes bytea;
begin
  if auth.uid() is null or not private.jgc_has_accounting_access() then
    raise exception 'Approved administrator access is required.' using errcode = '42501';
  end if;
  if not pg_try_advisory_xact_lock(726481, 1) then
    raise exception 'Another accounting download is being saved. Refresh the preview and try again.' using errcode = '40001';
  end if;
  preview := public.get_job_accounting_export_preview();
  if new.source_snapshot is distinct from preview->'sourceSnapshot'
     or new.previous_export_id::text is distinct from preview->>'previousExportId'
     or new.version is distinct from (preview->>'version')::integer then
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
  select coalesce(nullif(btrim(p.display_name),''),'Administrator') into new.exported_by_name
    from public.profiles p where p.id = auth.uid();
  new.exported_at := clock_timestamp();
  new.file_name := 'JGC Accounting Job List - v' || lpad(new.version::text,greatest(4,length(new.version::text)),'0') || '.xlsx';
  return new;
end;
$$;
create trigger prepare_job_accounting_export before insert on public.job_accounting_exports
  for each row execute function private.prepare_job_accounting_export();

create function private.prepare_job_accounting_download()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if auth.uid() is null or not private.jgc_has_accounting_access() then
    raise exception 'Approved administrator access is required.' using errcode = '42501';
  end if;
  new.downloaded_by := auth.uid();
  select coalesce(nullif(btrim(p.display_name),''),'Administrator') into new.downloaded_by_name
    from public.profiles p where p.id = auth.uid();
  new.requested_at := clock_timestamp();
  return new;
end;
$$;
create trigger prepare_job_accounting_download before insert on public.job_accounting_export_downloads
  for each row execute function private.prepare_job_accounting_download();

create function private.reject_job_accounting_history_change()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin raise exception 'Saved accounting versions and download history are immutable.' using errcode = '42501'; end;
$$;
create trigger immutable_job_accounting_setup before update or delete on public.job_accounting_export_setup
  for each row execute function private.reject_job_accounting_history_change();
create trigger immutable_job_accounting_exports before update or delete on public.job_accounting_exports
  for each row execute function private.reject_job_accounting_history_change();
create trigger immutable_job_accounting_downloads before update or delete on public.job_accounting_export_downloads
  for each row execute function private.reject_job_accounting_history_change();
revoke all on function private.prepare_job_accounting_setup(), private.prepare_job_accounting_export(),
  private.prepare_job_accounting_download(), private.reject_job_accounting_history_change() from public, anon, authenticated;

comment on table public.job_accounting_exports is 'Immutable accounting job-list XLSX versions. Yellow means previously handed off, not invoice confirmation. Never used by the job importer.';
comment on table public.job_accounting_export_downloads is 'Immutable requests to download saved versions. A browser download request does not prove a file was saved or copied into the accounting master.';
commit;
