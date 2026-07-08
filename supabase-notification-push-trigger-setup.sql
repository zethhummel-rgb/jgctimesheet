-- JGC Portal notification push trigger setup.
--
-- Run this once in Supabase SQL Editor after deploying the send-push-notification
-- Edge Function. This makes Supabase call the push function as soon as a
-- notification row is created, so phone push does not depend on someone opening
-- the PWA first.

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

create or replace function public.jgc_send_push_for_new_notification()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
begin
  perform net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'jgc_project_url') || '/functions/v1/send-push-notification',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'jgc_publishable_key'),
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'jgc_publishable_key')
    ),
    body := jsonb_build_object(
      'notification_ids', jsonb_build_array(new.id),
      'source', 'notifications_insert_trigger'
    )
  );

  return new;
end;
$$;

revoke all on function public.jgc_send_push_for_new_notification() from public;
revoke all on function public.jgc_send_push_for_new_notification() from anon;
revoke all on function public.jgc_send_push_for_new_notification() from authenticated;

drop trigger if exists jgc_notifications_push_after_insert on public.notifications;

create trigger jgc_notifications_push_after_insert
after insert on public.notifications
for each row
execute function public.jgc_send_push_for_new_notification();

-- Optional checks after running:
-- select tgname from pg_trigger where tgname = 'jgc_notifications_push_after_insert';
-- select * from net._http_response order by created desc limit 10;
