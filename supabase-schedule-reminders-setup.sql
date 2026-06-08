alter table public.schedule_events
  add column if not exists one_day_reminder_sent_at timestamptz,
  add column if not exists two_hour_reminder_sent_at timestamptz;

-- Deploy the Edge Function in supabase/functions/send-schedule-reminders,
-- then schedule it to run every 15 minutes.
-- Supabase Dashboard path:
-- Edge Functions -> send-schedule-reminders -> Deploy
-- Cron/Scheduled Functions -> run every 15 minutes
