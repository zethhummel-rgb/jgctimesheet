-- Only information explicitly posted for this QR board belongs in this object.
alter table public.job_boards
  add column emergency_info jsonb not null default '{}'::jsonb,
  add constraint job_boards_emergency_info_fields check (
    jsonb_typeof(emergency_info) = 'object' and
    emergency_info - array['responder_entrance','muster_point','first_aid_location','supervisor_name','supervisor_phone'] = '{}'::jsonb
  );

-- Add to the existing token-checked model without replacing its document or attendance rules.
-- Read the current official job address even when the office hasn't reopened the board.
do $migration$
declare
  definition text := pg_get_functiondef('private.jgc_job_board_model(uuid,uuid)'::regprocedure);
  anchor text := '''address'',b.address,';
begin
  if cardinality(string_to_array(definition, anchor)) <> 2 then
    raise exception 'Unexpected Job Board model; review its address field before migrating';
  end if;
  execute replace(definition, anchor, $fields$'address',case when b.portal_job_id is null then b.address
    else coalesce((select j.address from public.jobs j where j.id=b.portal_job_id),'') end,'emergency_info',b.emergency_info,$fields$);
end;
$migration$;

create function private.jgc_save_job_board_emergency_info(p_board_id uuid, p_info jsonb, p_expected jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  posted jsonb;
  cleaned jsonb;
  phone text;
begin
  if not private.jgc_job_board_admin() then
    raise exception 'Approved administrator access required' using errcode='42501';
  end if;
  if jsonb_typeof(p_info) is distinct from 'object' or jsonb_typeof(p_expected) is distinct from 'object' then
    raise exception 'Invalid emergency information' using errcode='22023';
  end if;
  if exists (select 1 from jsonb_each(p_info) f
    where f.key not in ('responder_entrance','muster_point','first_aid_location','supervisor_name','supervisor_phone')
      or jsonb_typeof(f.value) <> 'string'
      or length(btrim(f.value #>> '{}')) > case f.key when 'supervisor_phone' then 40 when 'supervisor_name' then 120 else 300 end
  ) then
    raise exception 'Check the emergency fields and their lengths' using errcode='22023';
  end if;
  select coalesce(jsonb_object_agg(key, btrim(value)), '{}'::jsonb) into cleaned
    from jsonb_each_text(p_info) where btrim(value) <> '';
  phone := cleaned->>'supervisor_phone';
  if phone is not null and (phone !~ '^[+]?[0-9(][0-9 ().-]*$' or
      length(regexp_replace(phone, '[^0-9]', '', 'g')) not between 7 and 15) then
    raise exception 'Enter a direct phone number with 7 to 15 digits' using errcode='22023';
  end if;

  select emergency_info into posted from public.job_boards where id=p_board_id for update;
  if not found then raise exception 'Job Board unavailable' using errcode='42501'; end if;
  if posted = cleaned then return posted; end if;
  if posted <> p_expected then
    raise exception 'Another person updated this card. Reload the posted details before editing again.' using errcode='40001';
  end if;
  update public.job_boards set emergency_info=cleaned, updated_at=clock_timestamp() where id=p_board_id;
  return cleaned;
end;
$function$;

create function public.save_job_board_emergency_info(p_board_id uuid, p_info jsonb, p_expected jsonb)
returns jsonb language sql security invoker set search_path = '' as $function$
  select private.jgc_save_job_board_emergency_info(p_board_id, p_info, p_expected)
$function$;

revoke all on function private.jgc_save_job_board_emergency_info(uuid,jsonb,jsonb),
  public.save_job_board_emergency_info(uuid,jsonb,jsonb) from public, anon, authenticated;
grant execute on function private.jgc_save_job_board_emergency_info(uuid,jsonb,jsonb),
  public.save_job_board_emergency_info(uuid,jsonb,jsonb) to authenticated;
