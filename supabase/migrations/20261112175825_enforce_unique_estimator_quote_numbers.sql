create or replace function private.enforce_unique_estimator_quote_numbers()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.payload->'quotes' is not distinct from old.payload->'quotes' then
    return new;
  end if;

  if exists (
    select 1
    from jsonb_array_elements(coalesce(new.payload->'quotes', '[]'::jsonb)) as q(quote)
    where coalesce(q.quote->>'documentKind', 'Quote') <> 'Change Notice'
      and btrim(coalesce(q.quote->>'number', '')) <> ''
    group by upper(btrim(q.quote->>'number'))
    having count(*) > 1
  ) then
    raise exception using
      errcode = '23505',
      message = 'This quote number is already in use. Refresh the Estimate Desk before creating another quote.';
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_unique_estimator_quote_numbers() from public, anon, authenticated;

create trigger estimator_workspace_unique_quote_numbers
before insert or update of payload on public.estimator_workspaces
for each row execute function private.enforce_unique_estimator_quote_numbers();
