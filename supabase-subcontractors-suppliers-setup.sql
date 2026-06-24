create table if not exists public.subcontractors_suppliers (
  id uuid primary key default gen_random_uuid(),
  company_name text not null,
  category text not null default 'Subcontractor',
  service_type text,
  contact_name text,
  phone text,
  email text,
  notes text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.subcontractors_suppliers
  add column if not exists company_name text not null default '',
  add column if not exists category text not null default 'Subcontractor',
  add column if not exists service_type text,
  add column if not exists contact_name text,
  add column if not exists phone text,
  add column if not exists email text,
  add column if not exists notes text,
  add column if not exists sort_order integer not null default 0,
  add column if not exists is_active boolean not null default true,
  add column if not exists created_by uuid references auth.users(id) on delete set null,
  add column if not exists created_by_name text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create index if not exists subcontractors_suppliers_active_sort_idx
  on public.subcontractors_suppliers (is_active, sort_order, lower(company_name));

create index if not exists subcontractors_suppliers_category_idx
  on public.subcontractors_suppliers (category);

create table if not exists public.subcontractor_supplier_contacts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.subcontractors_suppliers(id) on delete cascade,
  contact_name text not null,
  role text,
  phone text,
  email text,
  notes text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.subcontractor_supplier_contacts
  add column if not exists company_id uuid references public.subcontractors_suppliers(id) on delete cascade,
  add column if not exists contact_name text not null default '',
  add column if not exists role text,
  add column if not exists phone text,
  add column if not exists email text,
  add column if not exists notes text,
  add column if not exists sort_order integer not null default 0,
  add column if not exists is_active boolean not null default true,
  add column if not exists created_by uuid references auth.users(id) on delete set null,
  add column if not exists created_by_name text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create index if not exists subcontractor_supplier_contacts_company_idx
  on public.subcontractor_supplier_contacts (company_id, is_active, sort_order, lower(contact_name));

create or replace function public.set_subcontractors_suppliers_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists subcontractors_suppliers_updated_at on public.subcontractors_suppliers;
create trigger subcontractors_suppliers_updated_at
before update on public.subcontractors_suppliers
for each row
execute function public.set_subcontractors_suppliers_updated_at();

create or replace function public.set_subcontractor_supplier_contacts_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists subcontractor_supplier_contacts_updated_at on public.subcontractor_supplier_contacts;
create trigger subcontractor_supplier_contacts_updated_at
before update on public.subcontractor_supplier_contacts
for each row
execute function public.set_subcontractor_supplier_contacts_updated_at();

insert into public.subcontractor_supplier_contacts (
  company_id,
  contact_name,
  role,
  phone,
  email,
  notes,
  sort_order,
  is_active,
  created_by,
  created_by_name
)
select
  s.id,
  coalesce(nullif(trim(coalesce(s.contact_name, '')), ''), 'Main Contact'),
  'Main Contact',
  nullif(trim(coalesce(s.phone, '')), ''),
  nullif(trim(coalesce(s.email, '')), ''),
  null,
  0,
  true,
  s.created_by,
  s.created_by_name
from public.subcontractors_suppliers s
where (
    nullif(trim(coalesce(s.contact_name, '')), '') is not null
    or nullif(trim(coalesce(s.phone, '')), '') is not null
    or nullif(trim(coalesce(s.email, '')), '') is not null
  )
  and not exists (
    select 1
    from public.subcontractor_supplier_contacts c
    where c.company_id = s.id
  );

alter table public.subcontractors_suppliers enable row level security;
alter table public.subcontractor_supplier_contacts enable row level security;

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.subcontractors_suppliers to authenticated;
grant select, insert, update, delete on public.subcontractor_supplier_contacts to authenticated;

drop policy if exists "Approved users can read active subcontractors suppliers" on public.subcontractors_suppliers;
create policy "Approved users can read active subcontractors suppliers"
on public.subcontractors_suppliers
for select
to authenticated
using (
  is_active = true
  and exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.account_status = 'approved'
  )
);

drop policy if exists "Admins can manage subcontractors suppliers" on public.subcontractors_suppliers;
create policy "Admins can manage subcontractors suppliers"
on public.subcontractors_suppliers
for all
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
)
with check (
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

drop policy if exists "Approved users can read active subcontractor supplier contacts" on public.subcontractor_supplier_contacts;
create policy "Approved users can read active subcontractor supplier contacts"
on public.subcontractor_supplier_contacts
for select
to authenticated
using (
  is_active = true
  and exists (
    select 1
    from public.subcontractors_suppliers s
    where s.id = public.subcontractor_supplier_contacts.company_id
      and s.is_active = true
  )
  and exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.account_status = 'approved'
  )
);

drop policy if exists "Admins can manage subcontractor supplier contacts" on public.subcontractor_supplier_contacts;
create policy "Admins can manage subcontractor supplier contacts"
on public.subcontractor_supplier_contacts
for all
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
)
with check (
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
