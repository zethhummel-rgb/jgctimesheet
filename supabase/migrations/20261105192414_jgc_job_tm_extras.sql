-- T&M extras use the existing official Portal job and WO labour records.
SET LOCAL lock_timeout = '5s';

CREATE TABLE public.job_tm_extras (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE RESTRICT,
  extra_number integer NOT NULL CHECK (extra_number > 0),
  code text GENERATED ALWAYS AS ('X' || extra_number::text) STORED,
  description text NOT NULL CHECK (length(btrim(description)) BETWEEN 1 AND 2000),
  active boolean NOT NULL DEFAULT true,
  request_id uuid,
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, extra_number),
  UNIQUE (job_id, request_id)
);
ALTER TABLE public.job_tm_extras ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.job_tm_extras FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.job_tm_extras TO service_role;
CREATE INDEX job_tm_extras_created_by_idx ON public.job_tm_extras(created_by);

ALTER TABLE public.work_orders
  ADD COLUMN tm_extra_id uuid REFERENCES public.job_tm_extras(id) ON DELETE RESTRICT,
  ADD COLUMN tm_extra_label text;
CREATE INDEX work_orders_tm_extra_id_idx ON public.work_orders(tm_extra_id) WHERE tm_extra_id IS NOT NULL;

CREATE FUNCTION private.jgc_tm_extra_job(p_job_number text) RETURNS uuid
LANGUAGE plpgsql STABLE SET search_path = '' AS $function$
DECLARE job_id uuid;
BEGIN
  SELECT j.id INTO STRICT job_id FROM public.jobs j
    WHERE lower(btrim(j.job_number)) = lower(btrim(p_job_number));
  RETURN job_id;
EXCEPTION
  WHEN no_data_found THEN RAISE EXCEPTION 'Select an official Portal job to use T&M extras.' USING ERRCODE = '22023';
  WHEN too_many_rows THEN RAISE EXCEPTION 'This job number matches more than one Portal job. Ask the office to resolve it.' USING ERRCODE = '22023';
END
$function$;
REVOKE ALL ON FUNCTION private.jgc_tm_extra_job(text) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION private.jgc_save_job_tm_extra(
  p_job_number text, p_description text, p_extra_id uuid, p_active boolean, p_request_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  selected_job uuid;
  extra public.job_tm_extras;
  description_value text := btrim(coalesce(p_description, ''));
  next_number integer;
BEGIN
  IF NOT public.is_admin() OR NOT private.jgc_has_full_portal_access() THEN
    RAISE EXCEPTION 'Admin access required.' USING ERRCODE = '42501';
  END IF;
  IF length(description_value) NOT BETWEEN 1 AND 2000 OR p_active IS NULL THEN
    RAISE EXCEPTION 'Enter an extra description of 1 to 2000 characters.' USING ERRCODE = '22023';
  END IF;
  selected_job := private.jgc_tm_extra_job(p_job_number);
  -- The official job row serializes numbering and retries across all administrators.
  PERFORM 1 FROM public.jobs WHERE id = selected_job FOR UPDATE;
  IF p_extra_id IS NULL THEN
    IF p_request_id IS NOT NULL THEN
      SELECT * INTO extra FROM public.job_tm_extras WHERE job_id = selected_job AND request_id = p_request_id;
      IF FOUND THEN
        IF extra.description <> description_value OR extra.active <> p_active THEN
          RAISE EXCEPTION 'This extra was already saved with different details. Refresh the list.' USING ERRCODE = '22023';
        END IF;
        RETURN jsonb_build_object('id', extra.id, 'code', extra.code, 'description', extra.description, 'active', extra.active);
      END IF;
    END IF;
    SELECT coalesce(max(extra_number), 0) + 1 INTO next_number FROM public.job_tm_extras WHERE job_id = selected_job;
    INSERT INTO public.job_tm_extras(job_id, extra_number, description, active, request_id, created_by)
      VALUES(selected_job, next_number, description_value, p_active, p_request_id, auth.uid()) RETURNING * INTO extra;
  ELSE
    UPDATE public.job_tm_extras SET description = description_value, active = p_active, updated_at = now()
      WHERE id = p_extra_id AND job_id = selected_job RETURNING * INTO extra;
    IF NOT FOUND THEN RAISE EXCEPTION 'Extra unavailable for this job.' USING ERRCODE = '22023'; END IF;
  END IF;
  RETURN jsonb_build_object('id', extra.id, 'code', extra.code, 'description', extra.description, 'active', extra.active);
END
$function$;

CREATE FUNCTION public.save_job_tm_extra(
  p_job_number text, p_description text, p_extra_id uuid DEFAULT NULL,
  p_active boolean DEFAULT true, p_request_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $function$
  SELECT private.jgc_save_job_tm_extra(p_job_number, p_description, p_extra_id, p_active, p_request_id);
$function$;
REVOKE ALL ON FUNCTION private.jgc_save_job_tm_extra(text,text,uuid,boolean,uuid), public.save_job_tm_extra(text,text,uuid,boolean,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.jgc_save_job_tm_extra(text,text,uuid,boolean,uuid), public.save_job_tm_extra(text,text,uuid,boolean,uuid) TO authenticated;

CREATE FUNCTION private.jgc_list_job_tm_extras(p_job_number text, p_selected_extra_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $function$
DECLARE selected_job uuid; result jsonb;
BEGIN
  IF NOT private.jgc_job_board_staff() THEN
    RAISE EXCEPTION 'Approved staff access required.' USING ERRCODE = '42501';
  END IF;
  selected_job := private.jgc_tm_extra_job(p_job_number);
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'code', e.code, 'description', e.description, 'active', e.active) ORDER BY e.extra_number), '[]'::jsonb)
    INTO result FROM public.job_tm_extras e
    WHERE e.job_id = selected_job AND (e.active OR e.id = p_selected_extra_id);
  RETURN result;
END
$function$;
CREATE FUNCTION public.list_job_tm_extras(p_job_number text, p_selected_extra_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $function$
  SELECT private.jgc_list_job_tm_extras(p_job_number, p_selected_extra_id);
$function$;
REVOKE ALL ON FUNCTION private.jgc_list_job_tm_extras(text,uuid), public.list_job_tm_extras(text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.jgc_list_job_tm_extras(text,uuid), public.list_job_tm_extras(text,uuid) TO authenticated;

CREATE FUNCTION private.jgc_job_tm_extra_costing(p_job_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = '' AS $function$
WITH source_entries AS (
  SELECT 'accounting:' || entry.id::text AS source_key,
         entry.source_data->>'id' AS entry_id,
         entry.profile_id AS worker_profile_id, entry.worker_name, entry.work_date,
         entry.payable_hours AS hours, entry.shift_type = 'night' AS is_night,
         'submitted'::text AS source_status
  FROM public.accounting_time_entries entry
  WHERE entry.is_current AND lower(entry.entry_type) = 'work'
    AND entry.job_id = p_job_id AND entry.payable_hours > 0
  UNION ALL
  SELECT 'timesheet:' || entry.id::text, entry.id::text,
         entry.profile_id, entry.worker_name,
         (entry.week_start + CASE lower(entry.day_of_week)
           WHEN 'sunday' THEN 0 WHEN 'monday' THEN 1 WHEN 'tuesday' THEN 2
           WHEN 'wednesday' THEN 3 WHEN 'thursday' THEN 4 WHEN 'friday' THEN 5
           WHEN 'saturday' THEN 6 ELSE 0 END)::date,
         entry.hours, coalesce(entry.night_work, false), 'provisional'::text
  FROM public.timesheet_entries entry
  JOIN public.jobs job ON job.id = p_job_id AND lower(btrim(job.job_number)) = lower(btrim(entry.job_number))
  WHERE lower(entry.entry_type) = 'work' AND entry.hours > 0
    AND NOT EXISTS (
      SELECT 1 FROM public.accounting_time_entries captured
      WHERE captured.is_current AND captured.source_data->>'id' = entry.id::text
    )
), wo_scopes AS (
  SELECT w.id, w.tm_extra_id, w.work_order_date, w.wo_number,
         coalesce(profile.id, worker.profile_id) AS worker_profile_id,
         l.matched_timesheet_entry_id, l.hours,
         (l.employee_id IS NULL AND (l.worker_key LIKE 'manual-%' OR lower(l.notes) = 'manual labour entry')) AS manual
  FROM public.work_orders w
  JOIN public.work_order_labour l ON l.work_order_id = w.id
  JOIN public.jobs job ON job.id = p_job_id
  LEFT JOIN public.profiles profile ON profile.id = l.employee_id
  LEFT JOIN public.work_order_labour_workers worker ON worker.id = l.employee_id
  WHERE lower(btrim(w.job_number)) = lower(btrim(job.job_number))
    AND (w.job_id IS NULL OR w.job_id = job.id)
), classified AS (
  SELECT source.*,
         CASE WHEN scope.buckets > 1 THEN 'unallocated'
              ELSE coalesce(scope.bucket, 'original') END AS bucket,
         CASE WHEN rate.regular_rate IS NULL THEN 0
              ELSE source.hours * (rate.regular_rate + CASE WHEN source.is_night THEN coalesce(rate.night_premium,0) ELSE 0 END) * 1.4 END AS raw_cost,
         CASE WHEN rate.regular_rate IS NULL THEN source.hours ELSE 0 END AS missing_rate_hours
  FROM source_entries source
  LEFT JOIN LATERAL (
    -- A WO labour row represents that worker's whole job/day. Explicit source links
    -- and profile/day matches both participate so contradictory WOs remain visible.
    SELECT count(DISTINCT coalesce(wo.tm_extra_id::text, 'original')) AS buckets,
           min(coalesce(wo.tm_extra_id::text, 'original')) AS bucket
    FROM wo_scopes wo
    WHERE wo.work_order_date = source.work_date
      AND NOT coalesce(wo.manual, false)
      AND (source.worker_profile_id IS NULL OR wo.worker_profile_id IS NULL OR source.worker_profile_id = wo.worker_profile_id)
      AND (wo.matched_timesheet_entry_id::text = nullif(source.entry_id, '')
           OR (source.worker_profile_id IS NOT NULL AND wo.worker_profile_id = source.worker_profile_id))
  ) scope ON true
  LEFT JOIN LATERAL (
    SELECT employee_rate.regular_rate, employee_rate.night_premium
    FROM public.accounting_employee_rates employee_rate
    WHERE employee_rate.profile_id = source.worker_profile_id
      AND employee_rate.effective_from <= source.work_date
    ORDER BY employee_rate.effective_from DESC LIMIT 1
  ) rate ON true
), grouped AS (
  SELECT worker_profile_id, worker_name, source_status, bucket,
         sum(hours) AS hours, sum(raw_cost) AS raw_cost, sum(missing_rate_hours) AS missing_rate_hours
  FROM classified
  GROUP BY worker_profile_id, worker_name, source_status, bucket
), rounded AS (
  -- Cumulative rounding preserves each original worker/status total without
  -- allowing the adjustment to create a negative cost or missing-hours bucket.
  SELECT grouped.*,
    round(sum(raw_cost) OVER worker_order,2) - round(sum(raw_cost) OVER worker_order - raw_cost,2) AS loaded_cost,
    round(sum(hours) OVER worker_order,2) - round(sum(hours) OVER worker_order - hours,2) AS rounded_hours,
    round(sum(missing_rate_hours) OVER worker_order,2) - round(sum(missing_rate_hours) OVER worker_order - missing_rate_hours,2) AS rounded_missing_hours
  FROM grouped
  WINDOW worker_order AS (PARTITION BY worker_profile_id, worker_name, source_status ORDER BY bucket ROWS UNBOUNDED PRECEDING)
), buckets AS (
  SELECT bucket, sum(rounded_hours) AS hours, sum(loaded_cost) AS loaded_cost,
    sum(rounded_missing_hours) AS missing_rate_hours
  FROM rounded GROUP BY bucket
), manual_hours AS (
  SELECT tm_extra_id, coalesce(sum(hours),0) AS hours FROM wo_scopes
  WHERE manual AND tm_extra_id IS NOT NULL GROUP BY tm_extra_id
), extra_costs AS (
  SELECT e.id, e.code, e.description, e.extra_number,
    coalesce(b.hours,0) AS hours, coalesce(b.loaded_cost,0) AS loaded_cost,
    coalesce(b.missing_rate_hours,0) AS missing_rate_hours,
    coalesce(m.hours,0) AS unpriced_manual_wo_hours
  FROM public.job_tm_extras e
  LEFT JOIN buckets b ON b.bucket = e.id::text
  LEFT JOIN manual_hours m ON m.tm_extra_id = e.id
  WHERE e.job_id = p_job_id
)
SELECT jsonb_build_object(
  'original', coalesce((SELECT to_jsonb(b) - 'bucket' FROM buckets b WHERE bucket = 'original'), '{"hours":0,"loaded_cost":0,"missing_rate_hours":0}'::jsonb),
  'extras', coalesce((SELECT jsonb_agg(to_jsonb(e) - 'extra_number' ORDER BY e.extra_number) FROM extra_costs e), '[]'::jsonb),
  'unallocated', coalesce((SELECT to_jsonb(b) - 'bucket' FROM buckets b WHERE bucket = 'unallocated'), '{"hours":0,"loaded_cost":0,"missing_rate_hours":0}'::jsonb),
  'total', (SELECT jsonb_build_object('hours',coalesce(sum(hours),0),'loaded_cost',coalesce(sum(loaded_cost),0),'missing_rate_hours',coalesce(sum(missing_rate_hours),0)) FROM buckets),
  'unpriced_manual_wo_hours', (SELECT coalesce(sum(hours),0) FROM manual_hours)
);
$function$;
REVOKE ALL ON FUNCTION private.jgc_job_tm_extra_costing(uuid) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION private.jgc_get_job_tm_extras(p_job_number text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $function$
DECLARE selected_job uuid; result jsonb;
BEGIN
  IF NOT public.is_admin() OR NOT private.jgc_has_full_portal_access() THEN
    RAISE EXCEPTION 'Admin access required.' USING ERRCODE = '42501';
  END IF;
  selected_job := private.jgc_tm_extra_job(p_job_number);
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', e.id, 'code', e.code, 'description', e.description, 'active', e.active,
    'hours', summary.hours, 'submitted_hours', summary.submitted_hours, 'work_orders', summary.work_orders
  ) ORDER BY e.extra_number), '[]'::jsonb)
  INTO result FROM public.job_tm_extras e
  CROSS JOIN LATERAL (
    SELECT coalesce(sum(wo.hours), 0) AS hours,
           coalesce(sum(wo.hours) FILTER (WHERE wo.status = 'submitted'), 0) AS submitted_hours,
           coalesce(jsonb_agg(to_jsonb(wo) ORDER BY wo.work_order_date DESC, wo.wo_number), '[]'::jsonb) AS work_orders
    FROM (
      SELECT w.id, w.wo_number, w.work_order_date, w.status, w.created_by_name,
             coalesce(sum(l.hours), 0) AS hours
      FROM public.work_orders w
      LEFT JOIN public.work_order_labour l ON l.work_order_id = w.id
      WHERE w.tm_extra_id = e.id
      GROUP BY w.id
    ) wo
  ) summary
  WHERE e.job_id = selected_job;
  RETURN jsonb_build_object('job_id', selected_job, 'extras', result, 'costing', private.jgc_job_tm_extra_costing(selected_job));
END
$function$;
CREATE FUNCTION public.get_job_tm_extras(p_job_number text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $function$
  SELECT private.jgc_get_job_tm_extras(p_job_number);
$function$;
REVOKE ALL ON FUNCTION private.jgc_get_job_tm_extras(text), public.get_job_tm_extras(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.jgc_get_job_tm_extras(text), public.get_job_tm_extras(text) TO authenticated;

CREATE FUNCTION private.jgc_validate_work_order_tm_extra() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  extra public.job_tm_extras;
  official_number text;
  link_changed boolean := TG_OP = 'INSERT';
BEGIN
  IF TG_OP = 'UPDATE' THEN
    link_changed := NEW.tm_extra_id IS DISTINCT FROM OLD.tm_extra_id;
    IF (OLD.locked OR OLD.status = 'submitted') AND
       (link_changed OR (NEW.tm_extra_id IS NOT NULL AND
         (NEW.job_id IS DISTINCT FROM OLD.job_id OR NEW.job_number IS DISTINCT FROM OLD.job_number))) THEN
      RAISE EXCEPTION 'Reopen the work order before changing its extra.' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF link_changed AND (NEW.tm_extra_id IS NOT NULL OR TG_OP = 'UPDATE' AND OLD.tm_extra_id IS NOT NULL) THEN
    IF NOT private.jgc_job_board_staff() OR
       (NOT public.is_admin() AND (CASE WHEN TG_OP = 'UPDATE' THEN OLD.created_by ELSE NEW.created_by END) IS DISTINCT FROM auth.uid()) THEN
      RAISE EXCEPTION 'Only the work order creator or an administrator can change its extra.' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF NEW.tm_extra_id IS NULL THEN
    NEW.tm_extra_label := NULL;
    RETURN NEW;
  END IF;

  SELECT * INTO extra FROM public.job_tm_extras WHERE id = NEW.tm_extra_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Extra unavailable.' USING ERRCODE = '22023'; END IF;
  SELECT job_number INTO official_number FROM public.jobs WHERE id = extra.job_id;
  IF lower(btrim(coalesce(NEW.job_number, ''))) <> lower(btrim(official_number))
     OR (NEW.job_id IS NOT NULL AND NEW.job_id <> extra.job_id) THEN
    RAISE EXCEPTION 'The selected extra belongs to a different job.' USING ERRCODE = '22023';
  END IF;
  IF link_changed AND NOT extra.active THEN
    RAISE EXCEPTION 'This extra is closed. Choose an active extra.' USING ERRCODE = '22023';
  END IF;
  IF link_changed THEN
    NEW.tm_extra_label := extra.code || ' â€” ' || extra.description;
  ELSE
    NEW.tm_extra_label := OLD.tm_extra_label;
  END IF;
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION private.jgc_validate_work_order_tm_extra() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER validate_work_order_tm_extra
  BEFORE INSERT OR UPDATE OF tm_extra_id, tm_extra_label, job_id, job_number ON public.work_orders
  FOR EACH ROW EXECUTE FUNCTION private.jgc_validate_work_order_tm_extra();
