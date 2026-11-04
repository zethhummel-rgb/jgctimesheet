SET LOCAL lock_timeout = '3s';
CREATE OR REPLACE FUNCTION private.jgc_get_job_board_onsite_today(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  target_board_id uuid;
  today date := (now() AT TIME ZONE 'America/Toronto')::date;
  people jsonb;
BEGIN
  IF NOT private.jgc_job_board_staff() THEN
    RAISE EXCEPTION 'Sign in with your JGC account to see who is on site' USING ERRCODE = '42501';
  END IF;

  SELECT b.id INTO target_board_id FROM public.job_boards b WHERE b.token = p_token AND b.enabled;
  IF target_board_id IS NULL THEN
    RAISE EXCEPTION 'Job Board unavailable' USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(jsonb_agg(to_jsonb(person) ORDER BY person.first_at), '[]'::jsonb)
  INTO people
  FROM (
    SELECT min(a.actor_name) AS name,
           min(a.actor_company) AS company,
           min(a.created_at) AS first_at,
           max(a.created_at) AS last_at,
           count(*)::integer AS count,
           bool_or(a.identity_type = 'staff' AND a.actor_profile_id IS NOT NULL) AS staff,
           bool_or(c.event_id IS NOT NULL) AS confirmed
    FROM public.job_board_activity a
    LEFT JOIN private.jgc_site_signin_confirmations c ON c.event_id = a.id
    WHERE a.board_id = target_board_id
      AND a.action = 'site-signin'
      AND a.created_at >= (today::timestamp AT TIME ZONE 'America/Toronto')
      AND a.created_at < ((today + 1)::timestamp AT TIME ZONE 'America/Toronto')
    GROUP BY a.actor_profile_id, lower(btrim(a.actor_name)), lower(btrim(a.actor_company))
  ) person;

  RETURN jsonb_build_object('date', today, 'people', people);
END
$function$;
