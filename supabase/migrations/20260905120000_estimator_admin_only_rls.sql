begin;

create schema if not exists private;

create or replace function private.jgc_has_estimator_admin_access()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles profile
    where profile.id = (select auth.uid())
      and profile.account_status = 'approved'
      and profile.role = 'admin'
  );
$$;

comment on function private.jgc_has_estimator_admin_access() is
  'Returns true only for the currently authenticated, approved JGC administrator.';

revoke all on function private.jgc_has_estimator_admin_access() from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.jgc_has_estimator_admin_access() to authenticated;

alter table public.estimator_workspaces enable row level security;
alter table public.estimator_supplier_price_imports enable row level security;
alter table public.estimator_supplier_catalog_items enable row level security;

-- Replace every existing policy on these private Estimator tables so an older
-- broad approved-user policy cannot continue to grant access alongside the
-- admin-only policy below. This block is safe to run more than once.
do $policy_reset$
declare
  v_table_name text;
  v_policy_name text;
begin
  foreach v_table_name in array array[
    'estimator_workspaces',
    'estimator_supplier_price_imports',
    'estimator_supplier_catalog_items'
  ]
  loop
    for v_policy_name in
      select policyname
      from pg_catalog.pg_policies
      where schemaname = 'public'
        and tablename = v_table_name
    loop
      execute format('drop policy if exists %I on public.%I', v_policy_name, v_table_name);
    end loop;
  end loop;
end;
$policy_reset$;

create policy estimator_workspace_approved_admin_all
on public.estimator_workspaces
for all to authenticated
using ((select private.jgc_has_estimator_admin_access()))
with check ((select private.jgc_has_estimator_admin_access()));

create policy estimator_supplier_import_approved_admin_all
on public.estimator_supplier_price_imports
for all to authenticated
using ((select private.jgc_has_estimator_admin_access()))
with check ((select private.jgc_has_estimator_admin_access()));

create policy estimator_supplier_catalog_approved_admin_all
on public.estimator_supplier_catalog_items
for all to authenticated
using ((select private.jgc_has_estimator_admin_access()))
with check ((select private.jgc_has_estimator_admin_access()));

revoke all on table public.estimator_workspaces from anon, authenticated;
revoke all on table public.estimator_supplier_price_imports from anon, authenticated;
revoke all on table public.estimator_supplier_catalog_items from anon, authenticated;

grant select, insert, update, delete on table public.estimator_workspaces to authenticated;
grant select, insert, update, delete on table public.estimator_supplier_price_imports to authenticated;
grant select, insert, update, delete on table public.estimator_supplier_catalog_items to authenticated;

commit;
