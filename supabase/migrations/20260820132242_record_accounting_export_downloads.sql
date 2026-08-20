begin;

create table if not exists public.accounting_export_downloads (
  id uuid primary key default gen_random_uuid(),
  export_id uuid not null references public.accounting_exports(id) on delete restrict,
  downloaded_by uuid not null references public.profiles(id) on delete restrict,
  downloaded_at timestamptz not null default now()
);

comment on table public.accounting_export_downloads is
  'Immutable ledger of administrators who download an existing Accounting workbook export.';

create index if not exists accounting_export_downloads_export_idx
  on public.accounting_export_downloads (export_id, downloaded_at desc);

create index if not exists accounting_export_downloads_downloaded_by_idx
  on public.accounting_export_downloads (downloaded_by);

alter table public.accounting_export_downloads enable row level security;

revoke all on public.accounting_export_downloads from public, anon, authenticated;
grant select, insert on public.accounting_export_downloads to authenticated;
grant all on public.accounting_export_downloads to service_role;

drop policy if exists accounting_export_downloads_select on public.accounting_export_downloads;
create policy accounting_export_downloads_select
on public.accounting_export_downloads
for select
to authenticated
using ((select private.jgc_has_accounting_access()));

drop policy if exists accounting_export_downloads_insert on public.accounting_export_downloads;
create policy accounting_export_downloads_insert
on public.accounting_export_downloads
for insert
to authenticated
with check (
  (select private.jgc_has_accounting_access())
  and downloaded_by = (select auth.uid())
);

commit;
