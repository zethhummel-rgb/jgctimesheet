-- Release 1013: bind safety acknowledgement and announcement authorization to account UUIDs.
-- Contact email remains editable; it is never proof that a caller owns another worker's record.
-- Preserve all historical acknowledgement/signature content and existing creator/admin workflows.

create temp table jgc_identity_preservation_1013 on commit drop as
select (select count(*) from public.safety_acknowledgements) as acknowledgements,
  (select md5(coalesce(string_agg(id::text || coalesce(signature_strokes::text,'') ||
    coalesce(signature_signed_name,'') || coalesce(signature_signed_at::text,'') ||
    coalesce(acknowledged_at::text,''),'|' order by id),'')) from public.safety_acknowledgements) as signatures,
  (select count(*) from public.announcements) as announcements,
  (select count(*) from public.work_order_labour_timesheet_links) as labour_links;

-- Only reconcile legacy employee rows with one verified Auth account that already existed when
-- the acknowledgement was created. External/manual attendees remain unlinked for admin review.
with candidates as (
  select a.id, min(p.id::text)::uuid as profile_id
  from public.safety_acknowledgements a
  join auth.users u on lower(btrim(u.email)) = lower(btrim(a.matched_employee_email))
    and u.created_at <= a.created_at
  join public.profiles p on p.id = u.id
  where a.matched_employee_id is null
    and nullif(btrim(a.matched_employee_email), '') is not null
    and a.attendee_type = 'employee'
  group by a.id
  having count(distinct p.id) = 1
)
update public.safety_acknowledgements a
set matched_employee_id = c.profile_id
from candidates c
where a.id = c.id and a.matched_employee_id is null;

create or replace function private.jgc_safety_ack_is_mine(
  p_matched_employee_id uuid, p_matched_employee_email text,
  p_attendee_name text, p_attendee_key text
)
returns boolean language sql stable security definer set search_path = '' as $f$
  select p_matched_employee_id is not null
    and p_matched_employee_id = (select auth.uid())
    and exists (
      select 1 from public.profiles p where p.id = (select auth.uid())
        and p.account_status in ('approved', 'limited')
    )
$f$;
revoke all on function private.jgc_safety_ack_is_mine(uuid,text,text,text) from public, anon;
grant execute on function private.jgc_safety_ack_is_mine(uuid,text,text,text) to authenticated;

-- Patch the current function in place so its prepared/today/late-sign-on and signature checks
-- stay intact. Refuse to deploy if the expected current implementation has drifted.
create or replace function pg_temp.jgc_replace_once(def text, old_text text, new_text text)
returns text language plpgsql as $f$
begin
  if (length(def) - length(replace(def, old_text, ''))) / length(old_text) <> 1 then
    raise exception 'Safety identity patch expected exactly one current source match.';
  end if;
  return replace(def, old_text, new_text);
end $f$;

do $do$
declare def text;
begin
  def := pg_get_functiondef('public.submit_current_user_safety_acknowledgement(text,uuid,text,jsonb,integer,integer)'::regprocedure);
  def := pg_temp.jgc_replace_once(def,
    $old$  v_attendee_key := regexp_replace(lower(coalesce(nullif(v_email, ''), v_display_name) || '|' || v_company), '[^a-z0-9@._|+-]+', '-', 'g');
  v_attendee_key := btrim(v_attendee_key, '-');$old$,
    $new$  v_attendee_key := 'employee:' || v_user_id::text;$new$);
  def := pg_temp.jgc_replace_once(def,
    $old$    and (
      a.matched_employee_id = v_user_id
      or (v_email <> '' and lower(coalesce(a.matched_employee_email, '')) = v_email)
      or a.attendee_key = v_attendee_key
    )$old$,
    $new$    and a.matched_employee_id = v_user_id$new$);
  execute def;
end $do$;

alter table public.announcements
  add column if not exists target_profile_id uuid references public.profiles(id) on delete set null;
create index if not exists announcements_target_profile_idx
  on public.announcements(target_profile_id) where target_profile_id is not null;

-- Worker keys are unique and admin-controlled. Email matching uses verified Auth records,
-- never the editable contact field. Conflicting or unresolved legacy targets fail closed.
create or replace function private.jgc_resolve_employee_target(p_worker_key text, p_email text)
returns uuid language sql stable security definer set search_path = '' as $f$
  select case when count(distinct p.id) = 1 then min(p.id::text)::uuid end
  from public.profiles p join auth.users u on u.id = p.id
  where (nullif(btrim(p_worker_key), '') is not null
      and lower(btrim(p.worker_key)) = lower(btrim(p_worker_key)))
    or (nullif(btrim(p_email), '') is not null
      and lower(btrim(u.email)) = lower(btrim(p_email)))
$f$;
revoke all on function private.jgc_resolve_employee_target(text,text) from public, anon, authenticated;

update public.announcements a
set target_profile_id = private.jgc_resolve_employee_target(a.target_worker_name,a.target_worker_email)
where a.target_profile_id is null
  and (nullif(btrim(a.target_worker_name), '') is not null or nullif(btrim(a.target_worker_email), '') is not null);

create or replace function private.jgc_bind_announcement_target()
returns trigger language plpgsql security definer set search_path = '' as $f$
begin
  if tg_op = 'INSERT' or new.target_worker_name is distinct from old.target_worker_name
    or new.target_worker_email is distinct from old.target_worker_email then
    new.target_profile_id := private.jgc_resolve_employee_target(new.target_worker_name,new.target_worker_email);
  end if;
  return new;
end $f$;
revoke all on function private.jgc_bind_announcement_target() from public, anon, authenticated;
drop trigger if exists jgc_bind_announcement_target on public.announcements;
create trigger jgc_bind_announcement_target
before insert or update of target_worker_name,target_worker_email on public.announcements
for each row execute function private.jgc_bind_announcement_target();

drop policy if exists "Approved users can read active announcements" on public.announcements;
create policy "Approved users can read active announcements" on public.announcements
for select to authenticated
using (
  is_active and (expires_at is null or expires_at > now()) and private.jgc_has_full_portal_access()
  and (
    target_profile_id = (select auth.uid())
    or (target_profile_id is null and nullif(btrim(target_worker_name), '') is null
      and nullif(btrim(target_worker_email), '') is null)
  )
);

-- This legacy reconciliation table is empty and no deployed Portal code/routine writes it.
-- Remove direct cross-worker mutation; service-role reconciliation keeps its existing access.
revoke insert, update, delete on public.work_order_labour_timesheet_links from anon, authenticated;
drop policy if exists "Authenticated users can manage WO labour timesheet links"
  on public.work_order_labour_timesheet_links;
create policy "Owners and admins read WO labour timesheet links"
on public.work_order_labour_timesheet_links for select to authenticated
using (private.jgc_has_full_portal_access() and (
  (select public.is_admin())
  or exists (
    select 1 from public.timesheet_entries t
    where t.id = work_order_labour_timesheet_links.timesheet_entry_id
      and t.profile_id = (select auth.uid())
  )
));

-- Abort the whole migration if existing records or signature content changed unexpectedly.
do $verify$
begin
  if exists (
    select 1 from jgc_identity_preservation_1013 b where
      b.acknowledgements <> (select count(*) from public.safety_acknowledgements)
      or b.signatures <> (select md5(coalesce(string_agg(id::text || coalesce(signature_strokes::text,'') ||
        coalesce(signature_signed_name,'') || coalesce(signature_signed_at::text,'') ||
        coalesce(acknowledged_at::text,''),'|' order by id),'')) from public.safety_acknowledgements)
      or b.announcements <> (select count(*) from public.announcements)
      or b.labour_links <> (select count(*) from public.work_order_labour_timesheet_links)
  ) then raise exception 'Security identity migration must preserve historical records and signatures.';
  end if;
end $verify$;
