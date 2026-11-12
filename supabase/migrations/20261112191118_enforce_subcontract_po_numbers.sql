create or replace function private.enforce_subcontract_po_numbers()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.payload->'jobs' is not distinct from old.payload->'jobs' then
    return new;
  end if;

  if exists (
    select 1
    from jsonb_array_elements(coalesce(new.payload->'jobs', '[]'::jsonb)) j(job)
    cross join lateral jsonb_array_elements(coalesce(j.job->'purchaseOrders', '[]'::jsonb)) p(po)
    cross join lateral jsonb_array_elements(coalesce(j.job->'purchaseOrders', '[]'::jsonb)) other(po)
    where p.po->>'id' is distinct from other.po->>'id'
      and btrim(coalesce(p.po->>'number', '')) <> ''
      and upper(btrim(p.po->>'number')) = upper(btrim(other.po->>'number'))
      and not exists (
        select 1
        from jsonb_array_elements(coalesce(old.payload->'jobs', '[]'::jsonb)) previous_job(job)
        cross join lateral jsonb_array_elements(coalesce(previous_job.job->'purchaseOrders', '[]'::jsonb)) previous(po)
        where previous_job.job->>'id' = j.job->>'id'
          and previous.po->>'id' = p.po->>'id'
          and upper(btrim(previous.po->>'number')) = upper(btrim(p.po->>'number'))
      )
  ) then
    raise exception using errcode = '23505',
      message = 'This subcontractor PO number is already in use for this job. Refresh and try again.';
  end if;
  return new;
end;
$$;

revoke all on function private.enforce_subcontract_po_numbers() from public, anon, authenticated;

create trigger estimator_workspace_subcontract_po_numbers
before insert or update of payload on public.estimator_workspaces
for each row execute function private.enforce_subcontract_po_numbers();
