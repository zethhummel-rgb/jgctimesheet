create table if not exists public.safety_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  record_type text not null check (record_type in ('jsa', 'toolbox_talk')),
  record_id uuid not null,
  record_title text,
  record_date date,
  job_id uuid,
  job_number text,
  job_name text,
  project text,
  location text,
  attendee_name text not null,
  attendee_key text not null,
  attendee_company text default '',
  attendee_type text not null default 'unknown' check (attendee_type in ('employee', 'external', 'visitor', 'inspector', 'unknown')),
  matched_employee_id uuid,
  matched_employee_email text,
  acknowledgement_status text not null default 'pending' check (
    acknowledgement_status in (
      'pending',
      'acknowledged_by_user',
      'acknowledged_by_creator',
      'acknowledged_by_qr',
      'late_acknowledgement',
      'not_required',
      'removed'
    )
  ),
  acknowledgement_method text check (
    acknowledgement_method is null or acknowledgement_method in (
      'user_portal',
      'creator_on_behalf',
      'qr_external',
      'late_user_portal',
      'late_qr_external'
    )
  ),
  acknowledged_at timestamptz,
  acknowledged_by_user_id uuid,
  acknowledged_by_name text,
  acknowledgement_note text,
  is_late boolean not null default false,
  unmatched_qr_entry boolean not null default false,
  qr_token text,
  created_by text,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  removed_at timestamptz,
  unique (record_type, record_id, attendee_key)
);

create index if not exists safety_acknowledgements_record_idx
  on public.safety_acknowledgements (record_type, record_id);

create index if not exists safety_acknowledgements_worker_idx
  on public.safety_acknowledgements (matched_employee_email, attendee_key);

create index if not exists safety_acknowledgements_status_idx
  on public.safety_acknowledgements (acknowledgement_status, is_late);

create index if not exists safety_acknowledgements_qr_token_idx
  on public.safety_acknowledgements (record_type, record_id, qr_token);

create or replace function public.set_safety_acknowledgements_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists safety_acknowledgements_updated_at on public.safety_acknowledgements;
create trigger safety_acknowledgements_updated_at
before update on public.safety_acknowledgements
for each row
execute function public.set_safety_acknowledgements_updated_at();

alter table public.safety_acknowledgements enable row level security;

grant usage on schema public to anon, authenticated;
revoke all on public.safety_acknowledgements from public;
revoke all on public.safety_acknowledgements from anon, authenticated;
grant select, insert, update, delete on public.safety_acknowledgements to authenticated;
grant insert on public.safety_acknowledgements to anon;

drop policy if exists "Authenticated users can read safety acknowledgements" on public.safety_acknowledgements;
create policy "Authenticated users can read safety acknowledgements"
on public.safety_acknowledgements
for select
to authenticated
using (true);

drop policy if exists "Authenticated users can create safety acknowledgements" on public.safety_acknowledgements;
create policy "Authenticated users can create safety acknowledgements"
on public.safety_acknowledgements
for insert
to authenticated
with check (record_type in ('jsa', 'toolbox_talk') and attendee_name is not null and attendee_key is not null);

drop policy if exists "Authenticated users can update safety acknowledgements" on public.safety_acknowledgements;
create policy "Authenticated users can update safety acknowledgements"
on public.safety_acknowledgements
for update
to authenticated
using (record_type in ('jsa', 'toolbox_talk') and attendee_key is not null)
with check (record_type in ('jsa', 'toolbox_talk') and attendee_name is not null and attendee_key is not null);

drop policy if exists "Authenticated users can delete safety acknowledgements" on public.safety_acknowledgements;
create policy "Authenticated users can delete safety acknowledgements"
on public.safety_acknowledgements
for delete
to authenticated
using (record_type in ('jsa', 'toolbox_talk') and attendee_key is not null);

drop policy if exists "Anonymous users can create safety acknowledgements" on public.safety_acknowledgements;
create policy "Anonymous users can create safety acknowledgements"
on public.safety_acknowledgements
for insert
to anon
with check (record_type in ('jsa', 'toolbox_talk') and attendee_name is not null and attendee_key is not null);

create or replace function public.get_public_safety_acknowledgement_record(
  p_record_type text,
  p_record_id uuid,
  p_qr_token text
)
returns table (
  record_type text,
  record_id uuid,
  record_title text,
  record_date date,
  project text,
  location text,
  created_by_name text,
  attendees jsonb
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_qr_token is null or length(trim(p_qr_token)) < 16 then
    return;
  end if;

  if not exists (
    select 1
    from public.safety_acknowledgements ack
    where ack.record_type = p_record_type
      and ack.record_id = p_record_id
      and ack.qr_token = p_qr_token
      and ack.removed_at is null
  ) then
    return;
  end if;

  return query
  select
    p_record_type,
    p_record_id,
    coalesce(max(ack.record_title), '')::text,
    max(ack.record_date)::date,
    coalesce(max(ack.project), '')::text,
    coalesce(max(ack.location), '')::text,
    coalesce(max(ack.created_by_name), '')::text,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', ack.id,
          'attendee_name', ack.attendee_name,
          'attendee_company', coalesce(ack.attendee_company, ''),
          'attendee_type', ack.attendee_type,
          'acknowledgement_status', ack.acknowledgement_status
        )
        order by ack.attendee_name
      ) filter (
        where ack.removed_at is null
          and (ack.attendee_type <> 'employee' or ack.matched_employee_id is null)
      ),
      '[]'::jsonb
    )
  from public.safety_acknowledgements ack
  where ack.record_type = p_record_type
    and ack.record_id = p_record_id
    and ack.qr_token = p_qr_token
  group by p_record_type, p_record_id;
end;
$$;

create or replace function public.submit_public_safety_acknowledgement(
  p_record_type text,
  p_record_id uuid,
  p_qr_token text,
  p_acknowledgement_id uuid,
  p_attendee_name text,
  p_company text,
  p_email text,
  p_note text,
  p_unmatched boolean default false
)
returns table (
  success boolean,
  message text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  base_row public.safety_acknowledgements%rowtype;
  target_row public.safety_acknowledgements%rowtype;
  clean_name text;
  clean_company text;
  clean_key text;
  method_value text;
  status_value text;
  late_value boolean;
begin
  clean_name := nullif(trim(coalesce(p_attendee_name, '')), '');
  clean_company := trim(coalesce(p_company, ''));

  if p_qr_token is null or length(trim(p_qr_token)) < 16 then
    return query select false, 'Invalid acknowledgement link.';
    return;
  end if;

  select *
  into base_row
  from public.safety_acknowledgements ack
  where ack.record_type = p_record_type
    and ack.record_id = p_record_id
    and ack.qr_token = p_qr_token
    and ack.removed_at is null
  order by ack.created_at
  limit 1;

  if not found then
    return query select false, 'Invalid acknowledgement link.';
    return;
  end if;

  if coalesce(p_unmatched, false) or p_acknowledgement_id is null then
    if clean_name is null or clean_company = '' then
      return query select false, 'Enter your full name and company.';
      return;
    end if;

    clean_key := lower(regexp_replace(clean_name || '|' || clean_company, '[^a-zA-Z0-9@._-]+', '-', 'g'));
    method_value := case when base_row.record_date is not null and base_row.record_date < current_date then 'late_qr_external' else 'qr_external' end;
    status_value := case when method_value = 'late_qr_external' then 'late_acknowledgement' else 'acknowledged_by_qr' end;
    late_value := method_value = 'late_qr_external';

    insert into public.safety_acknowledgements (
      record_type,
      record_id,
      record_title,
      record_date,
      job_id,
      job_number,
      job_name,
      project,
      location,
      attendee_name,
      attendee_key,
      attendee_company,
      attendee_type,
      acknowledgement_status,
      acknowledgement_method,
      acknowledged_at,
      acknowledged_by_name,
      acknowledgement_note,
      is_late,
      unmatched_qr_entry,
      qr_token,
      created_by,
      created_by_name
    ) values (
      base_row.record_type,
      base_row.record_id,
      base_row.record_title,
      base_row.record_date,
      base_row.job_id,
      base_row.job_number,
      base_row.job_name,
      base_row.project,
      base_row.location,
      clean_name,
      clean_key,
      clean_company,
      'external',
      status_value,
      method_value,
      now(),
      clean_name,
      nullif(trim(coalesce(p_note, '')), ''),
      late_value,
      true,
      p_qr_token,
      base_row.created_by,
      base_row.created_by_name
    )
    on conflict (record_type, record_id, attendee_key)
    do update set
      attendee_company = excluded.attendee_company,
      acknowledgement_status = excluded.acknowledgement_status,
      acknowledgement_method = excluded.acknowledgement_method,
      acknowledged_at = excluded.acknowledged_at,
      acknowledged_by_name = excluded.acknowledged_by_name,
      acknowledgement_note = excluded.acknowledgement_note,
      is_late = excluded.is_late,
      unmatched_qr_entry = true,
      qr_token = excluded.qr_token,
      removed_at = null;

    return query select true, 'Acknowledgement saved.';
    return;
  end if;

  select *
  into target_row
  from public.safety_acknowledgements ack
  where ack.id = p_acknowledgement_id
    and ack.record_type = p_record_type
    and ack.record_id = p_record_id
    and ack.qr_token = p_qr_token
    and ack.removed_at is null
  limit 1;

  if not found then
    return query select false, 'That attendee could not be found.';
    return;
  end if;

  if target_row.acknowledged_at is not null then
    return query select true, 'This attendee is already acknowledged.';
    return;
  end if;

  method_value := case when target_row.record_date is not null and target_row.record_date < current_date then 'late_qr_external' else 'qr_external' end;
  status_value := case when method_value = 'late_qr_external' then 'late_acknowledgement' else 'acknowledged_by_qr' end;
  late_value := method_value = 'late_qr_external';

  update public.safety_acknowledgements
  set
    attendee_company = coalesce(nullif(clean_company, ''), attendee_company),
    matched_employee_email = coalesce(nullif(trim(coalesce(p_email, '')), ''), matched_employee_email),
    acknowledgement_status = status_value,
    acknowledgement_method = method_value,
    acknowledged_at = now(),
    acknowledged_by_name = attendee_name,
    acknowledgement_note = nullif(trim(coalesce(p_note, '')), ''),
    is_late = late_value
  where id = target_row.id;

  return query select true, 'Acknowledgement saved.';
end;
$$;

revoke all on function public.get_public_safety_acknowledgement_record(text, uuid, text) from public;
revoke all on function public.submit_public_safety_acknowledgement(text, uuid, text, uuid, text, text, text, text, boolean) from public;
grant execute on function public.get_public_safety_acknowledgement_record(text, uuid, text) to anon, authenticated;
grant execute on function public.submit_public_safety_acknowledgement(text, uuid, text, uuid, text, text, text, text, boolean) to anon, authenticated;
