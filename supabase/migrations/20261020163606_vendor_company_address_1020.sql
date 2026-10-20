begin;
set local lock_timeout = '3s';
alter table public.subcontractors_suppliers
  add column if not exists address text not null default '';
comment on column public.subcontractors_suppliers.address is
  'Optional company address for the shared vendor directory and purchase-order recipient. Existing table permissions and row policies apply.';
commit;
