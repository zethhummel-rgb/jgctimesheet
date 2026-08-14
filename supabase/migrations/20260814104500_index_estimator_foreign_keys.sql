begin;

create index if not exists estimator_workspaces_updated_by_idx
  on public.estimator_workspaces (updated_by);

create index if not exists estimator_supplier_imports_created_by_idx
  on public.estimator_supplier_price_imports (created_by);

create index if not exists estimator_supplier_catalog_latest_import_idx
  on public.estimator_supplier_catalog_items (latest_import_id);

commit;
