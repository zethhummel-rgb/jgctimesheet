create table if not exists public.subcontractor_portal_activity (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,
  contact_name text not null,
  company_name text not null,
  email text not null,
  phone text,
  page text,
  action text not null default 'page_view',
  user_agent text,
  created_at timestamptz not null default now()
);

alter table public.subcontractor_portal_activity
  add column if not exists session_id text not null default '',
  add column if not exists contact_name text not null default '',
  add column if not exists company_name text not null default '',
  add column if not exists email text not null default '',
  add column if not exists phone text,
  add column if not exists page text,
  add column if not exists action text not null default 'page_view',
  add column if not exists user_agent text,
  add column if not exists created_at timestamptz not null default now();

create index if not exists subcontractor_portal_activity_created_at_idx
  on public.subcontractor_portal_activity (created_at desc);

create index if not exists subcontractor_portal_activity_email_idx
  on public.subcontractor_portal_activity (lower(email));

alter table public.subcontractor_portal_activity enable row level security;

grant usage on schema public to anon, authenticated;
grant insert on public.subcontractor_portal_activity to anon, authenticated;
grant select, delete on public.subcontractor_portal_activity to authenticated;

drop policy if exists "Anyone can record subcontractor portal activity" on public.subcontractor_portal_activity;
create policy "Anyone can record subcontractor portal activity"
on public.subcontractor_portal_activity
for insert
to anon, authenticated
with check (
  length(trim(email)) between 3 and 254
  and position('@' in email) > 1
  and length(trim(contact_name)) between 2 and 120
  and length(trim(company_name)) between 2 and 160
);

drop policy if exists "Admins can read subcontractor portal activity" on public.subcontractor_portal_activity;
create policy "Admins can read subcontractor portal activity"
on public.subcontractor_portal_activity
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.account_status = 'approved'
      and (
        p.role = 'admin'
        or lower(p.email) in ('zeth@johngordonconstruction.com', 'jeff@johngordonconstruction.com')
      )
  )
);

drop policy if exists "Admins can delete subcontractor portal activity" on public.subcontractor_portal_activity;
create policy "Admins can delete subcontractor portal activity"
on public.subcontractor_portal_activity
for delete
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.account_status = 'approved'
      and (
        p.role = 'admin'
        or lower(p.email) in ('zeth@johngordonconstruction.com', 'jeff@johngordonconstruction.com')
      )
  )
);

do $$
declare
  table_name text;
  policy_name text;
begin
  foreach table_name in array array[
    'inspection_records',
    'daily_site_reports',
    'incident_reports',
    'accident_reports',
    'accident_report_acknowledgements',
    'employee_injury_reports',
    'employee_injury_acknowledgements',
    'toolbox_talk_reports',
    'toolbox_talk_attendance'
  ]
  loop
    if to_regclass('public.' || quote_ident(table_name)) is not null then
      execute format('grant insert on public.%I to anon, authenticated', table_name);
      policy_name := 'Subcontractors can submit ' || table_name;
      execute format('drop policy if exists %I on public.%I', policy_name, table_name);
      execute format(
        'create policy %I on public.%I for insert to anon, authenticated with check (auth.role() in (''anon'', ''authenticated''))',
        policy_name,
        table_name
      );
    end if;
  end loop;
end $$;

do $$
declare
  table_name text;
  policy_name text;
begin
  foreach table_name in array array['contacts', 'policies', 'announcements']
  loop
    if to_regclass('public.' || quote_ident(table_name)) is not null then
      execute format('grant select on public.%I to anon, authenticated', table_name);
      policy_name := 'Subcontractors can read active ' || table_name;
      execute format('drop policy if exists %I on public.%I', policy_name, table_name);
      execute format(
        'create policy %I on public.%I for select to anon, authenticated using (coalesce(is_active, true) = true)',
        policy_name,
        table_name
      );
    end if;
  end loop;
end $$;
