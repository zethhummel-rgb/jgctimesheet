-- Employee behaviour / attendance / safety write-ups.
-- Visible only to approved admins and the affected employee. Tables are read-only
-- to clients; every change goes through the checked functions below. Versions and
-- acknowledgements are never updated or deleted, so the history stays intact.

create table public.employee_writeups (
  id uuid primary key,
  employee_profile_id uuid not null references public.profiles(id),
  employee_name text not null,
  status text not null default 'draft' check (status in ('draft', 'sent', 'acknowledged', 'voided')),
  current_version integer not null default 1 check (current_version > 0),
  incident_date date not null,
  categories text[] not null default '{}',
  created_by uuid not null references auth.users(id),
  created_by_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  acknowledged_at timestamptz,
  voided_at timestamptz,
  voided_by uuid references auth.users(id),
  void_reason text,
  check ((status = 'voided') = (voided_at is not null))
);

create table public.employee_writeup_versions (
  writeup_id uuid not null references public.employee_writeups(id),
  version integer not null check (version > 0),
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 262144),
  change_note text not null default '',
  created_by uuid not null references auth.users(id),
  created_by_name text not null default '',
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  primary key (writeup_id, version)
);

create table public.employee_writeup_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  writeup_id uuid not null,
  version integer not null,
  employee_profile_id uuid not null references public.profiles(id),
  printed_name text not null check (length(trim(printed_name)) between 1 and 150),
  signature jsonb not null check (jsonb_typeof(signature) = 'array' and octet_length(signature::text) <= 204800),
  employee_comment text not null default '' check (length(employee_comment) <= 4000),
  acknowledged_at timestamptz not null default now(),
  user_agent text not null default '',
  foreign key (writeup_id, version) references public.employee_writeup_versions(writeup_id, version),
  unique (writeup_id, version)
);

create index employee_writeups_employee_idx on public.employee_writeups(employee_profile_id, incident_date desc);
create index employee_writeups_updated_idx on public.employee_writeups(updated_at desc);
create index employee_writeups_created_by_idx on public.employee_writeups(created_by);
create index employee_writeups_voided_by_idx on public.employee_writeups(voided_by);
create index employee_writeup_versions_created_by_idx on public.employee_writeup_versions(created_by);
create index employee_writeup_acks_employee_idx on public.employee_writeup_acknowledgements(employee_profile_id);

alter table public.employee_writeups enable row level security;
alter table public.employee_writeup_versions enable row level security;
alter table public.employee_writeup_acknowledgements enable row level security;

-- Explicit grants (Supabase no longer exposes new tables automatically). Read-only for clients.
revoke all on public.employee_writeups, public.employee_writeup_versions, public.employee_writeup_acknowledgements from public, anon, authenticated;
grant select on public.employee_writeups, public.employee_writeup_versions, public.employee_writeup_acknowledgements to authenticated;
grant all on public.employee_writeups, public.employee_writeup_versions, public.employee_writeup_acknowledgements to service_role;

create policy "Admins and the affected employee read write-ups" on public.employee_writeups
  for select to authenticated
  using ((select public.is_admin()) or (employee_profile_id = (select auth.uid()) and status <> 'draft'));

create policy "Admins and the affected employee read sent versions" on public.employee_writeup_versions
  for select to authenticated
  using ((select public.is_admin()) or (sent_at is not null and exists (
    select 1 from public.employee_writeups w
    where w.id = writeup_id and w.employee_profile_id = (select auth.uid()) and w.status <> 'draft')));

create policy "Admins and the affected employee read acknowledgements" on public.employee_writeup_acknowledgements
  for select to authenticated
  using ((select public.is_admin()) or employee_profile_id = (select auth.uid()));

create function private.jgc_validate_employee_writeup(p_payload jsonb)
returns void language plpgsql stable set search_path = '' as $$
declare allowed text[] := array['lateness_attendance','sent_home','behaviour_attitude','ppe_harness','safety_violation','failure_to_follow_direction','other'];
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' or octet_length(p_payload::text) > 262144 then raise exception 'Invalid write-up'; end if;
  if jsonb_typeof(p_payload->'categories') is distinct from 'array' or jsonb_array_length(p_payload->'categories') = 0 then raise exception 'Choose at least one issue type'; end if;
  if exists (select 1 from jsonb_array_elements(p_payload->'categories') c where jsonb_typeof(c) <> 'string' or not (c #>> '{}') = any(allowed)) then raise exception 'Unknown issue type'; end if;
  if (p_payload->'categories') ? 'other' and coalesce(length(trim(p_payload->>'custom_issue')), 0) = 0 then raise exception 'Describe the custom issue'; end if;
  if coalesce(p_payload->>'incident_date', '') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Enter the incident date'; end if;
  perform (p_payload->>'incident_date')::date;
  if (p_payload->>'incident_date')::date > current_date + 1 then raise exception 'The incident date cannot be in the future'; end if;
  if coalesce(p_payload->>'location_mode', '') not in ('job', 'manual') then raise exception 'Choose a job or enter a location'; end if;
  if p_payload->>'location_mode' = 'job' and coalesce(length(trim(p_payload#>>'{job,job_number}')), 0) = 0 then raise exception 'Select the job'; end if;
  if p_payload->>'location_mode' = 'manual' and coalesce(length(trim(p_payload->>'location')), 0) = 0 then raise exception 'Enter the location'; end if;
  if coalesce(length(trim(p_payload->>'description')), 0) = 0 then raise exception 'Enter the factual description'; end if;
  if coalesce(length(trim(p_payload->>'action_taken')), 0) = 0 then raise exception 'Enter the action taken'; end if;
  if coalesce(length(trim(p_payload->>'expectations')), 0) = 0 then raise exception 'Enter the corrective expectations'; end if;
end $$;

create function private.jgc_save_employee_writeup(p_id uuid, p_expected_version integer, p_employee uuid, p_payload jsonb, p_send boolean, p_change_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare item public.employee_writeups; ver public.employee_writeup_versions; person public.profiles; author public.profiles; cats text[];
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Admin access required' using errcode = '42501'; end if;
  if p_id is null then raise exception 'Invalid write-up'; end if;
  perform private.jgc_validate_employee_writeup(p_payload);
  select array_agg(c) into cats from jsonb_array_elements_text(p_payload->'categories') c;
  select * into author from public.profiles where id = auth.uid();
  perform pg_advisory_xact_lock(hashtextextended(p_id::text, 0));
  select * into item from public.employee_writeups where id = p_id for update;

  if not found then
    if p_expected_version is distinct from 0 then raise exception 'Write-up not found'; end if;
    select * into person from public.profiles where id = p_employee;
    if not found then raise exception 'Choose the employee'; end if;
    insert into public.employee_writeups(id, employee_profile_id, employee_name, status, incident_date, categories, created_by, created_by_name, sent_at)
    values (p_id, person.id, coalesce(nullif(person.display_name, ''), person.email), case when p_send then 'sent' else 'draft' end,
      (p_payload->>'incident_date')::date, cats, auth.uid(), coalesce(nullif(author.display_name, ''), author.email, ''), case when p_send then now() end)
    returning * into item;
    insert into public.employee_writeup_versions(writeup_id, version, payload, created_by, created_by_name, sent_at)
    values (p_id, 1, p_payload, auth.uid(), item.created_by_name, case when p_send then now() end) returning * into ver;
    return jsonb_build_object('writeup', to_jsonb(item), 'version', to_jsonb(ver), 'notify', p_send);
  end if;

  if item.status = 'voided' then raise exception 'This write-up was voided'; end if;
  select * into ver from public.employee_writeup_versions where writeup_id = p_id and version = item.current_version;
  -- Retry of a save whose response was lost: return the stored result instead of a conflict.
  if ver.payload = p_payload and (item.status <> 'draft') = coalesce(p_send, false) and item.employee_profile_id = p_employee then
    return jsonb_build_object('writeup', to_jsonb(item), 'version', to_jsonb(ver), 'notify', false);
  end if;
  if item.current_version is distinct from p_expected_version then raise exception 'This write-up changed elsewhere. Reopen it before saving.' using errcode = '40001'; end if;

  if item.status = 'draft' then
    if p_employee is distinct from item.employee_profile_id then
      select * into person from public.profiles where id = p_employee;
      if not found then raise exception 'Choose the employee'; end if;
      update public.employee_writeups set employee_profile_id = person.id, employee_name = coalesce(nullif(person.display_name, ''), person.email) where id = p_id;
    end if;
    update public.employee_writeup_versions set payload = p_payload, sent_at = case when p_send then now() end, created_at = now()
      where writeup_id = p_id and version = 1 returning * into ver;
    update public.employee_writeups set status = case when p_send then 'sent' else 'draft' end, incident_date = (p_payload->>'incident_date')::date,
      categories = cats, sent_at = case when p_send then now() end, updated_at = now() where id = p_id returning * into item;
    return jsonb_build_object('writeup', to_jsonb(item), 'version', to_jsonb(ver), 'notify', p_send);
  end if;

  -- Sent or acknowledged: corrections become a new version the employee must acknowledge.
  if not coalesce(p_send, false) then raise exception 'Corrections to a sent write-up are sent to the employee'; end if;
  if p_employee is distinct from item.employee_profile_id then raise exception 'The employee cannot change after sending. Void it and create a new write-up.'; end if;
  if coalesce(length(trim(p_change_note)), 0) = 0 then raise exception 'Explain what changed'; end if;
  insert into public.employee_writeup_versions(writeup_id, version, payload, change_note, created_by, created_by_name, sent_at)
  values (p_id, item.current_version + 1, p_payload, left(trim(p_change_note), 1000), auth.uid(), coalesce(nullif(author.display_name, ''), author.email, ''), now())
  returning * into ver;
  update public.employee_writeups set current_version = ver.version, status = 'sent', acknowledged_at = null, incident_date = (p_payload->>'incident_date')::date,
    categories = cats, updated_at = now() where id = p_id returning * into item;
  return jsonb_build_object('writeup', to_jsonb(item), 'version', to_jsonb(ver), 'notify', true);
end $$;

create function private.jgc_acknowledge_employee_writeup(p_id uuid, p_version integer, p_printed_name text, p_signature jsonb, p_comment text, p_user_agent text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare item public.employee_writeups; ack public.employee_writeup_acknowledgements;
begin
  if auth.uid() is null then raise exception 'Sign in to acknowledge' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_id::text, 0));
  select * into item from public.employee_writeups where id = p_id for update;
  if not found or item.employee_profile_id is distinct from auth.uid() or item.status = 'draft' then raise exception 'Write-up not found' using errcode = '42501'; end if;
  select * into ack from public.employee_writeup_acknowledgements where writeup_id = p_id and version = p_version;
  if found then return jsonb_build_object('writeup', to_jsonb(item), 'acknowledgement', to_jsonb(ack), 'notify', false); end if;
  if item.status = 'voided' then raise exception 'This write-up was voided'; end if;
  if p_version is distinct from item.current_version then raise exception 'This write-up was updated. Reopen it to review the latest version.' using errcode = '40001'; end if;
  if coalesce(length(trim(p_printed_name)), 0) not between 1 and 150 then raise exception 'Enter your printed name'; end if;
  if p_signature is null or jsonb_typeof(p_signature) <> 'array' or jsonb_array_length(p_signature) = 0 or octet_length(p_signature::text) > 204800 then raise exception 'Add your signature'; end if;
  if length(coalesce(p_comment, '')) > 4000 then raise exception 'Comments are limited to 4000 characters'; end if;
  insert into public.employee_writeup_acknowledgements(writeup_id, version, employee_profile_id, printed_name, signature, employee_comment, user_agent)
  values (p_id, p_version, auth.uid(), trim(p_printed_name), p_signature, coalesce(p_comment, ''), left(coalesce(p_user_agent, ''), 400)) returning * into ack;
  update public.employee_writeups set status = 'acknowledged', acknowledged_at = ack.acknowledged_at, updated_at = now() where id = p_id returning * into item;
  return jsonb_build_object('writeup', to_jsonb(item), 'acknowledgement', to_jsonb(ack), 'notify', true);
end $$;

create function private.jgc_void_employee_writeup(p_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare item public.employee_writeups;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Admin access required' using errcode = '42501'; end if;
  if coalesce(length(trim(p_reason)), 0) = 0 then raise exception 'Enter the reason for voiding'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_id::text, 0));
  select * into item from public.employee_writeups where id = p_id for update;
  if not found then raise exception 'Write-up not found'; end if;
  if item.status = 'voided' then return to_jsonb(item); end if;
  update public.employee_writeups set status = 'voided', voided_at = now(), voided_by = auth.uid(), void_reason = left(trim(p_reason), 1000), updated_at = now()
    where id = p_id returning * into item;
  return to_jsonb(item);
end $$;

revoke all on function private.jgc_validate_employee_writeup(jsonb) from public, anon, authenticated;
revoke all on function private.jgc_save_employee_writeup(uuid, integer, uuid, jsonb, boolean, text) from public, anon;
revoke all on function private.jgc_acknowledge_employee_writeup(uuid, integer, text, jsonb, text, text) from public, anon;
revoke all on function private.jgc_void_employee_writeup(uuid, text) from public, anon;
grant execute on function private.jgc_save_employee_writeup(uuid, integer, uuid, jsonb, boolean, text),
  private.jgc_acknowledge_employee_writeup(uuid, integer, text, jsonb, text, text),
  private.jgc_void_employee_writeup(uuid, text) to authenticated;

create function public.save_employee_writeup(p_id uuid, p_expected_version integer, p_employee uuid, p_payload jsonb, p_send boolean, p_change_note text default '')
returns jsonb language sql security invoker set search_path = '' as $$ select private.jgc_save_employee_writeup(p_id, p_expected_version, p_employee, p_payload, p_send, p_change_note) $$;
create function public.acknowledge_employee_writeup(p_id uuid, p_version integer, p_printed_name text, p_signature jsonb, p_comment text default '', p_user_agent text default '')
returns jsonb language sql security invoker set search_path = '' as $$ select private.jgc_acknowledge_employee_writeup(p_id, p_version, p_printed_name, p_signature, p_comment, p_user_agent) $$;
create function public.void_employee_writeup(p_id uuid, p_reason text)
returns jsonb language sql security invoker set search_path = '' as $$ select private.jgc_void_employee_writeup(p_id, p_reason) $$;

revoke all on function public.save_employee_writeup(uuid, integer, uuid, jsonb, boolean, text),
  public.acknowledge_employee_writeup(uuid, integer, text, jsonb, text, text),
  public.void_employee_writeup(uuid, text) from public, anon;
grant execute on function public.save_employee_writeup(uuid, integer, uuid, jsonb, boolean, text),
  public.acknowledge_employee_writeup(uuid, integer, text, jsonb, text, text),
  public.void_employee_writeup(uuid, text) to authenticated;

insert into public.notification_settings(notification_type, label, description, employee_enabled, supervisor_enabled, admin_enabled)
select 'employee_writeup', 'Employee write-ups', 'Write-up sent to an employee for review, and admin notice when it is acknowledged.', true, false, true
where not exists (select 1 from public.notification_settings where notification_type = 'employee_writeup');
