alter table public.work_orders
  add column if not exists notes text;

grant select, insert, update, delete on public.work_orders to authenticated;
