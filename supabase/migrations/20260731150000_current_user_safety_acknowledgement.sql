create or replace function public.submit_current_user_safety_acknowledgement(
  p_record_type text,
  p_record_id uuid,
  p_mode text default 'account',
  p_signature_strokes jsonb default null,
  p_signature_width integer default null,
  p_signature_height integer default null
)
returns table (
  success boolean,
  message text,
  acknowledgement_id uuid,
  already_acknowledged boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_record public.inspection_records%rowtype;
  v_existing public.safety_acknowledgements%rowtype;
  v_template public.safety_acknowledgements%rowtype;
  v_ack_id uuid;
  v_record_type text := lower(btrim(coalesce(p_record_type, '')));
  v_mode text := lower(btrim(coalesce(p_mode, 'account')));
  v_display_name text;
  v_email text;
  v_company constant text := 'John Gordon Construction';
  v_attendee_key text;
  v_status text;
  v_method text;
  v_project text := '';
  v_location text := '';
  v_job_number text := '';
  v_job_name text := '';
  v_record_title text := '';
  v_record_date date;
  v_qr_token text;
  v_is_new boolean := false;
begin
  if v_user_id is null then
    return query select false, 'Sign in before acknowledging this safety record.', null::uuid, false;
    return;
  end if;

  select p.*
  into v_profile
  from public.profiles p
  where p.id = v_user_id;

  if not found or v_profile.account_status <> 'approved' then
    return query select false, 'Your account is not approved for onsite safety acknowledgements.', null::uuid, false;
    return;
  end if;

  if v_record_type not in ('jsa', 'toolbox_talk') then
    return query select false, 'This safety record type is not supported.', null::uuid, false;
    return;
  end if;

  if v_mode not in ('account', 'signature') then
    return query select false, 'Choose account acknowledgement or signature.', null::uuid, false;
    return;
  end if;

  if v_mode = 'signature' then
    if p_signature_strokes is null
       or jsonb_typeof(p_signature_strokes) <> 'array'
       or jsonb_array_length(p_signature_strokes) < 1
       or jsonb_array_length(p_signature_strokes) > 200
       or octet_length(p_signature_strokes::text) > 51200
       or coalesce(p_signature_width, 0) not between 200 and 2000
       or coalesce(p_signature_height, 0) not between 80 and 1000 then
      return query select false, 'Please provide a complete signature before submitting.', null::uuid, false;
      return;
    end if;
  end if;

  v_email := lower(btrim(coalesce(v_profile.email, '')));
  v_display_name := nullif(btrim(coalesce(v_profile.display_name, '')), '');
  if v_display_name is null then
    v_display_name := split_part(v_email, '@', 1);
  end if;
  if nullif(v_display_name, '') is null then
    return query select false, 'Your account name is missing. Ask an admin to update your profile.', null::uuid, false;
    return;
  end if;

  v_attendee_key := regexp_replace(lower(coalesce(nullif(v_email, ''), v_display_name) || '|' || v_company), '[^a-z0-9@._|+-]+', '-', 'g');
  v_attendee_key := btrim(v_attendee_key, '-');

  select a.*
  into v_existing
  from public.safety_acknowledgements a
  where a.record_type = v_record_type
    and a.record_id = p_record_id
    and a.removed_at is null
    and (
      a.matched_employee_id = v_user_id
      or (v_email <> '' and lower(coalesce(a.matched_employee_email, '')) = v_email)
      or a.attendee_key = v_attendee_key
    )
  order by a.created_at
  limit 1;

  if found and v_existing.acknowledged_at is not null then
    return query select true, 'You already acknowledged this safety record.', v_existing.id, true;
    return;
  end if;

  select a.*
  into v_template
  from public.safety_acknowledgements a
  where a.record_type = v_record_type
    and a.record_id = p_record_id
    and a.removed_at is null
  order by a.created_at
  limit 1;

  if found then
    v_record_title := coalesce(v_template.record_title, '');
    v_record_date := v_template.record_date;
    v_project := coalesce(v_template.project, '');
    v_location := coalesce(v_template.location, '');
    v_job_number := coalesce(v_template.job_number, '');
    v_job_name := coalesce(v_template.job_name, '');
    v_qr_token := v_template.qr_token;
  else
    select ir.*
    into v_record
    from public.inspection_records ir
    where ir.id = p_record_id
      and (
        (v_record_type = 'jsa' and lower(coalesce(ir.inspection_type, '')) = 'jsa')
        or (v_record_type = 'toolbox_talk' and lower(coalesce(ir.inspection_type, '')) in ('toolbox talk', 'toolbox_talk'))
      );

    if not found then
      return query select false, 'This safety record could not be found.', null::uuid, false;
      return;
    end if;

    v_record_title := coalesce(v_record.title, initcap(replace(v_record_type, '_', ' ')));
    v_record_date := v_record.inspection_date;
    v_project := coalesce(v_record.form_data->'job_context'->>'project', '');
    v_location := coalesce(v_record.form_data->'job_context'->>'location', '');
    v_job_number := coalesce(v_record.form_data->'job_context'->>'jobNumber', '');
    v_job_name := coalesce(v_record.form_data->'job_context'->>'jobName', '');

    if v_project = '' then
      select coalesce(f.value->>'value', '')
      into v_project
      from jsonb_array_elements(coalesce(v_record.form_data->'fields', '[]'::jsonb)) with ordinality as f(value, ord)
      where lower(coalesce(f.value->>'label', '')) in ('project', 'project / job', 'job')
        and nullif(btrim(coalesce(f.value->>'value', '')), '') is not null
      order by f.ord
      limit 1;
    end if;

    if v_location = '' then
      select coalesce(f.value->>'value', '')
      into v_location
      from jsonb_array_elements(coalesce(v_record.form_data->'fields', '[]'::jsonb)) with ordinality as f(value, ord)
      where lower(coalesce(f.value->>'label', '')) = 'location'
        and nullif(btrim(coalesce(f.value->>'value', '')), '') is not null
      order by f.ord
      limit 1;
    end if;

    v_qr_token := encode(extensions.gen_random_bytes(24), 'hex');
  end if;

  v_is_new := v_existing.id is null;
  v_status := case when v_is_new then 'late_acknowledgement' else 'acknowledged_by_user' end;
  v_method := case
    when v_mode = 'signature' and v_is_new then 'late_shared_device'
    when v_mode = 'signature' then 'shared_device'
    when v_is_new then 'late_user_portal'
    else 'user_portal'
  end;

  if v_existing.id is null then
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
      matched_employee_id,
      matched_employee_email,
      acknowledgement_status,
      acknowledgement_method,
      acknowledged_at,
      acknowledged_by_user_id,
      acknowledged_by_name,
      is_late,
      unmatched_qr_entry,
      qr_token,
      created_by,
      created_by_name,
      signature_strokes,
      signature_width,
      signature_height,
      signature_signed_name,
      signature_signed_at
    ) values (
      v_record_type,
      p_record_id,
      v_record_title,
      v_record_date,
      v_template.job_id,
      nullif(v_job_number, ''),
      nullif(v_job_name, ''),
      nullif(v_project, ''),
      nullif(v_location, ''),
      v_display_name,
      v_attendee_key,
      v_company,
      'employee',
      v_user_id,
      nullif(v_email, ''),
      v_status,
      v_method,
      now(),
      v_user_id,
      v_display_name,
      true,
      false,
      v_qr_token,
      coalesce(v_template.created_by, v_record.worker_name, v_display_name),
      coalesce(v_template.created_by_name, v_record.worker_display_name, v_display_name),
      case when v_mode = 'signature' then p_signature_strokes else null end,
      case when v_mode = 'signature' then p_signature_width else null end,
      case when v_mode = 'signature' then p_signature_height else null end,
      case when v_mode = 'signature' then v_display_name else null end,
      case when v_mode = 'signature' then now() else null end
    )
    on conflict (record_type, record_id, attendee_key)
    do update set
      attendee_name = excluded.attendee_name,
      attendee_company = excluded.attendee_company,
      attendee_type = 'employee',
      matched_employee_id = excluded.matched_employee_id,
      matched_employee_email = excluded.matched_employee_email,
      acknowledgement_status = excluded.acknowledgement_status,
      acknowledgement_method = excluded.acknowledgement_method,
      acknowledged_at = excluded.acknowledged_at,
      acknowledged_by_user_id = excluded.acknowledged_by_user_id,
      acknowledged_by_name = excluded.acknowledged_by_name,
      is_late = true,
      unmatched_qr_entry = false,
      removed_at = null,
      signature_strokes = excluded.signature_strokes,
      signature_width = excluded.signature_width,
      signature_height = excluded.signature_height,
      signature_signed_name = excluded.signature_signed_name,
      signature_signed_at = excluded.signature_signed_at,
      updated_at = now()
    returning id into v_ack_id;
  else
    update public.safety_acknowledgements
    set attendee_name = v_display_name,
        attendee_company = v_company,
        attendee_type = 'employee',
        matched_employee_id = v_user_id,
        matched_employee_email = nullif(v_email, ''),
        acknowledgement_status = v_status,
        acknowledgement_method = v_method,
        acknowledged_at = now(),
        acknowledged_by_user_id = v_user_id,
        acknowledged_by_name = v_display_name,
        unmatched_qr_entry = false,
        removed_at = null,
        signature_strokes = case when v_mode = 'signature' then p_signature_strokes else null end,
        signature_width = case when v_mode = 'signature' then p_signature_width else null end,
        signature_height = case when v_mode = 'signature' then p_signature_height else null end,
        signature_signed_name = case when v_mode = 'signature' then v_display_name else null end,
        signature_signed_at = case when v_mode = 'signature' then now() else null end,
        updated_at = now()
    where id = v_existing.id
    returning id into v_ack_id;
  end if;

  return query select true,
    case when v_mode = 'signature' then 'Signature saved.' else 'Acknowledgement saved to your account.' end,
    v_ack_id,
    false;
end;
$$;

revoke all on function public.submit_current_user_safety_acknowledgement(text, uuid, text, jsonb, integer, integer) from public;
revoke all on function public.submit_current_user_safety_acknowledgement(text, uuid, text, jsonb, integer, integer) from anon;
grant execute on function public.submit_current_user_safety_acknowledgement(text, uuid, text, jsonb, integer, integer) to authenticated;

comment on function public.submit_current_user_safety_acknowledgement(text, uuid, text, jsonb, integer, integer)
is 'Allows an approved signed-in employee to add and acknowledge only their own JSA or toolbox-talk attendance, optionally with a stored signature.';
