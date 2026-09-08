-- Cancellation is an inactive job, not a deletion. Existing IDs, history,
-- document links, employee selectors and job-management RLS remain unchanged.
set lock_timeout = '5s';
set statement_timeout = '30s';

alter table public.jobs add column if not exists cancelled_at timestamptz;
comment on column public.jobs.cancelled_at is
  'When explicitly cancelled in Estimate Desk. Null for ordinary inactive jobs; cleared when reactivated.';

-- Older Portal screens and Excel imports still change the shared active flag.
-- Reactivation anywhere must clear the cancellation marker. Inactive imports
-- that omit cancelled_at preserve the existing reason.
create or replace function public.clear_reactivated_job_cancellation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.active then
    new.cancelled_at := null;
  end if;
  return new;
end;
$$;

revoke all on function public.clear_reactivated_job_cancellation() from public, anon, authenticated;
create trigger clear_reactivated_job_cancellation
before insert or update of active, cancelled_at on public.jobs
for each row execute function public.clear_reactivated_job_cancellation();
