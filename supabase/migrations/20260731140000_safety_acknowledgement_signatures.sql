-- Store compact vector signatures directly with each safety acknowledgement.
alter table public.safety_acknowledgements
  add column if not exists signature_strokes jsonb,
  add column if not exists signature_width integer,
  add column if not exists signature_height integer,
  add column if not exists signature_version smallint not null default 1,
  add column if not exists signature_signed_name text,
  add column if not exists signature_signed_at timestamptz;

alter table public.safety_acknowledgements
  drop constraint if exists safety_acknowledgements_acknowledgement_method_check;

alter table public.safety_acknowledgements
  add constraint safety_acknowledgements_acknowledgement_method_check check (
    acknowledgement_method is null or acknowledgement_method in (
      'user_portal',
      'creator_on_behalf',
      'qr_external',
      'late_user_portal',
      'late_qr_external',
      'shared_device',
      'late_shared_device'
    )
  );

alter table public.safety_acknowledgements
  drop constraint if exists safety_acknowledgements_signature_shape_check;

alter table public.safety_acknowledgements
  add constraint safety_acknowledgements_signature_shape_check check (
    signature_strokes is null or (
      jsonb_typeof(signature_strokes) = 'array'
      and jsonb_array_length(signature_strokes) between 1 and 200
      and octet_length(signature_strokes::text) <= 51200
      and signature_width between 200 and 2000
      and signature_height between 80 and 1000
      and nullif(btrim(signature_signed_name), '') is not null
      and signature_signed_at is not null
    )
  );

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
set search_path = ''
as $$
begin
  if p_record_type not in ('jsa', 'toolbox_talk')
     or p_qr_token is null
     or length(btrim(p_qr_token)) < 16 then
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
          'acknowledgement_status', ack.acknowledgement_status,
          'acknowledged_at', ack.acknowledged_at,
          'signature_signed_name', ack.signature_signed_name
        )
        order by ack.attendee_name
      ) filter (where ack.removed_at is null),
      '[]'::jsonb
    )
  from public.safety_acknowledgements ack
  where ack.record_type = p_record_type
    and ack.record_id = p_record_id
    and ack.qr_token = p_qr_token
  group by p_record_type, p_record_id;
end;
$$;

create or replace function public.submit_public_safety_signature(
  p_record_type text,
  p_record_id uuid,
  p_qr_token text,
  p_acknowledgement_id uuid,
  p_attendee_name text,
  p_company text,
  p_email text,
  p_note text,
  p_unmatched boolean,
  p_signature_strokes jsonb,
  p_signature_width integer,
  p_signature_height integer,
  p_signature_source text default 'qr'
)
returns table (
  success boolean,
  message text,
  acknowledgement_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  base_row public.safety_acknowledgements%rowtype;
  target_row public.safety_acknowledgements%rowtype;
  clean_name text;
  clean_company text;
  clean_email text;
  clean_key text;
  clean_source text;
  method_value text;
  status_value text;
  late_value boolean;
  saved_id uuid;
begin
  clean_name := nullif(btrim(coalesce(p_attendee_name, '')), '');
  clean_company := btrim(coalesce(p_company, ''));
  clean_email := nullif(btrim(coalesce(p_email, '')), '');
  clean_source := lower(btrim(coalesce(p_signature_source, 'qr')));

  if p_record_type not in ('jsa', 'toolbox_talk')
     or p_qr_token is null
     or length(btrim(p_qr_token)) < 16 then
    return query select false, 'Invalid acknowledgement link.', null::uuid;
    return;
  end if;

  if clean_source not in ('qr', 'shared_device', 'user_portal') then
    return query select false, 'Invalid signature source.', null::uuid;
    return;
  end if;

  if clean_name is null then
    return query select false, 'Enter the printed name of the person signing.', null::uuid;
    return;
  end if;

  if p_signature_strokes is null
     or jsonb_typeof(p_signature_strokes) <> 'array'
     or jsonb_array_length(p_signature_strokes) < 1
     or jsonb_array_length(p_signature_strokes) > 200
     or octet_length(p_signature_strokes::text) > 51200
     or p_signature_width not between 200 and 2000
     or p_signature_height not between 80 and 1000 then
    return query select false, 'Add a valid signature in the signature box.', null::uuid;
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
    return query select false, 'Invalid acknowledgement link.', null::uuid;
    return;
  end if;

  late_value := base_row.record_date is not null and base_row.record_date < current_date;
  method_value := case
    when clean_source = 'shared_device' and late_value then 'late_shared_device'
    when clean_source = 'shared_device' then 'shared_device'
    when clean_source = 'user_portal' and late_value then 'late_user_portal'
    when clean_source = 'user_portal' then 'user_portal'
    when late_value then 'late_qr_external'
    else 'qr_external'
  end;
  status_value := case
    when late_value then 'late_acknowledgement'
    when clean_source = 'qr' then 'acknowledged_by_qr'
    else 'acknowledged_by_user'
  end;

  if coalesce(p_unmatched, false) or p_acknowledgement_id is null then
    if clean_company = '' then
      return query select false, 'Enter your company.', null::uuid;
      return;
    end if;

    clean_key := lower(regexp_replace(clean_name || '|' || clean_company, '[^a-zA-Z0-9@._-]+', '-', 'g'));

    insert into public.safety_acknowledgements as existing (
      record_type, record_id, record_title, record_date, job_id, job_number,
      job_name, project, location, attendee_name, attendee_key,
      attendee_company, attendee_type, matched_employee_email,
      acknowledgement_status, acknowledgement_method, acknowledged_at,
      acknowledged_by_name, acknowledgement_note, is_late,
      unmatched_qr_entry, qr_token, created_by, created_by_name,
      signature_strokes, signature_width, signature_height,
      signature_version, signature_signed_name, signature_signed_at
    ) values (
      base_row.record_type, base_row.record_id, base_row.record_title,
      base_row.record_date, base_row.job_id, base_row.job_number,
      base_row.job_name, base_row.project, base_row.location, clean_name,
      clean_key, clean_company, 'external', clean_email, status_value,
      method_value, now(), clean_name, nullif(btrim(coalesce(p_note, '')), ''),
      late_value, true, p_qr_token, base_row.created_by,
      base_row.created_by_name, p_signature_strokes, p_signature_width,
      p_signature_height, 1, clean_name, now()
    )
    on conflict (record_type, record_id, attendee_key)
    do update set
      attendee_company = excluded.attendee_company,
      matched_employee_email = coalesce(excluded.matched_employee_email, existing.matched_employee_email),
      acknowledgement_status = excluded.acknowledgement_status,
      acknowledgement_method = excluded.acknowledgement_method,
      acknowledged_at = excluded.acknowledged_at,
      acknowledged_by_name = excluded.acknowledged_by_name,
      acknowledgement_note = excluded.acknowledgement_note,
      is_late = excluded.is_late,
      unmatched_qr_entry = true,
      qr_token = excluded.qr_token,
      removed_at = null,
      signature_strokes = excluded.signature_strokes,
      signature_width = excluded.signature_width,
      signature_height = excluded.signature_height,
      signature_version = excluded.signature_version,
      signature_signed_name = excluded.signature_signed_name,
      signature_signed_at = excluded.signature_signed_at
    returning id into saved_id;

    return query select true, 'Signature saved.', saved_id;
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
  for update;

  if not found then
    return query select false, 'That attendee could not be found.', null::uuid;
    return;
  end if;

  if target_row.signature_signed_at is not null then
    return query select true, 'This attendee has already signed.', target_row.id;
    return;
  end if;

  update public.safety_acknowledgements
  set
    attendee_company = coalesce(nullif(clean_company, ''), attendee_company),
    matched_employee_email = coalesce(clean_email, matched_employee_email),
    acknowledgement_status = status_value,
    acknowledgement_method = method_value,
    acknowledged_at = now(),
    acknowledged_by_name = clean_name,
    acknowledgement_note = nullif(btrim(coalesce(p_note, '')), ''),
    is_late = late_value,
    signature_strokes = p_signature_strokes,
    signature_width = p_signature_width,
    signature_height = p_signature_height,
    signature_version = 1,
    signature_signed_name = clean_name,
    signature_signed_at = now()
  where id = target_row.id
  returning id into saved_id;

  return query select true, 'Signature saved.', saved_id;
end;
$$;

revoke all on function public.get_public_safety_acknowledgement_record(text, uuid, text) from public;
revoke all on function public.submit_public_safety_signature(text, uuid, text, uuid, text, text, text, text, boolean, jsonb, integer, integer, text) from public;
grant execute on function public.get_public_safety_acknowledgement_record(text, uuid, text) to anon, authenticated;
grant execute on function public.submit_public_safety_signature(text, uuid, text, uuid, text, text, text, text, boolean, jsonb, integer, integer, text) to anon, authenticated;
