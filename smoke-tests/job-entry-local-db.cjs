// Run with JGC_PGLITE_MODULE pointing to an isolated @electric-sql/pglite install.
const { PGlite } = require(process.env.JGC_PGLITE_MODULE || '@electric-sql/pglite');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const migration = fs.readFileSync(path.join(__dirname,'../supabase/migrations/20260918174359_portal_job_entry.sql'),'utf8');
const check = fs.readFileSync(path.join(__dirname,'job-entry-database-check.sql'),'utf8');
(async () => {
  const db = new PGlite();
  await db.exec(`
    create role authenticated; create role anon; create schema auth; create schema private;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create table public.profiles(id uuid primary key, role text, account_status text);
    insert into public.profiles values('00000000-0000-4000-8000-000000000001','admin','approved'),('00000000-0000-4000-8000-000000000002','employee','approved');
    create function private.jgc_has_estimator_admin_access() returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.profiles where id=auth.uid() and role='admin' and account_status='approved') $$;
    create table public.estimator_workspaces(id text primary key,payload jsonb,revision bigint default 1,updated_at timestamptz default now(),updated_by uuid);
    create function private.touch_workspace() returns trigger language plpgsql as $$ begin new.revision:=old.revision+1; return new; end $$;
    create trigger touch_workspace before update on public.estimator_workspaces for each row execute function private.touch_workspace();
    insert into public.estimator_workspaces values('main','{"clients":[],"quotes":[],"jobs":[],"activity":[]}',1,now(),null);
    create table public.jobs(id uuid primary key default gen_random_uuid(),job_number text unique,job_name text,active boolean default true,job_type text,project_manager text,customer text,address text,site_name text,start_date date,target_end_date date,document_link text,document_link_label text,cancelled_at timestamptz,invoice_review_at timestamptz,accounting_status_changed_at timestamptz);
    alter table public.jobs enable row level security; alter table public.estimator_workspaces enable row level security;
    create policy jobs_admin on public.jobs for all to authenticated using(private.jgc_has_estimator_admin_access()) with check(private.jgc_has_estimator_admin_access());
    create policy jobs_employee on public.jobs for select to authenticated using(active and exists(select 1 from public.profiles where id=auth.uid() and account_status='approved'));
    create policy workspace_admin on public.estimator_workspaces for all to authenticated using(private.jgc_has_estimator_admin_access()) with check(private.jgc_has_estimator_admin_access());
    grant usage on schema auth,private to authenticated,anon;
    grant select on public.profiles to authenticated;
    grant select,insert,update,delete on public.jobs,public.estimator_workspaces to authenticated;
  `);
  await db.exec(migration);
  await db.exec(check);
  assert.equal((await db.query('select count(*)::integer n from jobs')).rows[0].n,0);
  console.log('PASS: transactional creation and security; rollback leaves zero jobs.');
  // Simulate the year boundary locally, using the same allocator body.
  const definition=migration.slice(migration.indexOf('create function public.create_portal_job'),migration.indexOf('revoke all on function public.create_portal_job'));
  for (const [stamp,expected] of [['2026-12-31 23:59:00-05','26001'],['2027-01-01 00:01:00-05','27001']]) {
    await db.exec(definition.replace('create function','create or replace function').replace('stamp := clock_timestamp();',`stamp := '${stamp}'::timestamptz;`));
    const result=await db.query(`select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',false)`);
    const rev=(await db.query('select revision from estimator_workspaces')).rows[0].revision;
    const created=await db.query(`select public.create_portal_job(gen_random_uuid(),$1,$2,$3) result`,[rev,{clientId:'year-client',project:'Year boundary',projectManager:'Test',jobType:'T&M',acceptedRevenue:0,hasQuotedValue:false},{id:'year-client',name:'Year boundary client'}]);
    assert.equal(created.rows[0].result.jobNumber,expected);
  }
  console.log('PASS: 2026 and 2027 number/date rollover.');
  // Independent simultaneous requests must not commit the same number. Stale
  // revision is deliberate: the second caller must refresh instead of overwriting.
  const rev=(await db.query('select revision from estimator_workspaces')).rows[0].revision;
  const outcomes=await Promise.allSettled([1,2].map(() => db.query(`select public.create_portal_job(gen_random_uuid(),$1,$2,$3) result`,[rev,{clientId:'year-client',project:'Concurrent creation',projectManager:'Test',jobType:'T&M',acceptedRevenue:0,hasQuotedValue:false},{id:'year-client',name:'Year boundary client'}])));
  assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(outcomes.filter(x=>x.status==='rejected' && x.reason.code==='40001').length,1);
  console.log('PASS: concurrent stale request rejected, unique successful number.');
  await db.close();
})().catch(error => { console.error(error); process.exitCode=1; });
