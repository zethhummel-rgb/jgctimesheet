begin;

revoke all on table public.estimator_workspaces from anon, authenticated;
revoke all on table public.estimator_supplier_price_imports from anon, authenticated;
revoke all on table public.estimator_supplier_catalog_items from anon, authenticated;

grant select, insert, update, delete on table public.estimator_workspaces to authenticated;
grant select, insert, update, delete on table public.estimator_supplier_price_imports to authenticated;
grant select, insert, update, delete on table public.estimator_supplier_catalog_items to authenticated;

commit;
