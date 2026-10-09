-- Release 1013: scheduler/push authorization. No backup schedules or records are removed.
-- Deploy this migration before the guarded Edge Functions. The old functions accept
-- the added header, so queue processing continues during the rollout.
do $vault$
begin
  if not exists(select 1 from vault.secrets where name='jgc_worker_token') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'jgc_worker_token','Private JGC scheduler and notification trigger authorization');
  end if;
  if (select count(*) from vault.secrets where name='jgc_worker_token')<>1 then
    raise exception 'Expected one private scheduler token.';
  end if;
end $vault$;

create or replace function public.jgc_validate_worker_token(p_token text)
returns boolean language sql stable security definer set search_path='' as $f$
 select coalesce(p_token ~ '^[a-f0-9]{64}$' and exists(
   select 1 from vault.decrypted_secrets s where s.name='jgc_worker_token'
    and extensions.digest(s.decrypted_secret,'sha256')=extensions.digest(p_token,'sha256')
 ),false)
$f$;
revoke all on function public.jgc_validate_worker_token(text) from public,anon,authenticated;
grant execute on function public.jgc_validate_worker_token(text) to service_role;

create or replace function private.jgc_worker_headers()
returns jsonb language sql stable security definer set search_path='' as $f$
 select jsonb_build_object('Content-Type','application/json',
   'apikey',(select decrypted_secret from vault.decrypted_secrets where name='jgc_publishable_key'),
   'Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='jgc_publishable_key'),
   'x-jgc-worker-token',(select decrypted_secret from vault.decrypted_secrets where name='jgc_worker_token'))
$f$;
revoke all on function private.jgc_worker_headers() from public,anon,authenticated;

do $cron$
declare item record; job_id bigint; command text;
begin
 for item in select * from (values
   ('jgc-schedule-reminders-every-15-minutes','send-schedule-reminders'),
   ('jgc-auto-submit-work-orders','auto-submit-work-orders'),
   ('jgc-digital-po-email-worker','send-digital-po-email')
 ) as workers(job_name,function_name) loop
   select jobid into strict job_id from cron.job where jobname=item.job_name;
   command:=format($command$
     select net.http_post(
       url := (select decrypted_secret from vault.decrypted_secrets where name='jgc_project_url') || %L,
       headers := private.jgc_worker_headers(),
       body := jsonb_build_object('source','pg_cron','scheduled_at',now())
     );
   $command$,'/functions/v1/'||item.function_name);
   perform cron.alter_job(job_id=>job_id,command=>command);
 end loop;
end $cron$;

create or replace function public.jgc_send_push_for_new_notification()
returns trigger language plpgsql security definer set search_path='' as $f$
begin
 perform net.http_post(
   url := (select decrypted_secret from vault.decrypted_secrets where name='jgc_project_url')||'/functions/v1/send-push-notification',
   headers := private.jgc_worker_headers(),
   body := jsonb_build_object('notification_ids',jsonb_build_array(new.id),'source','notifications_insert_trigger'));
 return new;
end $f$;
revoke all on function public.jgc_send_push_for_new_notification() from public,anon,authenticated;

alter table public.push_subscriptions add constraint push_subscriptions_provider_endpoint_1013
check(length(endpoint)<=4096 and endpoint ~* '^https://(web[.]push[.]apple[.]com|fcm[.]googleapis[.]com|updates[.]push[.]services[.]mozilla[.]com|([a-z0-9-]+[.])?notify[.]windows[.]com)/[^[:space:]#]+$') not valid;
alter table public.push_subscriptions validate constraint push_subscriptions_provider_endpoint_1013;

create table public.digital_po_cancellation_deliveries(
  po_id uuid primary key references public.digital_purchase_orders(id) on delete cascade,
  status text not null check(status in ('sending','failed','sent')),
  lock_token uuid not null,
  claimed_at timestamptz not null default now(),
  sent_at timestamptz,
  last_error text
);
alter table public.digital_po_cancellation_deliveries enable row level security;
revoke all on public.digital_po_cancellation_deliveries from public,anon,authenticated;
grant all on public.digital_po_cancellation_deliveries to service_role;

create or replace function public.jgc_claim_po_cancellation(p_po_id uuid,p_actor_id uuid)
returns uuid language plpgsql security definer set search_path='' as $f$
declare claim uuid;
begin
 if not exists(select 1 from public.digital_purchase_orders po join public.profiles p on p.id=p_actor_id
   where po.id=p_po_id and po.workflow_status='cancelled' and p.account_status='approved'
     and (po.creator_profile_id=p.id or p.role='admin')) then
   raise exception 'Approved PO creator or administrator authorization required.';
 end if;
 insert into public.digital_po_cancellation_deliveries(po_id,status,lock_token,claimed_at)
 values(p_po_id,'sending',gen_random_uuid(),now())
 on conflict(po_id) do update set status='sending',lock_token=excluded.lock_token,claimed_at=now(),last_error=null
 where digital_po_cancellation_deliveries.sent_at is null and
   (digital_po_cancellation_deliveries.status='failed' or digital_po_cancellation_deliveries.claimed_at<now()-interval '2 minutes')
 returning lock_token into claim;
 return claim;
end $f$;
revoke all on function public.jgc_claim_po_cancellation(uuid,uuid) from public,anon,authenticated;
grant execute on function public.jgc_claim_po_cancellation(uuid,uuid) to service_role;

create or replace function public.jgc_finish_po_cancellation(p_po_id uuid,p_lock_token uuid,p_success boolean)
returns boolean language plpgsql security definer set search_path='' as $f$
declare changed integer;
begin
 update public.digital_po_cancellation_deliveries set
   status=case when p_success then 'sent' else 'failed' end,
   sent_at=case when p_success then now() else null end,
   last_error=case when p_success then null else 'Cancellation delivery could not be completed.' end
 where po_id=p_po_id and lock_token=p_lock_token and status='sending';
 get diagnostics changed=row_count;
 return changed=1;
end $f$;
revoke all on function public.jgc_finish_po_cancellation(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.jgc_finish_po_cancellation(uuid,uuid,boolean) to service_role;
