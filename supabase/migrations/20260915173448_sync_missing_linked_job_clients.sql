-- Populate only missing operational client names from a consistent linked quote.
-- Invoker security keeps both tables' existing administrator RLS in force.
create or replace function private.jgc_sync_missing_job_clients()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  with candidates as (
    select j.id, nullif(btrim(c->>'name'), '') as client
    from public.jobs j
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(new.payload->'jobs') = 'array' then new.payload->'jobs' else '[]'::jsonb end
    ) ej
    join lateral jsonb_array_elements(
      case when jsonb_typeof(new.payload->'clients') = 'array' then new.payload->'clients' else '[]'::jsonb end
    ) c on c->>'id' = ej->>'clientId'
    join lateral jsonb_array_elements(
      case when jsonb_typeof(new.payload->'quotes') = 'array' then new.payload->'quotes' else '[]'::jsonb end
    ) q on q->>'id' = ej->>'quoteId' and q->>'clientId' = c->>'id'
    where nullif(btrim(j.customer), '') is null
      and ej->>'jobNumber' = j.job_number
      and (ej->>'portalJobId' = j.id::text or nullif(ej->>'portalJobId', '') is null)
  ), verified as (
    select id, min(client) as client
    from candidates
    where client is not null and length(client) <= 200
    group by id
    having count(distinct client) = 1
  )
  update public.jobs j
  set customer = v.client, updated_at = now()
  from verified v
  where j.id = v.id and nullif(btrim(j.customer), '') is null;
  return new;
end;
$function$;

revoke all on function private.jgc_sync_missing_job_clients() from public, anon, authenticated;

create trigger estimator_workspace_sync_missing_job_clients
after insert or update of payload on public.estimator_workspaces
for each row execute function private.jgc_sync_missing_job_clients();

