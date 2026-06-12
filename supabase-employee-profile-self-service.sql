create or replace function public.get_my_employee_profile()
returns table (
  id uuid,
  email text,
  display_name text,
  worker_key text,
  phone text,
  emergency_contact text,
  address text,
  avatar_path text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auth_email text := lower(coalesce(auth.email(), ''));
  v_auth_id uuid := auth.uid();
begin
  if v_auth_id is null then
    raise exception 'Not authenticated';
  end if;

  return query
  select p.id, p.email, p.display_name, p.worker_key, p.phone, p.emergency_contact, p.address, p.avatar_path
  from public.profiles p
  where p.id = v_auth_id
     or lower(p.email) = v_auth_email
  order by case when p.id = v_auth_id then 0 else 1 end
  limit 1;
end;
$$;

grant execute on function public.get_my_employee_profile() to authenticated;

create or replace function public.save_my_employee_profile(
  p_email text,
  p_phone text,
  p_emergency_contact text,
  p_address text,
  p_avatar_path text
)
returns table (
  id uuid,
  email text,
  display_name text,
  worker_key text,
  phone text,
  emergency_contact text,
  address text,
  avatar_path text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auth_email text := lower(coalesce(auth.email(), ''));
  v_auth_id uuid := auth.uid();
  v_profile_id uuid;
begin
  if v_auth_id is null then
    raise exception 'Not authenticated';
  end if;

  select p.id
    into v_profile_id
  from public.profiles p
  where p.id = v_auth_id
     or lower(p.email) = v_auth_email
  order by case when p.id = v_auth_id then 0 else 1 end
  limit 1;

  if v_profile_id is null then
    raise exception 'Profile not found for signed-in account';
  end if;

  update public.profiles p
  set email = coalesce(nullif(trim(p_email), ''), p.email),
      phone = coalesce(p_phone, ''),
      emergency_contact = coalesce(p_emergency_contact, ''),
      address = coalesce(p_address, ''),
      avatar_path = p_avatar_path,
      last_portal_activity = now()
  where p.id = v_profile_id;

  return query
  select p.id, p.email, p.display_name, p.worker_key, p.phone, p.emergency_contact, p.address, p.avatar_path
  from public.profiles p
  where p.id = v_profile_id;
end;
$$;

grant execute on function public.save_my_employee_profile(text, text, text, text, text) to authenticated;
