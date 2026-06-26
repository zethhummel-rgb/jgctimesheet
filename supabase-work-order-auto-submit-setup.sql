-- Work Order automatic Monday submission scheduler.
--
-- What this does:
-- 1. Enables pg_cron and pg_net.
-- 2. Stores the project URL and publishable key in Supabase Vault if missing.
-- 3. Schedules the auto-submit-work-orders Edge Function to run every 15 minutes.
--
-- The Edge Function itself only submits Work Orders that are:
-- - status = ready_for_submission
-- - unlocked
-- - labour complete
-- - past the following Monday at 8:00 AM America/Toronto

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

do $$
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'jgc_project_url') then
    perform vault.create_secret('https://xnrljkkszoimegfivlya.supabase.co', 'jgc_project_url');
  end if;

  if not exists (select 1 from vault.decrypted_secrets where name = 'jgc_publishable_key') then
    perform vault.create_secret('sb_publishable_k_m_R-jzMnsnHhNY_OHwJA_cbO1qO58', 'jgc_publishable_key');
  end if;
end $$;

select cron.unschedule(jobid)
from cron.job
where jobname = 'jgc-auto-submit-work-orders';

select cron.schedule(
  'jgc-auto-submit-work-orders',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'jgc_project_url') || '/functions/v1/auto-submit-work-orders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'jgc_publishable_key'),
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'jgc_publishable_key')
    ),
    body := jsonb_build_object(
      'source', 'pg_cron',
      'scheduled_at', now()
    )
  ) as request_id;
  $$
);

-- Optional check after running:
-- select * from cron.job where jobname = 'jgc-auto-submit-work-orders';
