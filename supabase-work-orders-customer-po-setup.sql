alter table public.work_orders
add column if not exists customer_po_number text;
