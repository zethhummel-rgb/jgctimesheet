const assert=require('node:assert/strict'),fs=require('node:fs');
const {PGlite}=require(process.env.JGC_PGLITE_MODULE);
(async()=>{
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create schema private;create schema auth;create schema cron;
 grant usage on schema private,auth to authenticated;
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function public.is_admin() returns boolean language sql as $$select auth.uid()='00000000-0000-4000-8000-000000000001'::uuid$$;
 create table cron.jobs(name text,schedule text,command text);
 create function cron.schedule(text,text,text) returns bigint language sql as $$insert into cron.jobs values($1,$2,$3) returning 1::bigint$$;
 create table profiles(id uuid,worker_key text,display_name text);
 insert into profiles values('00000000-0000-4000-8000-000000000050','synthetic worker','Synthetic Full Name');
 create table jobs(id uuid,job_number text,job_name text,job_type text,active boolean);
 create table timesheet_entries(id uuid,worker_name text,profile_id uuid,job_number text,hours numeric,entry_type text,week_start date,day_of_week text,created_at timestamptz);
 create table previous_timesheet_weeks(id uuid,worker_name text,profile_id uuid,entries jsonb,submitted_at timestamptz);
 create table work_orders(id uuid,wo_number text,work_order_date date,job_id uuid,job_number text,status text,updated_at timestamptz,labour_complete boolean,waiting_for text[]);`);
 const migration=fs.readdirSync('supabase/migrations').find(n=>n.endsWith('_tm_work_order_reminders_1016.sql'));
 await db.exec(fs.readFileSync('supabase/migrations/'+migration,'utf8'));
 for(const [time,expected] of [
  ['2026-10-19T10:59:59Z','2026-10-04'],['2026-10-19T11:00:00Z','2026-10-11'],
  ['2026-11-02T11:59:59Z','2026-10-18'],['2026-11-02T12:00:00Z','2026-10-25'],
  ['2027-03-15T10:59:59Z','2027-02-28'],['2027-03-15T11:00:00Z','2027-03-07']])
   assert.equal((await db.query('select private.tm_wo_week($1)::text as d',[time])).rows[0].d,expected);
 assert.equal((await db.query("select private.tm_wo_work_date('2026-10-13','Tuesday')::text as d")).rows[0].d,'2026-10-13');
 assert.equal((await db.query("select private.tm_wo_work_date('2026-02-31','Monday') as d")).rows[0].d,null);
 await db.exec(fs.readFileSync('supabase/migrations/'+fs.readdirSync('supabase/migrations').find(n=>n.endsWith('_tm_work_order_not_required_1017.sql')),'utf8'));
 const start=(await db.query('select private.tm_wo_week(now())::text as d')).rows[0].d;
 const job='00000000-0000-4000-8000-000000000010',entry='00000000-0000-4000-8000-000000000020';
 await db.query('insert into jobs values($1,$2,$3,$4,false)',[job,'26999','Synthetic T&M','T&M']);
 await db.query('insert into jobs values($1,$2,$3,$4,true)',['00000000-0000-4000-8000-000000000011','26998','Contract','Contract']);
 await db.query(`insert into timesheet_entries values($1,'Synthetic Worker',null,'26999',8,'work',$2,'Monday',now()),
 ('00000000-0000-4000-8000-000000000021','Second Worker',null,'26999',4,'work',$2,'Monday',now()),
 ('00000000-0000-4000-8000-000000000022','Sick Worker',null,'26999',8,'sick',$2,'Tuesday',now()),
 ('00000000-0000-4000-8000-000000000023','Contract Worker',null,'26998',8,'work',$2,'Tuesday',now())`,[entry,start]);
 await db.query('insert into previous_timesheet_weeks values($1,$2,null,$3,now())',['00000000-0000-4000-8000-000000000030','Synthetic Worker',[
  {id:entry,day:'Monday',weekStartValue:start,jobNumber:'26999',hours:9,entryType:'work'},
  {id:'archive-only',day:'Tuesday',weekStartValue:start,jobNumber:'26999',hours:6,entryType:'work'},
  {id:'bad-date',day:'Tuesday',weekStartValue:'2026-02-31',jobNumber:'26999',hours:6,entryType:'work'}]]);
 await db.exec('select private.refresh_tm_wo_week()');
 const before=(await db.query('select items from private.tm_wo_weeks')).rows[0].items;
 assert.equal(before.length,2);assert.equal(before[0].hours,13);assert.equal(before[0].workers.length,2);assert.equal(before[1].hours,6);
 assert(before[0].workers.some(w=>w.name==='Synthetic Full Name'));
 await db.exec('select private.refresh_tm_wo_week()');assert.equal((await db.query('select count(*)::int n from private.tm_wo_weeks')).rows[0].n,1);
 await db.exec("set role authenticated;set request.jwt.claim.sub='00000000-0000-4000-8000-000000000002'");
 await assert.rejects(db.query('select public.get_tm_work_order_reminders()'),/administrator/i);
 await assert.rejects(db.query('select * from private.tm_wo_weeks'),/permission denied/);
 await assert.rejects(db.query('select private.refresh_tm_wo_week()'),/permission denied/);
 await db.exec("set request.jwt.claim.sub='00000000-0000-4000-8000-000000000001'");
 const read=async()=>(await db.query('select public.get_tm_work_order_reminders() as data')).rows[0].data;
 assert.equal((await read()).items.length,2);
 const reminder=(await read()).items[0];
 await db.query('select public.set_tm_work_order_not_required($1,$2,true)',[job,reminder.work_date]);
 assert.equal((await read()).items.length,1);assert.equal((await read()).dismissed.length,1);
 await db.query('select public.set_tm_work_order_not_required($1,$2,false)',[job,reminder.work_date]);
 assert.equal((await read()).items.length,2);assert.equal((await read()).dismissed.length,0);
 await assert.rejects(db.query('select public.set_tm_work_order_not_required($1,$2,true)',[job,'2000-01-01']),/reminder has changed/);
 await db.exec("set request.jwt.claim.sub='00000000-0000-4000-8000-000000000002'");
 await assert.rejects(db.query('select public.set_tm_work_order_not_required($1,$2,true)',[job,reminder.work_date]),/administrator/i);
 await assert.rejects(db.query('select * from private.tm_wo_exceptions'),/permission denied/);
 await db.exec("reset role;set request.jwt.claim.sub='00000000-0000-4000-8000-000000000001'");
 await db.query(`insert into work_orders values('00000000-0000-4000-8000-000000000040','WO-SYNTH',$1::date+1,$2,'26999','draft',now(),false,'{}')`,[start,job]);
 await db.exec("set role authenticated;set request.jwt.claim.sub='00000000-0000-4000-8000-000000000001'");
 assert.equal((await read()).items[0].state,'started');
 await db.exec("reset role;update work_orders set status='ready_for_submission',labour_complete=true,waiting_for=array['Unsigned worker'];set role authenticated");
 assert.equal((await read()).items.length,2);
 await db.exec("reset role;update work_orders set waiting_for='{}';set role authenticated");
 assert.equal((await read()).items.length,1);
 await db.exec("reset role;update work_orders set status='submitted',work_order_date=work_order_date+1;set role authenticated");
 assert.equal((await read()).items[0].work_date,before[0].work_date); // Actual work date, never creation date.
 await db.exec('reset role;set role anon');await assert.rejects(db.query('select public.get_tm_work_order_reminders()'),/permission denied/);
 await db.exec('reset role');assert.equal((await db.query('select count(*)::int n from timesheet_entries')).rows[0].n,4);
 assert.equal((await db.query('select * from cron.jobs')).rows[0].schedule,'0 * * * *');
 await db.close();console.log('PASS: Monday7/DST, Sunday-Saturday, legacy dates, archive dedup, grouped hours, work-only/T&M-only, inactive jobs, private admin-only access, idempotence, draft/live completion and actual-date matching.');
})().catch(e=>{console.error(e);process.exitCode=1;});
