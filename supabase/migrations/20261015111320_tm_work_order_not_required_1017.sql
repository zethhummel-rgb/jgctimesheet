-- Explicit per-job/day exceptions, with reversible admin audit metadata.
create table private.tm_wo_exceptions (
 job_id uuid not null, work_date date not null, not_required boolean not null,
 changed_by uuid not null, changed_at timestamptz not null default now(),
 primary key(job_id,work_date)
);
alter table private.tm_wo_exceptions enable row level security;
revoke all on private.tm_wo_exceptions from public,anon,authenticated;
create function private.set_tm_work_order_not_required(p_job_id uuid,p_work_date date,p_not_required boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not coalesce(public.is_admin(),false) then
  raise exception 'Approved administrator access required' using errcode='42501';
 end if;
 if p_not_required is null or not exists (
  select 1 from private.tm_wo_weeks s cross join lateral jsonb_array_elements(s.items) i
  where s.week_start=private.tm_wo_week(now()) and (i->>'job_id')::uuid=p_job_id and (i->>'work_date')::date=p_work_date
 ) then raise exception 'This reminder has changed. Refresh the list and try again.' using errcode='22023'; end if;
 insert into private.tm_wo_exceptions(job_id,work_date,not_required,changed_by)
 values(p_job_id,p_work_date,p_not_required,auth.uid())
 on conflict(job_id,work_date) do update set not_required=excluded.not_required,changed_by=excluded.changed_by,changed_at=now();
end $$;
create function public.set_tm_work_order_not_required(p_job_id uuid,p_work_date date,p_not_required boolean) returns void
language sql security invoker set search_path='' as $$ select private.set_tm_work_order_not_required(p_job_id,p_work_date,p_not_required) $$;
revoke all on function private.set_tm_work_order_not_required(uuid,date,boolean),public.set_tm_work_order_not_required(uuid,date,boolean) from public,anon,authenticated;
grant execute on function private.set_tm_work_order_not_required(uuid,date,boolean),public.set_tm_work_order_not_required(uuid,date,boolean) to authenticated;

create or replace function private.get_tm_work_order_reminders() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_start date := private.tm_wo_week(now()); v_generated timestamptz; v_items jsonb;
begin
  if auth.uid() is null or not coalesce(public.is_admin(),false) then
    raise exception 'Approved administrator access required' using errcode='42501';
  end if;
  -- Catch up safely after a missed scheduler run or on first deployment.
  perform private.refresh_tm_wo_week();
  select generated_at into v_generated from private.tm_wo_weeks where week_start=v_start;
  select coalesce(jsonb_agg(item || jsonb_build_object('work_order_id',draft.id,'wo_number',draft.wo_number,
    'state',case when draft.id is null then 'missing' else 'started' end,
    'not_required',exists(select 1 from private.tm_wo_exceptions e where e.job_id=(item->>'job_id')::uuid and e.work_date=(item->>'work_date')::date and e.not_required))
    order by item->>'work_date',item->>'job_number'),'[]'::jsonb)
  into v_items
  from private.tm_wo_weeks s cross join lateral jsonb_array_elements(s.items) as x(item)
  left join lateral (
    select w.id,w.wo_number from public.work_orders w
    where w.work_order_date=(item->>'work_date')::date
      and (w.job_id=(item->>'job_id')::uuid or (w.job_id is null and lower(trim(w.job_number))=lower(trim(item->>'job_number'))))
      and lower(coalesce(w.status,'')) not in ('cancelled','canceled','void','submitted')
    order by w.updated_at desc nulls last,w.id limit 1
  ) draft on true
  where s.week_start=v_start and not exists (
    select 1 from public.work_orders w
    where w.work_order_date=(item->>'work_date')::date
      and (w.job_id=(item->>'job_id')::uuid or (w.job_id is null and lower(trim(w.job_number))=lower(trim(item->>'job_number'))))
      and (lower(w.status)='submitted' or (lower(w.status)='ready_for_submission' and w.labour_complete is true and coalesce(cardinality(w.waiting_for),0)=0))
  );
  return jsonb_build_object('week_start',v_start,'week_end',v_start+6,'generated_at',v_generated,'items',(select coalesce(jsonb_agg(i),'[]'::jsonb) from jsonb_array_elements(v_items) i where not (i->>'not_required')::boolean),
    'dismissed',(select coalesce(jsonb_agg(i),'[]'::jsonb) from jsonb_array_elements(v_items) i where (i->>'not_required')::boolean));
end $$;

