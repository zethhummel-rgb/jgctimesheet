-- A manually entered PO job requires a name; its internal job number is optional.
do $migration$
declare
  v_definition text;
begin
  select pg_get_functiondef(
    'public.digital_po_save_manual(jsonb,jsonb,integer)'::regprocedure
  )
  into v_definition;

  if position(
    $save_old$  if v_job_number = '' or v_job_name = '' then
    raise exception 'Both a manual job number and job name are required.' using errcode = '23514';
  end if;$save_old$
    in v_definition
  ) = 0 then
    raise exception 'The expected digital_po_save_manual validation was not found.';
  end if;

  v_definition := replace(
    v_definition,
    $save_old$  if v_job_number = '' or v_job_name = '' then
    raise exception 'Both a manual job number and job name are required.' using errcode = '23514';
  end if;$save_old$,
    $save_new$  if v_job_name = '' then
    raise exception 'A manual job name is required.' using errcode = '23514';
  end if;$save_new$
  );
  execute v_definition;

  select pg_get_functiondef(
    'public.digital_po_update_pending_manual(jsonb,jsonb,integer,text,text,text)'::regprocedure
  )
  into v_definition;

  if position(
    $pending_old$  if v_job_number = '' or v_job_name = '' or v_supplier_name = '' then
    raise exception 'Manual job number, manual job name, and supplier are required.' using errcode = '23514';
  end if;$pending_old$
    in v_definition
  ) = 0 then
    raise exception 'The expected digital_po_update_pending_manual validation was not found.';
  end if;

  v_definition := replace(
    v_definition,
    $pending_old$  if v_job_number = '' or v_job_name = '' or v_supplier_name = '' then
    raise exception 'Manual job number, manual job name, and supplier are required.' using errcode = '23514';
  end if;$pending_old$,
    $pending_new$  if v_job_name = '' or v_supplier_name = '' then
    raise exception 'Manual job name and supplier are required.' using errcode = '23514';
  end if;$pending_new$
  );
  execute v_definition;
end
$migration$;

comment on function public.digital_po_save_manual(jsonb, jsonb, integer) is
  'Saves a digital PO using a manual job name and an optional manual job number.';

comment on function public.digital_po_update_pending_manual(jsonb, jsonb, integer, text, text, text) is
  'Updates a pending digital PO using a manual job name and an optional manual job number.';
