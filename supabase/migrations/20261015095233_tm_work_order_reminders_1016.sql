-- Weekly billing reminder only. Existing timesheets, WOs and delivery schedules are unchanged.
create table private.tm_wo_weeks (
  week_start date primary key,
  generated_at timestamptz not null default now(),
  items jsonb not null
);
alter table private.tm_wo_weeks enable row level security;
revoke all on private.tm_wo_weeks from public, anon, authenticated;

-- Monday 07:00 Toronto is the cutover, including both daylight-saving offsets.
create function private.tm_wo_week(p_now timestamptz) returns date
language sql stable set search_path = '' as $$
  select date_trunc('week', (p_now at time zone 'America/Toronto') - interval '7 hours')::date - 8
$$;

create function private.tm_wo_date(p_value text) returns date
language plpgsql immutable set search_path = '' as $$
begin
  if p_value ~ '^\d{4}-\d{2}-\d{2}$' then return p_value::date; end if;
  return null;
exception when datetime_field_overflow or invalid_datetime_format then return null;
end $$;

create function private.tm_wo_work_date(p_start text, p_day text) returns date
language plpgsql immutable set search_path = '' as $$
declare
  v_start date := private.tm_wo_date(p_start);
  v_day integer := array_position(array['sunday','monday','tuesday','wednesday','thursday','friday','saturday'], lower(trim(p_day))) - 1;
begin
  if v_start is null or v_day is null then return null; end if;
  -- Older daily rows used that actual day's date instead of a Sunday week anchor.
  if extract(dow from v_start) = v_day then return v_start; end if;
  if extract(dow from v_start) <> 0 then return null; end if;
  return v_start + v_day;
end $$;

create function private.refresh_tm_wo_week() returns void
language plpgsql security definer set search_path = '' as $$
declare v_start date := private.tm_wo_week(now()); v_items jsonb;
begin
  perform pg_advisory_xact_lock(1016, 1);
  if exists (select 1 from private.tm_wo_weeks where week_start = v_start) then return; end if;
  with sources as (
    select e.id::text as entry_id, e.worker_name, e.profile_id::text as profile_id,
      e.job_number, e.hours, coalesce(nullif(e.entry_type,''),'work') as kind,
      private.tm_wo_work_date(e.week_start::text,e.day_of_week) as work_date,
      0 as priority, e.created_at as source_time, e.id::text as source_id
    from public.timesheet_entries e
    where e.week_start between v_start and v_start + 6
    union all
    select coalesce(nullif(x.entry->>'id',''), 'archive:'||p.id::text||':'||x.ordinality),
      coalesce(nullif(x.entry->>'user',''),p.worker_name),p.profile_id::text,
      x.entry->>'jobNumber',
      case when x.entry->>'hours' ~ '^\d+(\.\d+)?$' then (x.entry->>'hours')::numeric else 0 end,
      coalesce(nullif(x.entry->>'entryType',''),'work'),
      private.tm_wo_work_date(coalesce(nullif(x.entry->>'weekStartValue',''),x.entry->>'weekStart'),coalesce(x.entry->>'day',x.entry->>'dayOfWeek')),
      1,p.submitted_at,p.id::text||':'||x.ordinality
    from public.previous_timesheet_weeks p
    cross join lateral jsonb_array_elements(case when jsonb_typeof(p.entries)='array' then p.entries else '[]'::jsonb end) with ordinality as x(entry,ordinality)
  ), dedup as (
    select distinct on (entry_id) * from sources
    order by entry_id, priority desc, source_time desc nulls last, source_id desc
  ), unique_jobs as (
    -- Job numbers are identifiers; never match on a job name alone.
    select lower(trim(job_number)) as number, min(id::text)::uuid as id
    from public.jobs where nullif(trim(job_number),'') is not null
    group by lower(trim(job_number)) having count(*)=1
  ), unique_workers as (
    select lower(trim(worker_key)) as worker_key,min(id::text) as id
    from public.profiles where nullif(trim(worker_key),'') is not null
    group by lower(trim(worker_key)) having count(*)=1
  ), workers as (
    select j.id,j.job_number,j.job_name,d.work_date,
      coalesce(nullif(d.profile_id,''),uw.id,'name:'||lower(trim(d.worker_name))) as worker_key,
      coalesce(max(nullif(trim(p.display_name),'')),max(nullif(trim(d.worker_name),'')),'Employee') as name,sum(d.hours) as hours
    from dedup d join unique_jobs u on u.number=lower(trim(d.job_number))
    join public.jobs j on j.id=u.id
    left join unique_workers uw on d.profile_id is null and uw.worker_key=lower(trim(d.worker_name))
    left join public.profiles p on p.id::text=coalesce(nullif(d.profile_id,''),uw.id)
    where lower(regexp_replace(coalesce(j.job_type,''),'\s','','g'))='t&m'
      and d.work_date between v_start and v_start+6 and d.hours>0
      and lower(trim(d.kind))='work'
    group by j.id,j.job_number,j.job_name,d.work_date,coalesce(nullif(d.profile_id,''),uw.id,'name:'||lower(trim(d.worker_name)))
  ), grouped as (
    select id,job_number,job_name,work_date,sum(hours) as hours,
      jsonb_agg(jsonb_build_object('name',name,'hours',hours) order by name,worker_key) as workers
    from workers group by id,job_number,job_name,work_date
  )
  select coalesce(jsonb_agg(jsonb_build_object('job_id',id,'job_number',job_number,'job_name',job_name,
    'work_date',work_date,'hours',hours,'workers',workers) order by work_date,job_number,id),'[]'::jsonb)
  into v_items from grouped;
  insert into private.tm_wo_weeks(week_start,items) values(v_start,v_items);
end $$;

create function private.get_tm_work_order_reminders() returns jsonb
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
    'state',case when draft.id is null then 'missing' else 'started' end)
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
  return jsonb_build_object('week_start',v_start,'week_end',v_start+6,'generated_at',v_generated,'items',v_items);
end $$;

create function public.get_tm_work_order_reminders() returns jsonb
language sql security invoker set search_path = '' as $$ select private.get_tm_work_order_reminders() $$;

revoke all on function private.tm_wo_week(timestamptz),private.tm_wo_date(text),private.tm_wo_work_date(text,text),
  private.refresh_tm_wo_week(),private.get_tm_work_order_reminders(),public.get_tm_work_order_reminders() from public,anon,authenticated;
grant execute on function private.get_tm_work_order_reminders(),public.get_tm_work_order_reminders() to authenticated;

-- Hourly UTC ticks hit 07:00 Toronto in both seasons. Only a new weekly boundary does work.
select cron.schedule('jgc-tm-wo-weekly-reminder','0 * * * *',$cron$select private.refresh_tm_wo_week();$cron$);
