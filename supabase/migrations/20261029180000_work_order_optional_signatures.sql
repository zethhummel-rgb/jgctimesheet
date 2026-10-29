-- Optional signature images belong to the same WO and inherit its existing access policy.
-- Existing WOs and old clients continue to work without supplying this field.
alter table public.work_orders
  add column if not exists signatures jsonb not null default '{}'::jsonb;

alter table public.work_orders
  add constraint work_orders_signatures_object_size
  check (jsonb_typeof(signatures) = 'object' and octet_length(signatures::text) <= 310000);

comment on column public.work_orders.signatures is
  'Optional supervisor/client signatures: printed name, PNG data URL, signed_at. No change to submission or approval rules.';
