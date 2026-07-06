-- JGC Portal PWA push notification setup.
-- Run this once in Supabase SQL Editor before enabling push subscriptions.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles(id) on delete cascade,
  worker_key text,
  worker_display_name text,
  worker_email text,
  role text not null default 'worker',
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  enabled boolean not null default true,
  last_seen_at timestamptz,
  last_success_at timestamptz,
  last_error_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.push_delivery_log (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid references public.notifications(id) on delete cascade,
  push_subscription_id uuid references public.push_subscriptions(id) on delete set null,
  status text not null,
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists idx_push_subscriptions_profile
  on public.push_subscriptions(profile_id)
  where enabled = true;

create index if not exists idx_push_subscriptions_worker_email
  on public.push_subscriptions(lower(worker_email))
  where enabled = true;

create index if not exists idx_push_subscriptions_worker_key
  on public.push_subscriptions(lower(worker_key))
  where enabled = true;

create index if not exists idx_push_subscriptions_role
  on public.push_subscriptions(lower(role))
  where enabled = true;

alter table public.push_subscriptions enable row level security;
alter table public.push_delivery_log enable row level security;

drop policy if exists "push subscriptions owner select" on public.push_subscriptions;
create policy "push subscriptions owner select"
on public.push_subscriptions
for select
to authenticated
using (
  profile_id = (select auth.uid())
  or lower(coalesce(worker_email, '')) = lower(coalesce((select auth.jwt() ->> 'email'), ''))
);

drop policy if exists "push subscriptions owner insert" on public.push_subscriptions;
create policy "push subscriptions owner insert"
on public.push_subscriptions
for insert
to authenticated
with check (
  profile_id = (select auth.uid())
  or lower(coalesce(worker_email, '')) = lower(coalesce((select auth.jwt() ->> 'email'), ''))
);

drop policy if exists "push subscriptions owner update" on public.push_subscriptions;
create policy "push subscriptions owner update"
on public.push_subscriptions
for update
to authenticated
using (
  profile_id = (select auth.uid())
  or lower(coalesce(worker_email, '')) = lower(coalesce((select auth.jwt() ->> 'email'), ''))
)
with check (
  profile_id = (select auth.uid())
  or lower(coalesce(worker_email, '')) = lower(coalesce((select auth.jwt() ->> 'email'), ''))
);

drop policy if exists "push subscriptions owner delete" on public.push_subscriptions;
create policy "push subscriptions owner delete"
on public.push_subscriptions
for delete
to authenticated
using (
  profile_id = (select auth.uid())
  or lower(coalesce(worker_email, '')) = lower(coalesce((select auth.jwt() ->> 'email'), ''))
);

drop policy if exists "push delivery logs admin read" on public.push_delivery_log;
create policy "push delivery logs admin read"
on public.push_delivery_log
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and (
        lower(coalesce(p.role, 'worker')) = 'admin'
        or lower(coalesce(p.email, '')) in (
          'zeth@johngordonconstruction.com',
          'jeff@johngordonconstruction.com'
        )
      )
  )
);

grant select, insert, update, delete on public.push_subscriptions to authenticated;
grant select on public.push_delivery_log to authenticated;
