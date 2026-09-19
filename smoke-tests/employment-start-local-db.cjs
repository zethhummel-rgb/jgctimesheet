const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(process.env.JGC_PGLITE_MODULE);

(async () => {
  const db = new PGlite();
  await db.exec(`
    create schema auth; create schema private;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create role authenticated;
    create table profiles(id uuid primary key, display_name text, worker_key text, role text, account_status text, hire_date date);
    insert into profiles values ('00000000-0000-4000-8000-000000000001','Synthetic Admin','synthetic admin','admin','approved',null),('00000000-0000-4000-8000-000000000002','Synthetic Employee','synthetic employee','worker','approved',null);
    create function private.jgc_has_accounting_access() returns boolean language sql stable as $$ select exists(select 1 from public.profiles where id=auth.uid() and role='admin' and account_status='approved') $$;
    create table work_order_labour_workers(id uuid primary key, profile_id uuid, approved boolean);
    create table employee_feature_access(worker_id uuid, feature_key text, enabled boolean);
    insert into work_order_labour_workers values ('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000002',true);
    insert into employee_feature_access values ('00000000-0000-4000-8000-000000000003','accounting',true);
    create table timesheet_entries(id uuid default gen_random_uuid(), profile_id uuid, worker_name text, week_start date, week_end text, job_name text, job_number text, day_of_week text, time_in time, time_out time, hours numeric, took_lunch boolean, night_work boolean, entry_type text, leave_type text, leave_note text, admin_entered_by text, admin_entered_at timestamptz, admin_entry_note text, created_at timestamptz default now());
    create table previous_timesheet_weeks(id uuid default gen_random_uuid(),profile_id uuid,worker_name text,week_label text,entries jsonb,total_hours numeric,note text);
    grant usage on schema public,auth,private to authenticated;
    grant select,insert,update,delete on all tables in schema public to authenticated;
    alter table profiles enable row level security;
    create policy read_profiles on profiles for select to authenticated using(true);
    create policy update_profiles on profiles for update to authenticated using(auth.uid()='00000000-0000-4000-8000-000000000001');
  `);
  await db.exec(fs.readFileSync(path.join(__dirname, '../supabase/migrations/20260918181809_employee_employment_start_date.sql'), 'utf8'));
  await db.exec(`
    do $$ begin
      if exists(select 1 from profiles where hire_date is not null) then raise exception 'Existing unknown dates were changed'; end if;
      insert into profiles(id) values(gen_random_uuid());
      if not exists(select 1 from profiles where hire_date=(now() at time zone 'America/Toronto')::date) then raise exception 'New-account default missing'; end if;
    end $$;
  `);
  await db.exec(fs.readFileSync(path.join(__dirname, 'employment-start-database-check.sql'), 'utf8'));
  const retained = await db.query('select count(*)::int n from previous_timesheet_weeks');
  if (retained.rows[0].n !== 0) throw Error('Verification retained archive data');
  console.log('PASS: legacy/default dates, partial weeks, pre-start autofill rejection, full weeks, employee denial and rollback.');
  await db.close();
})().catch(error => { console.error(error.message); process.exitCode = 1; });
