begin;

create table if not exists public.estimator_workspaces (
  id text primary key,
  payload jsonb not null default '{}'::jsonb,
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint estimator_workspace_payload_object check (jsonb_typeof(payload) = 'object')
);

create table if not exists public.estimator_supplier_price_imports (
  id uuid primary key default gen_random_uuid(),
  supplier_id text not null,
  supplier_name text not null,
  filename text not null,
  file_hash text not null,
  detected_date date,
  effective_date date not null,
  valid_until date,
  parser_type text not null,
  source_subtotal numeric(14, 3),
  extracted_subtotal numeric(14, 3) not null default 0,
  row_count integer not null default 0 check (row_count >= 0),
  new_count integer not null default 0 check (new_count >= 0),
  changed_count integer not null default 0 check (changed_count >= 0),
  unchanged_count integer not null default 0 check (unchanged_count >= 0),
  review_count integer not null default 0 check (review_count >= 0),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  unique (supplier_id, file_hash)
);

create table if not exists public.estimator_supplier_catalog_items (
  id uuid primary key default gen_random_uuid(),
  supplier_id text not null,
  supplier_name text not null,
  supplier_sku text not null,
  normalized_sku text not null,
  product_name text not null,
  raw_description text not null,
  normalized_description text not null,
  raw_unit text not null,
  unit text not null,
  division text not null,
  list_price numeric(14, 3),
  net_cost numeric(14, 3) not null check (net_cost >= 0),
  effective_date date not null,
  valid_until date,
  active boolean not null default true,
  latest_import_id uuid not null references public.estimator_supplier_price_imports(id) on delete restrict,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (supplier_id, normalized_sku)
);

create index if not exists estimator_supplier_catalog_search_idx
  on public.estimator_supplier_catalog_items (active, supplier_name, product_name);
create index if not exists estimator_supplier_catalog_supplier_idx
  on public.estimator_supplier_catalog_items (supplier_id, active);
create index if not exists estimator_supplier_import_date_idx
  on public.estimator_supplier_price_imports (supplier_id, created_at desc);

create or replace function private.jgc_touch_estimator_workspace()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  if tg_op = 'UPDATE' then
    new.revision := old.revision + 1;
  end if;
  return new;
end;
$$;

drop trigger if exists estimator_workspace_touch on public.estimator_workspaces;
create trigger estimator_workspace_touch
before insert or update on public.estimator_workspaces
for each row execute function private.jgc_touch_estimator_workspace();

alter table public.estimator_workspaces enable row level security;
alter table public.estimator_supplier_price_imports enable row level security;
alter table public.estimator_supplier_catalog_items enable row level security;

drop policy if exists estimator_workspace_admin_all on public.estimator_workspaces;
create policy estimator_workspace_admin_all on public.estimator_workspaces
for all to authenticated
using (private.jgc_has_full_portal_access())
with check (private.jgc_has_full_portal_access());

drop policy if exists estimator_supplier_import_admin_all on public.estimator_supplier_price_imports;
create policy estimator_supplier_import_admin_all on public.estimator_supplier_price_imports
for all to authenticated
using (private.jgc_has_full_portal_access())
with check (private.jgc_has_full_portal_access());

drop policy if exists estimator_supplier_catalog_admin_all on public.estimator_supplier_catalog_items;
create policy estimator_supplier_catalog_admin_all on public.estimator_supplier_catalog_items
for all to authenticated
using (private.jgc_has_full_portal_access())
with check (private.jgc_has_full_portal_access());

revoke all on table public.estimator_workspaces from anon;
revoke all on table public.estimator_supplier_price_imports from anon;
revoke all on table public.estimator_supplier_catalog_items from anon;
grant select, insert, update, delete on table public.estimator_workspaces to authenticated;
grant select, insert, update, delete on table public.estimator_supplier_price_imports to authenticated;
grant select, insert, update, delete on table public.estimator_supplier_catalog_items to authenticated;

commit;
