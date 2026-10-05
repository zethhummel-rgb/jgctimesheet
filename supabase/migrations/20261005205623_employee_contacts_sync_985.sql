-- Accounts are the identity source; Contacts retain directory-specific information.
alter table public.profiles add column if not exists add_to_contacts boolean not null default false;
alter table public.contacts
  add column if not exists employee_profile_id uuid references public.profiles(id) on delete set null,
  add column if not exists employee_linked_at timestamptz,
  add column if not exists employee_contact_status text check (employee_contact_status in ('active','pending','former')),
  add column if not exists employee_directory_hidden boolean not null default false;
create unique index if not exists contacts_employee_profile_id_key on public.contacts(employee_profile_id);

create table if not exists private.employee_contact_link_history (
  id bigint generated always as identity primary key,
  employee_profile_id uuid not null,
  contact_id uuid not null,
  linked_at timestamptz not null default now(),
  linked_by uuid,
  match_method text not null,
  original_contact jsonb not null,
  original_profile_contact jsonb not null
);
alter table private.employee_contact_link_history enable row level security;
create policy employee_contact_history_admin_read on private.employee_contact_link_history
  for select to authenticated using ((select public.is_admin()) and (select private.jgc_has_full_portal_access()));
revoke all on private.employee_contact_link_history from public,anon,authenticated;

create or replace function private.employee_contact_email(value text) returns text
language sql immutable set search_path='' as $$ select lower(btrim(coalesce(value,''))) $$;
create or replace function private.employee_contact_name(value text) returns text
language sql immutable set search_path='' as $$ select lower(regexp_replace(btrim(coalesce(value,'')),'\s+',' ','g')) $$;
create or replace function private.employee_contact_phone(value text) returns text
language sql immutable set search_path='' as $$
  with parsed as (
    select btrim(regexp_replace(btrim(coalesce(value,'')),
      '(extension|ext\.?|x|#)[[:space:]]*([0-9]{1,6})$','','i')) body,
      (regexp_match(btrim(coalesce(value,'')),
      '(extension|ext\.?|x|#)[[:space:]]*([0-9]{1,6})$','i'))[2] extension
  ), normalized as (
    select body,extension,regexp_replace(body,'[^0-9]','','g') digits from parsed
  )
  select case when body ~ '^[+0-9().[:space:]-]+$' and length(digits) between 10 and 15
    then (case when length(digits)=11 and left(digits,1)='1' then substr(digits,2) else digits end)
      || case when extension is null then '' else 'x'||extension end
    else '' end from normalized
$$;
revoke all on function private.employee_contact_email(text),private.employee_contact_name(text),private.employee_contact_phone(text) from public;
grant execute on function private.employee_contact_email(text),private.employee_contact_name(text),private.employee_contact_phone(text) to authenticated;

create or replace function private.employee_contact_candidates(p_profile_id uuid)
returns table(contact_id uuid,name text,email text,phone text,is_active boolean,linked_profile_id uuid,match_quality text,reasons text[])
language sql stable set search_path='' as $$
  with employee as (
    select p.*,private.employee_contact_email(p.email) em,private.employee_contact_phone(p.phone) ph,
      private.employee_contact_name(p.display_name) nm from public.profiles p where p.id=p_profile_id
  ), matches as (
    select c.*,p.em<>'' and p.em=private.employee_contact_email(c.email) email_match,
      p.ph<>'' and p.ph=private.employee_contact_phone(c.phone) phone_match,
      p.nm<>'' and p.nm=private.employee_contact_name(c.name) name_match,
      length(private.employee_contact_name(c.name))>=3 and
        (left(p.nm,length(private.employee_contact_name(c.name))+1)=private.employee_contact_name(c.name)||' '
          or left(private.employee_contact_name(c.name),length(p.nm)+1)=p.nm||' ') shortened_name_match,
      (select count(*) from public.profiles other where private.employee_contact_email(other.email)=p.em)=1 unique_email,
      (select count(*) from public.profiles other where private.employee_contact_phone(other.phone)=p.ph)=1 unique_phone
    from public.contacts c cross join employee p
  )
  select m.id,m.name,m.email,m.phone,m.is_active,m.employee_profile_id,
    case when (m.employee_profile_id is null or m.employee_profile_id=p_profile_id)
      and ((m.email_match and m.unique_email and (m.name_match or m.phone_match or m.shortened_name_match))
        or (m.phone_match and m.name_match and m.unique_phone))
         then 'strong' else 'review' end,
    array_remove(array[case when m.email_match then 'Email matches' end,
      case when m.phone_match then 'Phone matches' end,case when m.name_match then 'Name matches' end],null)
  from matches m where m.email_match or m.phone_match or m.name_match
  order by m.name,m.id
$$;
revoke all on function private.employee_contact_candidates(uuid) from public,anon,authenticated;

create or replace function private.link_employee_contact_internal(
  p_profile_id uuid,p_contact_id uuid default null,p_confirm_review boolean default false,p_method text default 'admin'
) returns uuid language plpgsql security definer set search_path='' as $$
declare
  employee public.profiles%rowtype;
  contact public.contacts%rowtype;
  candidate record;
  candidate_count integer;
  chosen_id uuid;
  before_profile jsonb;
  before_contact jsonb;
begin
  select * into employee from public.profiles where id=p_profile_id for update;
  if not found or employee.role not in ('worker','supervisor','admin') then
    raise exception 'Employee account was not found.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('jgc-employee-contact-links',985));
  select * into contact from public.contacts where employee_profile_id=p_profile_id for update;
  if found then
    if p_contact_id is not null and contact.id<>p_contact_id then raise exception 'This account already has a linked Contact.'; end if;
    return contact.id;
  end if;
  before_profile=jsonb_build_object('display_name',employee.display_name,'email',employee.email,'phone',employee.phone);
  select count(*) into candidate_count from private.employee_contact_candidates(p_profile_id);
  if p_contact_id is null then
    if candidate_count=1 then
      select * into candidate from private.employee_contact_candidates(p_profile_id);
      if candidate.match_quality<>'strong' then raise exception 'Review the existing Contact before linking. No duplicate was created.'; end if;
      chosen_id=candidate.contact_id;
    elsif candidate_count>1 then
      raise exception 'Multiple possible Contacts were found. Select and confirm the correct Contact.';
    end if;
  else
    select * into candidate from private.employee_contact_candidates(p_profile_id) where contact_id=p_contact_id;
    if not found then raise exception 'The selected Contact does not match this employee or is already linked.'; end if;
    if candidate_count<>1 or candidate.match_quality<>'strong' then
      if not coalesce(p_confirm_review,false) then raise exception 'Confirm that the selected Contact is the same employee.'; end if;
    end if;
    chosen_id=p_contact_id;
  end if;
  if chosen_id is not null then
    select * into contact from public.contacts where id=chosen_id for update;
    if not found or (contact.employee_profile_id is not null and contact.employee_profile_id<>p_profile_id) then
      raise exception 'That Contact is already linked to another account.';
    end if;
    before_contact=to_jsonb(contact);
    -- Keep a known contact phone when the old account has never supplied one.
    if private.employee_contact_phone(employee.phone)='' and private.employee_contact_phone(contact.phone)<>'' then
      update public.profiles set phone=contact.phone where id=p_profile_id returning * into employee;
    end if;
    update public.contacts set employee_profile_id=p_profile_id,employee_linked_at=now(),
      employee_directory_hidden=(not contact.is_active and employee.account_status='approved') where id=chosen_id;
  else
    if private.employee_contact_phone(employee.phone)='' then raise exception 'Add a valid phone number to the employee account before adding to Contacts.'; end if;
    insert into public.contacts(name,email,phone,role,is_active,created_by,created_by_name,employee_profile_id,employee_linked_at)
    values(employee.display_name,employee.email,employee.phone,employee.position,false,auth.uid(),
      (select display_name from public.profiles where id=auth.uid()),p_profile_id,now()) returning id into chosen_id;
    before_contact='{}'::jsonb;
  end if;
  insert into private.employee_contact_link_history(employee_profile_id,contact_id,linked_by,match_method,original_contact,original_profile_contact)
  values(p_profile_id,chosen_id,auth.uid(),p_method,before_contact,before_profile);
  update public.profiles set add_to_contacts=true where id=p_profile_id;
  update public.contacts set name=employee.display_name,email=employee.email,phone=employee.phone,
    employee_contact_status=case when employee.account_status='approved' then 'active'
      when employee.account_status='pending' then 'pending' else 'former' end,
    is_active=employee.account_status='approved' and not employee_directory_hidden,updated_at=now()
  where id=chosen_id;
  return chosen_id;
end $$;
revoke all on function private.link_employee_contact_internal(uuid,uuid,boolean,text) from public,anon,authenticated;

create or replace function private.sync_employee_contact() returns trigger
language plpgsql security definer set search_path='' as $$
declare linked_id uuid; candidate_count integer; quality text;
begin
  if tg_op='DELETE' then
    update public.contacts set is_active=false,employee_contact_status='former',updated_at=now() where employee_profile_id=old.id;
    return old;
  end if;
  if pg_trigger_depth()>1 then return new; end if;
  select id into linked_id from public.contacts where employee_profile_id=new.id;
  if linked_id is null and new.add_to_contacts and new.account_status='approved' and new.role in ('worker','supervisor','admin') then
    select count(*),min(match_quality) into candidate_count,quality from private.employee_contact_candidates(new.id);
    if candidate_count=0 or (candidate_count=1 and quality='strong') then
      perform private.link_employee_contact_internal(new.id,null,false,'profile opt-in');
    end if; -- Ambiguous matches wait for an admin review; never manufacture a duplicate.
  elsif linked_id is not null then
    update public.contacts set name=new.display_name,email=new.email,phone=new.phone,
      employee_contact_status=case when new.account_status='approved' and new.role in ('worker','supervisor','admin') then 'active'
        when new.account_status='pending' then 'pending' else 'former' end,
      is_active=new.account_status='approved' and new.role in ('worker','supervisor','admin') and new.add_to_contacts and not employee_directory_hidden,
      updated_at=now() where id=linked_id;
  end if;
  return new;
end $$;
revoke all on function private.sync_employee_contact() from public,anon,authenticated;
create trigger sync_employee_contact_from_profile after insert or update of display_name,email,phone,account_status,role,add_to_contacts
  on public.profiles for each row execute function private.sync_employee_contact();
create trigger preserve_contact_before_employee_delete before delete on public.profiles
  for each row execute function private.sync_employee_contact();

create or replace function private.guard_employee_contact() returns trigger
language plpgsql set search_path='' as $$
begin
  if tg_op='DELETE' then
    if old.employee_linked_at is not null then raise exception 'Archive employee Contacts instead of deleting their history.'; end if;
    return old;
  end if;
  if current_user in ('authenticated','anon') then
    if tg_op='INSERT' then
      if new.employee_profile_id is not null or new.employee_linked_at is not null or new.employee_contact_status is not null then
        raise exception 'Use Add to Contacts on Accounts to link an employee.';
      end if;
    else
      if new.employee_profile_id is distinct from old.employee_profile_id or new.employee_linked_at is distinct from old.employee_linked_at
         or new.employee_contact_status is distinct from old.employee_contact_status then
        raise exception 'Employee links are managed from Accounts.';
      end if;
      if old.employee_linked_at is not null and (new.name is distinct from old.name or new.email is distinct from old.email or new.phone is distinct from old.phone) then
        raise exception 'Edit the linked employee account to change name, email or phone. Contact notes remain editable here.';
      end if;
      if old.employee_linked_at is not null and new.is_active is distinct from old.is_active then
        if new.is_active and old.employee_contact_status<>'active' then raise exception 'Reactivate the employee account before showing this Contact.'; end if;
        new.employee_directory_hidden=not new.is_active;
      end if;
    end if;
  end if;
  return new;
end $$;
revoke all on function private.guard_employee_contact() from public,anon,authenticated;
create trigger guard_employee_contact_link before insert or update or delete on public.contacts
  for each row execute function private.guard_employee_contact();

create or replace function private.guard_employee_profile_identity() returns trigger
language plpgsql set search_path='' as $$
begin
  if tg_op='INSERT' or new.display_name is distinct from old.display_name then
    if length(btrim(coalesce(new.display_name,''))) not between 2 and 80 then raise exception 'Enter your full name (2 to 80 characters).'; end if;
  end if;
  if tg_op='INSERT' or new.email is distinct from old.email then
    if length(coalesce(new.email,''))>254 or coalesce(new.email,'')!~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then raise exception 'Enter a valid email address.'; end if;
  end if;
  if tg_op='INSERT' or new.phone is distinct from old.phone then
    if private.employee_contact_phone(new.phone)='' then raise exception 'Enter a valid phone number, including its area code.'; end if;
  end if;
  return new;
end $$;
revoke all on function private.guard_employee_profile_identity() from public,anon,authenticated;
create trigger require_employee_profile_identity before insert or update of display_name,email,phone on public.profiles
  for each row execute function private.guard_employee_profile_identity();

-- New accounts always require approval. User-editable metadata never grants a role.
create or replace function private.handle_new_auth_user() returns trigger
language plpgsql security definer set search_path='' as $$
declare requested_name text; requested_phone text;
begin
  requested_name=regexp_replace(btrim(coalesce(new.raw_user_meta_data->>'display_name','')),'\s+',' ','g');
  requested_phone=btrim(coalesce(new.raw_user_meta_data->>'phone',''));
  insert into public.profiles(id,email,display_name,worker_key,phone,role,account_status,add_to_contacts)
  values(new.id,lower(btrim(new.email)),requested_name,lower(requested_name),requested_phone,'worker','pending',
    coalesce(new.raw_user_meta_data->>'add_to_contacts','false')='true') on conflict(id) do nothing;
  return new;
end $$;
revoke all on function private.handle_new_auth_user() from public,anon,authenticated;

create or replace function private.get_employee_contact_links_impl() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or not public.is_admin() or not private.jgc_has_full_portal_access() then raise exception 'Approved admin access is required.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('profile_id',p.id,'add_to_contacts',p.add_to_contacts,
    'contact_id',c.id,'contact_active',c.is_active,'contact_status',c.employee_contact_status,'directory_hidden',c.employee_directory_hidden,
    'candidates',case when c.id is null then coalesce((select jsonb_agg(to_jsonb(m)) from private.employee_contact_candidates(p.id) m),'[]'::jsonb) else '[]'::jsonb end))
    from public.profiles p left join public.contacts c on c.employee_profile_id=p.id
    where p.role in ('worker','supervisor','admin')),'[]'::jsonb);
end $$;
create or replace function public.get_employee_contact_links() returns jsonb
language sql stable security invoker set search_path='' as $$ select private.get_employee_contact_links_impl() $$;

create or replace function private.link_employee_contact_impl(p_profile_id uuid,p_contact_id uuid default null,p_confirm_review boolean default false)
returns uuid language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or not public.is_admin() or not private.jgc_has_full_portal_access() then raise exception 'Approved admin access is required.'; end if;
  return private.link_employee_contact_internal(p_profile_id,p_contact_id,p_confirm_review,'admin confirmed');
end $$;
create or replace function public.link_employee_contact(p_profile_id uuid,p_contact_id uuid default null,p_confirm_review boolean default false)
returns uuid language sql security invoker set search_path='' as $$ select private.link_employee_contact_impl(p_profile_id,p_contact_id,p_confirm_review) $$;

create or replace function private.save_employee_contact_details_impl(
 p_profile_id uuid,p_name text,p_email text,p_phone text,p_add_to_contacts boolean default false,
 p_contact_id uuid default null,p_confirm_review boolean default false
) returns jsonb language plpgsql security definer set search_path='' as $$
declare employee public.profiles%rowtype;
begin
  if auth.uid() is null or not public.is_admin() or not private.jgc_has_full_portal_access() then raise exception 'Approved admin access is required.'; end if;
  if private.employee_contact_phone(p_phone)='' then raise exception 'Enter a valid phone number, including its area code.'; end if;
  select * into employee from public.profiles where id=p_profile_id for update;
  if not found or employee.role not in ('worker','supervisor','admin') then raise exception 'Employee account was not found.'; end if;
  update public.profiles set display_name=regexp_replace(btrim(p_name),'\s+',' ','g'),email=lower(btrim(p_email)),phone=btrim(p_phone),
    add_to_contacts=coalesce(p_add_to_contacts,false) or exists(select 1 from public.contacts where employee_profile_id=p_profile_id),updated_at=now()
  where id=p_profile_id returning * into employee;
  if p_add_to_contacts then perform private.link_employee_contact_internal(p_profile_id,p_contact_id,p_confirm_review,'admin confirmed'); end if;
  return jsonb_build_object('profile_id',p_profile_id,'contact_id',(select id from public.contacts where employee_profile_id=p_profile_id));
end $$;
create or replace function public.save_employee_contact_details(
 p_profile_id uuid,p_name text,p_email text,p_phone text,p_add_to_contacts boolean default false,
 p_contact_id uuid default null,p_confirm_review boolean default false
) returns jsonb language sql security invoker set search_path='' as $$
 select private.save_employee_contact_details_impl(p_profile_id,p_name,p_email,p_phone,p_add_to_contacts,p_contact_id,p_confirm_review)
$$;

-- Preserve this API signature for existing profile editors; restrict the update to its owner.
create or replace function private.save_my_employee_contact_profile_impl(
 p_email text,p_phone text,p_emergency_contact text,p_address text,p_avatar_path text
) returns table(id uuid,email text,display_name text,worker_key text,phone text,emergency_contact text,address text,avatar_path text)
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if private.employee_contact_phone(p_phone)='' then raise exception 'Enter a valid phone number, including its area code.'; end if;
  if not exists(select 1 from public.profiles p where p.id=auth.uid() and p.account_status in ('approved','limited')) then raise exception 'Profile access is unavailable.'; end if;
  update public.profiles p set email=lower(btrim(p_email)),phone=btrim(p_phone),emergency_contact=coalesce(p_emergency_contact,''),
    address=coalesce(p_address,''),avatar_path=p_avatar_path,last_portal_activity=now(),updated_at=now() where p.id=auth.uid();
  return query select p.id,p.email,p.display_name,p.worker_key,p.phone,p.emergency_contact,p.address,p.avatar_path
    from public.profiles p where p.id=auth.uid();
end $$;
create or replace function public.save_my_employee_profile(p_email text,p_phone text,p_emergency_contact text,p_address text,p_avatar_path text)
returns table(id uuid,email text,display_name text,worker_key text,phone text,emergency_contact text,address text,avatar_path text)
language sql security invoker set search_path='' as $$
  select * from private.save_my_employee_contact_profile_impl(p_email,p_phone,p_emergency_contact,p_address,p_avatar_path)
$$;

revoke all on function private.get_employee_contact_links_impl(),private.link_employee_contact_impl(uuid,uuid,boolean),
 private.save_employee_contact_details_impl(uuid,text,text,text,boolean,uuid,boolean),private.save_my_employee_contact_profile_impl(text,text,text,text,text),
 public.get_employee_contact_links(),public.link_employee_contact(uuid,uuid,boolean),
 public.save_employee_contact_details(uuid,text,text,text,boolean,uuid,boolean),public.save_my_employee_profile(text,text,text,text,text) from public,anon,authenticated;
grant execute on function private.get_employee_contact_links_impl(),private.link_employee_contact_impl(uuid,uuid,boolean),
 private.save_employee_contact_details_impl(uuid,text,text,text,boolean,uuid,boolean),private.save_my_employee_contact_profile_impl(text,text,text,text,text),
 public.get_employee_contact_links(),public.link_employee_contact(uuid,uuid,boolean),
 public.save_employee_contact_details(uuid,text,text,text,boolean,uuid,boolean),public.save_my_employee_profile(text,text,text,text,text) to authenticated;

-- Existing contacts are reused only when one unambiguous strong match exists.
-- Name-only matches and ambiguous identifiers remain unlinked for explicit admin review.
do $$
declare employee record; candidate_count integer; quality text;
begin
  for employee in select id from public.profiles where role in ('worker','supervisor','admin') order by id loop
    select count(*),min(match_quality) into candidate_count,quality from private.employee_contact_candidates(employee.id);
    if candidate_count=1 and quality='strong' then
      perform private.link_employee_contact_internal(employee.id,null,false,'existing normalized identity match');
    end if;
  end loop;
end $$;
