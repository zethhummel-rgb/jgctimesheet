begin;

create table if not exists public.portal_user_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  theme text not null default 'dark'
    check (theme in ('dark', 'light')),
  updated_at timestamptz not null default now()
);

comment on table public.portal_user_preferences is
  'Private per-account Portal appearance preferences.';

alter table public.portal_user_preferences enable row level security;

revoke all on table public.portal_user_preferences from public, anon, authenticated;
grant select, insert, update on table public.portal_user_preferences to authenticated;
grant all on table public.portal_user_preferences to service_role;

drop policy if exists portal_user_preferences_select_own
  on public.portal_user_preferences;
create policy portal_user_preferences_select_own
on public.portal_user_preferences
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists portal_user_preferences_insert_own
  on public.portal_user_preferences;
create policy portal_user_preferences_insert_own
on public.portal_user_preferences
for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists portal_user_preferences_update_own
  on public.portal_user_preferences;
create policy portal_user_preferences_update_own
on public.portal_user_preferences
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

commit;
