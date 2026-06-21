create table if not exists public.user_preferences (
  id uuid primary key default gen_random_uuid(),
  user_key text not null,
  preference_key text not null,
  preferences jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (user_key, preference_key)
);

alter table public.user_preferences enable row level security;

drop policy if exists "Authenticated users can read user preferences" on public.user_preferences;
create policy "Authenticated users can read user preferences"
on public.user_preferences
for select
to authenticated
using (true);

drop policy if exists "Authenticated users can insert user preferences" on public.user_preferences;
create policy "Authenticated users can insert user preferences"
on public.user_preferences
for insert
to authenticated
with check (true);

drop policy if exists "Authenticated users can update user preferences" on public.user_preferences;
create policy "Authenticated users can update user preferences"
on public.user_preferences
for update
to authenticated
using (true)
with check (true);

create or replace function public.touch_user_preferences_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists touch_user_preferences_updated_at on public.user_preferences;
create trigger touch_user_preferences_updated_at
before update on public.user_preferences
for each row
execute function public.touch_user_preferences_updated_at();
