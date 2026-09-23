create table public.portal_dashboard_layouts (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  layout jsonb not null check (jsonb_typeof(layout) = 'object' and octet_length(layout::text) <= 16384),
  updated_at timestamptz not null default now()
);
alter table public.portal_dashboard_layouts enable row level security;
revoke all on public.portal_dashboard_layouts from public, anon, authenticated;
grant select, insert, update on public.portal_dashboard_layouts to authenticated;
create policy dashboard_read_own on public.portal_dashboard_layouts for select to authenticated
  using ((select auth.uid()) = user_id and (select public.is_admin()));
create policy dashboard_insert_own on public.portal_dashboard_layouts for insert to authenticated
  with check ((select auth.uid()) = user_id and (select public.is_admin()));
create policy dashboard_update_own on public.portal_dashboard_layouts for update to authenticated
  using ((select auth.uid()) = user_id and (select public.is_admin()))
  with check ((select auth.uid()) = user_id and (select public.is_admin()));
comment on table public.portal_dashboard_layouts is 'Private per-admin Summary widget layout. Contains presentation preferences only.';
