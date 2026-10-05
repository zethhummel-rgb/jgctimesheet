// Isolated Postgres/RLS exercise. No remote database, credentials, or files are used.
// Run with JGC_PGLITE_MODULE pointing to an existing @electric-sql/pglite install.
const { PGlite } = require(process.env.JGC_PGLITE_MODULE || '@electric-sql/pglite');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
let policyAclBefore, policyAclAfter;

const ids = Object.fromEntries(['admin', 'staff', 'otherStaff', 'client', 'disabled', 'limited', 'deleted', 'job', 'otherJob'].map((name, i) => [name, `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`]));

async function createDatabase() {
  const db = new PGlite();
  await db.exec(`
    create role authenticated; create role anon; create role service_role bypassrls;
    create schema auth; create schema private; create schema storage;
    create table auth.users(id uuid primary key, email text, raw_app_meta_data jsonb default '{}', raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    create table public.profiles(id uuid primary key references auth.users(id), worker_key text, display_name text, email text, role text, account_status text);
    create function public.is_admin() returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.profiles where id=auth.uid() and role='admin' and account_status='approved') $$;
    create function private.jgc_has_full_portal_access() returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.profiles where id=auth.uid() and account_status='approved') $$;
    create function private.jgc_has_estimator_admin_access() returns boolean language sql stable security definer set search_path='' as $$ select public.is_admin() $$;
    create table public.jobs(id uuid primary key default gen_random_uuid(), job_number text unique, job_name text, active boolean default true, address text, site_name text, customer text, job_type text, project_manager text, document_link text, document_link_label text, cancelled_at timestamptz);
    create table public.estimator_workspaces(id text primary key, payload jsonb, revision bigint default 1, updated_at timestamptz default now(), updated_by uuid);
    create table storage.buckets(id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text, owner uuid, owner_id text, metadata jsonb default '{}', created_at timestamptz default now(), updated_at timestamptz default now(), unique(bucket_id, name));
    create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1)-1] $$;
    alter table storage.objects enable row level security;
    grant usage on schema auth, private, storage to authenticated, anon;
    grant select, insert, update, delete on storage.objects to authenticated, anon;
    grant select on public.profiles to authenticated;
    alter table public.profiles enable row level security;
    create policy profiles_own on public.profiles for select to authenticated using(id=auth.uid() or public.is_admin());
    alter table public.jobs enable row level security;
    create policy jobs_staff on public.jobs for select to authenticated using(private.jgc_has_full_portal_access());
    grant select on public.jobs to authenticated;
    alter table public.estimator_workspaces enable row level security;
    create policy estimator_admin on public.estimator_workspaces for all to authenticated using(public.is_admin()) with check(public.is_admin());
    grant select,insert,update,delete on public.estimator_workspaces to authenticated;
    create table public.inspection_records(id uuid primary key,worker_name text,worker_display_name text,inspection_type text,inspection_date date,title text,form_data jsonb,created_at timestamptz default now());
    create table public.toolbox_talk_reports(id uuid primary key,submitted_by_worker text,talk_title text,report_date date,project text,created_at timestamptz default now(),report_details jsonb,is_duplicate boolean default false);
    create table public.daily_site_reports(id uuid primary key,worker_name text,report_date date,project text,created_at timestamptz default now(),report_details jsonb);
    create table public.incident_reports(id uuid primary key,reported_by_worker text,report_date date,project text,incident_type text,created_at timestamptz default now(),report_details jsonb);
    create table public.accident_reports(id uuid primary key,created_by_worker text,accident_date date,accident_location text,site_location text,created_at timestamptz default now(),report_details jsonb);
    create table public.employee_injury_reports(id uuid primary key,created_by_worker text,accident_date date,accident_location text,created_at timestamptz default now(),report_details jsonb);
    create table public.policies(id uuid primary key,title text,description text,file_path text,file_name text,file_type text,is_active boolean,category text,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
  `);
  for (const [name, accountStatus, role] of [['admin','approved','admin'],['staff','approved','worker'],['otherStaff','approved','worker'],['client','limited','client'],['disabled','disabled','worker'],['limited','limited','worker'],['deleted',null,null]]) {
    await db.query('insert into auth.users(id,email) values($1,$2)', [ids[name], `${name}@example.invalid`]);
    if (accountStatus) await db.query('insert into public.profiles values($1,$2,$3,$4,$5,$6)', [ids[name], name, `Synthetic ${name}`, `${name}@example.invalid`, role, accountStatus]);
  }
  await db.query('insert into public.jobs(id,job_number,job_name,address,site_name,customer) values($1,$2,$3,$4,$5,$6),($7,$8,$9,$10,$11,$12)', [ids.job,'26999','Synthetic board job','Test location','Test site','Test client',ids.otherJob,'26998','Other isolated job','Other location','Other site','Other client']);
  await db.query('insert into public.estimator_workspaces(id,payload) values($1,$2)', ['main', {jobs:[{id:ids.job,portalJobId:ids.job,jobNumber:'26999',project:'Synthetic board job',acceptedRevenue:123456,budget:7890},{id:ids.otherJob,portalJobId:ids.otherJob,jobNumber:'26998',project:'Other isolated job'}],secretCosts:'NEVER_EXPOSE_THIS'}]);
  await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/job-board-setup.sql'),'utf8'));
  await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/job-board-sources.sql'),'utf8'));
  const aclSnapshot = async () => (await db.query(`select jsonb_build_object(
    'storage_policies',(select jsonb_agg(to_jsonb(p) order by policyname) from pg_policies p where schemaname='storage' and tablename='objects'),
    'public_rpc_acl',(select jsonb_agg(jsonb_build_object('name',p.proname,'acl',p.proacl) order by p.proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like '%job_board%'),
    'raw_table_acl',(select jsonb_agg(jsonb_build_object('name',c.relname,'acl',c.relacl,'rls',c.relrowsecurity) order by c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and (c.relname like 'job_board%' or c.relname='policies'))
  ) snapshot`)).rows[0].snapshot;
  policyAclBefore = await aclSnapshot();
  await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/job-board-policy.sql'),'utf8'));
  policyAclAfter = await aclSnapshot();
  return db;
}

(async () => {
  const db = await createDatabase();
  let passed = 0;
  const failures = [];
  const as = async (role, name) => {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [name ? ids[name] : '']);
    await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({sub:name?ids[name]:undefined, role, user_metadata:{role:'admin',account_status:'approved'}})]);
    await db.exec(`set role ${role}`);
  };
  const rpc = async (sql, values=[]) => (await db.query(sql, values)).rows[0]?.result;
  const rejects = async (sql, values=[], pattern=/permission denied|access|denied|not allowed|invalid|expired|not found|disabled|staff|admin|restrict|unavailable|sign-in/i) => assert.rejects(() => db.query(sql, values), pattern);
  const check = async (label, run) => {
    try { await run(); passed++; console.log(`PASS ${passed}: ${label}`); }
    catch(error) { failures.push({label,error}); console.error(`FAIL: ${label}\n${error.stack || error.message}`); }
  };
  const getBoard = (board,visit=null) => rpc('select public.get_job_board($1,$2) result',[board.token,visit]);
  const register = async (board,email='visitor@example.invalid') => (await rpc('select public.register_job_board_visit($1,$2,$3,$4) result',[board.token,'Synthetic Visitor','Synthetic Company',email])).visit_token;
  const begin = (board,category='jsa',title='Synthetic JSA') => rpc('select public.begin_job_board_upload($1,$2,$3,$4,$5,$6,$7,$8) result',[board.id,category,title,'2026-10-05','Synthetic.pdf','application/pdf',1234,'Synthetic notes']);
  const insertObject = (upload,metadata={size:1234,mimetype:'application/pdf'}) => db.query('insert into storage.objects(bucket_id,name,owner,metadata) values($1,$2,$3,$4)', ['job-board-files',upload.object_path,ids.staff,metadata]);
  const download = (board,visit,document) => rpc('select public.resolve_job_board_download($1,$2,$3) result',[board.token,visit,document.id]);
  try {
    // Migration and every role exercise run in this transient in-memory database.
    await as('authenticated','admin');
    const board=await rpc('select public.get_or_create_job_board($1) result',[ids.job]);
    const otherBoard=await rpc('select public.get_or_create_job_board($1) result',[ids.otherJob]);
    await check('approved admin links exact existing Portal job without exposing costs',async()=>{
      assert.equal(board.portal_job_id,ids.job); assert.equal(board.job_number,'26999'); assert.equal(board.can_manage,true);
      assert.equal((await rpc('select public.get_or_create_job_board($1) result',[ids.job])).id,board.id,'idempotent board creation');
      assert(!/acceptedRevenue|budget|secretCosts|NEVER_EXPOSE|123456/.test(JSON.stringify(board)),'only public job identity may be returned');
      await rejects('select public.get_or_create_job_board($1)',['invented-job'],/not found/i);
      await db.query("update public.estimator_workspaces set payload=jsonb_set(payload,'{jobs,0,jobNumber}','\"26998\"') where id='main'");
      await rejects('select public.get_or_create_job_board($1)',[ids.job],/does not match/i);
      await db.query("update public.estimator_workspaces set payload=jsonb_set(payload,'{jobs,0,jobNumber}','\"26999\"') where id='main'");
    });
    await check('anonymous callers cannot create boards, read raw metadata or private audit helpers',async()=>{
      await as('anon');
      await rejects('select public.get_or_create_job_board($1)',[ids.job]);
      for(const table of ['job_boards','job_board_documents','job_board_viewers','job_board_visitor_sessions','job_board_activity']) await rejects(`select * from public.${table}`,[]);
      await rejects('select private.jgc_job_board_append($1,$2,null,$3)',[board.id,'visit',{}]);
      await rejects('select public.get_job_board_activity($1)',[board.id]);
    });
    await check('only approved admin can manage; spoofed user_metadata cannot elevate staff or clients',async()=>{
      for(const name of ['staff','client','limited','disabled','deleted']) {
        await as('authenticated',name);
        assert.equal((await getBoard(board)).can_register_as_staff,name==='staff','staff auto-registration is a server capability');
        await rejects('select public.get_or_create_job_board($1)',[ids.job]);
        await rejects('select public.configure_job_board($1,true,false)',[board.id]);
        await rejects('select public.grant_job_board_viewer($1,$2)',[board.id,'staff@example.invalid']);
      }
    });
    await as('authenticated','staff');
    const publicDoc=await begin(board);
    await check('staff uploads reserve exact original path and remain unreadable until finalized',async()=>{
      assert.equal(publicDoc.object_path,`${board.id}/${publicDoc.id}/original.pdf`);
      await rejects('select public.finalize_job_board_upload($1)',[publicDoc.id],/incomplete|metadata/i);
      await rejects('insert into storage.objects(bucket_id,name,owner,metadata) values($1,$2,$3,$4)',['job-board-files',`${otherBoard.id}/${publicDoc.id}/original.pdf`,ids.staff,{size:1234,mimetype:'application/pdf'}],/row.level security/i);
      await insertObject(publicDoc,{size:999,mimetype:'application/pdf'});
      await rejects('select public.finalize_job_board_upload($1)',[publicDoc.id],/metadata/i);
      await db.exec('reset role');
      await db.query("update storage.objects set metadata=$1 where name=$2",[{size:1234,mimetype:'image/png'},publicDoc.object_path]);
      await as('authenticated','staff');
      await rejects('select public.finalize_job_board_upload($1)',[publicDoc.id],/metadata/i);
      await db.exec('reset role');
      await db.query("update storage.objects set metadata=$1 where name=$2",[{size:1234,mimetype:'application/pdf'},publicDoc.object_path]);
      await as('authenticated','staff');
      assert.equal((await rpc('select public.finalize_job_board_upload($1) result',[publicDoc.id])).status,'pending');
      assert.equal((await rpc('select public.finalize_job_board_upload($1) result',[publicDoc.id])).status,'pending','retry idempotent');
    });
    const restrictedDoc=await begin(board,'accident-incident','Synthetic accident');
    await insertObject(restrictedDoc);
    await rpc('select public.finalize_job_board_upload($1) result',[restrictedDoc.id]);
    const ownPending=await begin(board,'daily-report','Synthetic draft daily report');
    await insertObject(ownPending);
    await rpc('select public.finalize_job_board_upload($1) result',[ownPending.id]);
    await check('invalid upload MIME, category and size fail before creating a document',async()=>{
      const base=[board.id,'jsa','Title','2026-10-05','File.pdf','application/pdf',1234,''];
      for(const [index,value] of [[1,'invented'],[5,'text/html'],[6,0],[6,20971521],[2,''],[3,null]]) {
        const args=[...base]; args[index]=value;
        await rejects('select public.begin_job_board_upload($1,$2,$3,$4,$5,$6,$7,$8)',args,/category|title|date|PDF|file/i);
      }
    });
    const staffVisit=await register(board,'ignored-staff@example.invalid');
    await check('staff sees own pending documents after visit; another staff member cannot see or finalize them',async()=>{
      const own=await getBoard(board,staffVisit); assert(own.documents.some(d=>d.id===ownPending.id)); assert.equal(own.can_upload,true);
      await as('authenticated','otherStaff');
      const otherVisit=await register(board,'ignored-other@example.invalid');
      assert(!(await getBoard(board,otherVisit)).documents.some(d=>d.id===ownPending.id));
      await rejects('select public.finalize_job_board_upload($1)',[ownPending.id]);
      await rejects('select public.resolve_job_board_download($1,$2,$3)',[board.token,otherVisit,ownPending.id]);
      const stolen=await getBoard(board,staffVisit); assert.equal(stolen.requires_visitor_signin,true); assert.equal(stolen.documents.length,0);
      await as('authenticated','staff');
      await rejects('select public.review_job_board_document($1,$2,$3)',[ownPending.id,'published','public']);
      await rejects('select public.update_job_board_document($1,$2,$3,$4,$5)',[ownPending.id,'New title','2026-10-05','other','']);
    });
    await as('authenticated','admin');
    await rpc('select public.review_job_board_document($1,$2,$3) result',[publicDoc.id,'published','public']);
    const restricted=await rpc('select public.review_job_board_document($1,$2,$3) result',[restrictedDoc.id,'published','public']);
    await check('accident upload remains restricted when review asks to publish publicly',async()=>assert.equal(restricted.visibility,'restricted'));
    await check('accident classification cannot be removed through category-edit then public-review loophole',async()=>{
      await rpc('select public.update_job_board_document($1,$2,$3,$4,$5) result',[restrictedDoc.id,'Synthetic accident recategorized','2026-10-05','other','']);
      const edited=await rpc('select public.review_job_board_document($1,$2,$3) result',[restrictedDoc.id,'published','public']);
      assert.equal(edited.visibility,'restricted');
    });
    // Restore sensitive classification even if the preceding regression exposed a vulnerability.
    await as('authenticated','admin');
    await rpc('select public.update_job_board_document($1,$2,$3,$4,$5) result',[restrictedDoc.id,'Synthetic accident','2026-10-05','accident-incident','']);
    await rpc('select public.review_job_board_document($1,$2,$3) result',[restrictedDoc.id,'published','restricted']);
    await as('anon');
    const visitor=await register(board);
    const otherVisitor=await register(otherBoard,'other-visitor@example.invalid');
    await check('visitor identity gate exposes public published metadata only and isolates other boards',async()=>{
      const gated=await getBoard(board); assert.equal(gated.requires_visitor_signin,true); assert.equal(gated.documents.length,0); assert.equal(gated.can_upload,false); assert.equal(gated.can_register_as_staff,false);
      const visible=await getBoard(board,visitor); assert.equal(visible.requires_visitor_signin,false); assert.deepEqual(visible.documents.map(d=>d.id),[publicDoc.id]); assert.equal(visible.viewers.length,0); assert.equal(visible.can_read_restricted,false);
      assert.equal((await getBoard(board,otherVisitor)).documents.length,0);
      await rejects('select public.resolve_job_board_download($1,$2,$3)',[board.token,null,publicDoc.id]);
      await rejects('select public.resolve_job_board_download($1,$2,$3)',[board.token,otherVisitor,publicDoc.id]);
      await rejects('select public.resolve_job_board_download($1,$2,$3)',[otherBoard.token,otherVisitor,publicDoc.id]);
      await rejects('select public.resolve_job_board_download($1,$2,$3)',[board.token,visitor,restrictedDoc.id]);
      await rejects('select public.resolve_job_board_download($1,$2,$3)',[board.token,visitor,ownPending.id]);
      await rejects('select public.get_job_board($1,$2)',['guessed-token',visitor]);
      assert.equal((await download(board,visitor,publicDoc)).object_path,publicDoc.object_path);
      assert(!JSON.stringify(visible).includes('original.pdf'),'listing does not leak raw object paths');
    });
    await check('public visitor cannot upload, read Storage, or spoof privileged audit actions',async()=>{
      await rejects('select public.begin_job_board_upload($1,$2,$3,$4,$5,$6,$7,$8)',[board.id,'jsa','Title','2026-10-05','File.pdf','application/pdf',1234,'']);
      assert.equal((await db.query("select * from storage.objects where bucket_id='job-board-files'")).rows.length,0);
      await rejects('select public.log_job_board_activity($1,$2,$3,$4)',[board.token,visitor,'publish',publicDoc.id],/Unsupported/i);
      await rejects('select public.log_job_board_activity($1,$2,$3,$4)',[board.token,visitor,'view-document',restrictedDoc.id]);
    });
    await as('authenticated','client');
    const clientVisit=await register(board,'spoofed-account@example.invalid');
    await check('signed-in client cannot grant itself access or edit profile approval/role',async()=>{
      assert.equal((await getBoard(board)).can_register_as_staff,false,'nonstaff must use the visitor identity gate');
      assert.equal((await getBoard(board,visitor)).requires_visitor_signin,true,'anonymous visit cannot be reused by an authenticated account');
      await rejects('select public.resolve_job_board_download($1,$2,$3)',[board.token,visitor,publicDoc.id]);
      assert.equal((await getBoard(board,clientVisit)).can_read_restricted,false);
      await rejects('select public.resolve_job_board_download($1,$2,$3)',[board.token,clientVisit,restrictedDoc.id]);
      await rejects("update public.profiles set role='admin',account_status='approved' where id=$1",[ids.client]);
      await rejects('insert into public.job_board_viewers(board_id,profile_id,created_by) values($1,$2,$2)',[board.id,ids.client]);
      await rejects('select public.grant_job_board_viewer($1,$2)',[board.id,'client@example.invalid']);
    });
    await as('authenticated','admin');
    await check('client audit identity uses the verified profile and rejects anonymous-session misattribution',async()=>{
      const history=await rpc('select public.get_job_board_activity($1,null,100) result',[board.id]);
      const clientEntry=history.events.find(e=>e.action==='visit'&&e.identity_type==='client');
      assert(clientEntry); assert.equal(clientEntry.actor_email,'client@example.invalid'); assert.equal(clientEntry.actor_name,'Synthetic client');
      assert(!history.events.some(e=>e.actor_email==='spoofed-account@example.invalid'));
    });
    const grant=await rpc('select public.grant_job_board_viewer($1,$2) result',[board.id,'client@example.invalid']);
    await check('explicit client grant allows restricted published download and never uploads or pending reports',async()=>{
      await as('authenticated','client');
      const visible=await getBoard(board,clientVisit); assert.equal(visible.can_read_restricted,true); assert.equal(visible.can_upload,false); assert.equal(visible.can_manage,false);
      assert(visible.documents.some(d=>d.id===restrictedDoc.id)); assert(!visible.documents.some(d=>d.id===ownPending.id));
      await rejects('select public.resolve_job_board_download($1,$2,$3)',[board.token,visitor,restrictedDoc.id]);
      assert.equal((await download(board,clientVisit,restrictedDoc)).id,restrictedDoc.id);
      await rejects('select public.begin_job_board_upload($1,$2,$3,$4,$5,$6,$7,$8)',[board.id,'jsa','Title','2026-10-05','File.pdf','application/pdf',1234,'']);
      assert.equal((await db.query("select * from storage.objects where bucket_id='job-board-files'")).rows.length,0,'clients use authorization-gated signed downloads');
      await as('authenticated','admin');
      await rpc('select public.revoke_job_board_viewer($1,$2) result',[board.id,grant.id]);
      await as('authenticated','client');
      await rejects('select public.resolve_job_board_download($1,$2,$3)',[board.token,clientVisit,restrictedDoc.id]);
      assert.equal((await getBoard(board,clientVisit)).can_read_restricted,false);
    });
    await check('saved form attachments require the exact job, own submission and allowlisted source; delayed offline uploads remain valid',async()=>{
      await db.exec('reset role');
      const sourceIds=Array.from({length:6},(_,i)=>`00000000-0000-4000-8000-${String(20+i).padStart(12,'0')}`);
      for(const [index,owner,project,age] of [[0,'staff','26999','0 minutes'],[1,'otherStaff','26999','0 minutes'],[2,'staff','26999','3 days'],[3,'staff','26998','0 minutes']]) await db.query("insert into public.inspection_records(id,worker_name,inspection_type,inspection_date,title,form_data,created_at) values($1,$2,'JSA','2026-10-05','Synthetic form JSA',$3,now()-$4::interval)",[sourceIds[index],owner,{job_context:{project},qr_token:'SECRET_QR_TOKEN',fields:[{label:'Control',value:'Synthetic control'}],nested:{access_token:'SECRET_ACCESS_TOKEN',keep:'Keeps report data'}},age]);
      await db.query("insert into public.incident_reports(id,reported_by_worker,report_date,project,incident_type,report_details) values($1,'staff','2026-10-05','26999','Synthetic incident',$2)",[sourceIds[4],{job_board_id:board.id,notes:'Private synthetic incident'}]);
      await db.query("insert into public.policies(id,title,description,file_path,file_name,file_type,is_active) values($1,'Synthetic policy','Synthetic company policy','synthetic/policy.pdf','Policy.pdf','application/pdf',true)",[sourceIds[5]]);
      await as('authenticated','staff');
      await rejects('select public.attach_job_board_report($1,$2,$3,$4)',[board.token,null,'inspection_records',sourceIds[0]]);
      await rejects('select public.attach_job_board_report($1,$2,$3,$4)',[board.token,staffVisit,'profiles',ids.admin],/Unsupported/i);
      await rejects('select public.attach_job_board_report($1,$2,$3,$4)',[board.token,staffVisit,'inspection_records',sourceIds[1]],/your submitted/i);
      const delayed=await rpc('select public.attach_job_board_report_by_id($1,$2,$3) result',[board.id,'inspection_records',sourceIds[2]]); assert.equal(delayed.status,'pending','poor-service queue can attach owned reports submitted days earlier');
      assert.equal((await rpc('select public.attach_job_board_report_by_id($1,$2,$3) result',[board.id,'inspection_records',sourceIds[2]])).id,delayed.id);
      await rejects('select public.attach_job_board_report($1,$2,$3,$4)',[board.token,staffVisit,'inspection_records',sourceIds[3]],/does not belong/i);
      await rejects('select public.attach_job_board_report($1,$2,$3,$4)',[board.token,staffVisit,'policies',sourceIds[5]],/Administrator/i);
      const attached=await rpc('select public.attach_job_board_report($1,$2,$3,$4) result',[board.token,staffVisit,'inspection_records',sourceIds[0]]);
      assert.equal(attached.status,'pending');
      const retry=await rpc('select public.attach_job_board_report($1,$2,$3,$4) result',[board.token,staffVisit,'inspection_records',sourceIds[0]]); assert.equal(retry.id,attached.id); assert.equal(retry.already_attached,true);
      const offlineRetry=await rpc('select public.attach_job_board_report_by_id($1,$2,$3) result',[board.id,'inspection_records',sourceIds[0]]); assert.equal(offlineRetry.id,attached.id,'offline synchronization reuses the same attachment without a visit token');
      await rejects('select public.attach_job_board_report_by_id($1,$2,$3)',[board.id,'inspection_records',sourceIds[1]],/your submitted/i);
      await rejects('select public.attach_job_board_report_by_id($1,$2,$3)',[otherBoard.id,'inspection_records',sourceIds[0]],/does not belong/i);
      await rejects('select private.jgc_attach_job_board_report_core($1,$2,$3,$4)',[board.id,'inspection_records',sourceIds[1],{identity_type:'staff',profile_id:ids.admin}],/permission denied/i);
      const snapshot=await download(board,staffVisit,attached); assert.equal(snapshot.source_payload.form_data.nested.keep,'Keeps report data'); assert(!/SECRET_QR_TOKEN|SECRET_ACCESS_TOKEN|qr_token|access_token/.test(JSON.stringify(snapshot)));
      await db.exec('reset role');
      await db.query("update public.inspection_records set title='Changed original form' where id=$1",[sourceIds[0]]);
      await as('authenticated','staff'); assert.equal((await download(board,staffVisit,attached)).source_payload.title,'Synthetic form JSA','immutable attachment snapshot');
      const incident=await rpc('select public.attach_job_board_report($1,$2,$3,$4) result',[board.token,staffVisit,'incident_reports',sourceIds[4]]);
      await as('authenticated','admin');
      await rpc('select public.update_job_board_document($1,$2,$3,$4,$5) result',[incident.id,'Synthetic source incident','2026-10-05','other','']);
      assert.equal((await rpc('select public.review_job_board_document($1,$2,$3) result',[incident.id,'published','public'])).visibility,'restricted');
      const policy=await rpc('select public.attach_job_board_report($1,$2,$3,$4) result',[board.token,null,'policies',sourceIds[5]]); assert.equal(policy.status,'pending');
      await rpc('select public.review_job_board_document($1,$2,$3) result',[attached.id,'archived','restricted']);
      await as('authenticated','staff');
      const archivedRetry=await rpc('select public.attach_job_board_report_by_id($1,$2,$3) result',[board.id,'inspection_records',sourceIds[0]]); assert.equal(archivedRetry.id,attached.id); assert.equal(archivedRetry.status,'archived','retry does not recreate an archived attachment');
      await db.exec('reset role'); await db.query("update public.inspection_records set created_at=now()-interval '2 hours' where id=$1",[sourceIds[0]]);
      await as('authenticated','staff');
      assert.equal((await rpc('select public.attach_job_board_report_by_id($1,$2,$3) result',[board.id,'inspection_records',sourceIds[0]])).id,attached.id,'late uncertain-response retry preserves an already attached report');
      await as('authenticated','client'); await rejects('select public.attach_job_board_report($1,$2,$3,$4)',[board.token,clientVisit,'inspection_records',sourceIds[0]]);
      await rejects('select public.attach_job_board_report_by_id($1,$2,$3)',[board.id,'inspection_records',sourceIds[0]]);
      await as('anon'); await rejects('select public.attach_job_board_report($1,$2,$3,$4)',[board.token,visitor,'inspection_records',sourceIds[0]]);
      await rejects('select public.attach_job_board_report_by_id($1,$2,$3)',[board.id,'inspection_records',sourceIds[0]]);
    });
    await check('disabled, limited and missing-profile accounts cannot upload; disabled accounts cannot register',async()=>{
      for(const name of ['disabled','limited','deleted']) {
        await as('authenticated',name);
        await rejects('select public.begin_job_board_upload($1,$2,$3,$4,$5,$6,$7,$8)',[board.id,'jsa','Title','2026-10-05','File.pdf','application/pdf',1234,'']);
        if(name!=='limited') await rejects('select public.register_job_board_visit($1,$2,$3,$4)',[board.token,'Disabled','Company','disabled@example.invalid']);
      }
    });
    await check('existing-source picker is admin-only, isolates job numbers, excludes duplicates and already attached records',async()=>{
      await db.exec('reset role');
      const sourceIds=Array.from({length:8},(_,i)=>`00000000-0000-4000-8000-${String(40+i).padStart(12,'0')}`);
      for(const [index,project,duplicate] of [[0,'26999 - Old job title',false],[1,'26999',true],[2,'269990 - Wrong job',false],[3,'Different unrelated site',false]]) await db.query("insert into public.toolbox_talk_reports(id,submitted_by_worker,talk_title,report_date,project,is_duplicate) values($1,'otherStaff','Synthetic toolbox','2026-10-05',$2,$3)",[sourceIds[index],project,duplicate]);
      await db.query("insert into public.daily_site_reports(id,worker_name,report_date,project) values($1,'staff','2026-10-05','26999: Synthetic job')",[sourceIds[4]]);
      await db.query("insert into public.accident_reports(id,created_by_worker,accident_date,site_location) values($1,'staff','2026-10-05','26999 – Original job title')",[sourceIds[5]]);
      await db.query("insert into public.employee_injury_reports(id,created_by_worker,accident_date,accident_location) values($1,'staff','2026-10-05','Wrong location')",[sourceIds[6]]);
      await db.query("insert into public.policies(id,title,file_path,is_active) values($1,'Inactive policy','inactive.pdf',false)",[sourceIds[7]]);
      const inspectionCases=[];
      for(const [offset,label] of ['Project / Job','Project','Job','Project / Site','Location of Use','Site Location','Location / Building / Floor'].entries()) {
        const id=`00000000-0000-4000-8000-${String(60+offset).padStart(12,'0')}`;
        inspectionCases.push(id);
        await db.query("insert into public.inspection_records(id,worker_name,inspection_type,inspection_date,title,form_data) values($1,'staff','JSA','2026-10-05','Legacy fields-only JSA',$2)",[id,{fields:[{label,value:'26999 - Legacy project name'}]}]);
      }
      const mismatchCases=[];
      for(const [offset,formData] of [
        {fields:[{label:'Project / Job',value:'269990 - Different job'}]},
        {job_context:{job_board_id:otherBoard.id,project:'26999 - Same text but wrong explicit board'}},
        {job_context:{jobNumber:'26998',project:'26999 - Same text but wrong explicit number'}},
        {fields:{label:'Project / Job',value:'26999 - Malformed fields'}},
      ].entries()) {
        const id=`00000000-0000-4000-8000-${String(70+offset).padStart(12,'0')}`;
        mismatchCases.push(id);
        await db.query("insert into public.inspection_records(id,worker_name,inspection_type,inspection_date,title,form_data) values($1,'staff','JSA','2026-10-05','Mismatched inspection',$2)",[id,formData]);
      }
      for(const name of [null,'staff','client','disabled','limited','deleted']) {
        await as(name?'authenticated':'anon',name);
        await rejects('select public.list_job_board_sources($1)',[board.id]);
        await rejects('select private.jgc_job_board_project_matches($1,$2)',['26999','26999'],/permission denied/i);
      }
      await as('authenticated','admin');
      const sources=await rpc('select public.list_job_board_sources($1) result',[board.id]);
      const included=new Set(sources.map(s=>s.source_id));
      for(const index of [0,4,5]) assert(included.has(sourceIds[index]),'the same exact job number supports historical names/delimiters');
      for(const index of [1,2,3,6,7]) assert(!included.has(sourceIds[index]));
      assert(!included.has('00000000-0000-4000-8000-000000000020'),'archived existing attachment is not offered again');
      for(const id of inspectionCases) assert(included.has(id),'fields-only historical inspections can be identified by their semantic job label');
      for(const id of mismatchCases) assert(!included.has(id),'explicit wrong identity and longer job numbers cannot be selected');
      assert(!JSON.stringify(sources).includes('SECRET_QR_TOKEN'));
      assert(sources.every(s=>Object.keys(s).sort().join(',')==='category,match,report_date,source_id,source_type,title'),'source picker returns compact metadata only');
      for(const id of mismatchCases) await rejects('select public.attach_job_board_report_by_id($1,$2,$3)',[board.id,'inspection_records',id],/does not belong/i);
      for(const id of inspectionCases) assert.equal((await rpc('select public.attach_job_board_report_by_id($1,$2,$3) result',[board.id,'inspection_records',id])).status,'pending','candidate and attachment share identical job matching');
      for(const [table,index] of [['toolbox_talk_reports',0],['daily_site_reports',4],['accident_reports',5]]) assert.equal((await rpc('select public.attach_job_board_report_by_id($1,$2,$3) result',[board.id,table,sourceIds[index]])).status,'pending','legacy number/name candidate can be attached');
      const after=await rpc('select public.list_job_board_sources($1) result',[board.id]);
      assert(inspectionCases.every(id=>!after.some(s=>s.source_id===id)),'attached candidates disappear from the picker');
      await rejects('select public.list_job_board_sources($1)',['00000000-0000-4000-8000-000000000999']);
    });
    await check('disabling a previously approved staff profile immediately invalidates access through an old visit',async()=>{
      await db.exec('reset role'); await db.query("update public.profiles set account_status='disabled' where id=$1",[ids.staff]);
      await as('authenticated','staff');
      await rejects('select public.resolve_job_board_download($1,$2,$3)',[board.token,staffVisit,publicDoc.id]);
    });
    await db.exec('reset role'); await db.query("update public.profiles set account_status='approved' where id=$1",[ids.staff]);
    await check('expired visitor session no longer authorizes a document or marks visitor signed in',async()=>{
      await db.exec('reset role'); await db.query("update public.job_board_visitor_sessions set expires_at=now()-interval '1 second' where token_hash=private.jgc_job_board_token_hash($1)",[visitor]);
      await as('anon'); assert.equal((await getBoard(board,visitor)).requires_visitor_signin,true);
      await rejects('select public.resolve_job_board_download($1,$2,$3)',[board.token,visitor,publicDoc.id]);
    });
    await as('anon');
    const auditVisitor=await register(board,'audit@example.invalid');
    await check('board reopening logs scoped canonical identity and server time, deduplicates retries, and denies invalid visits',async()=>{
      const baseline=Date.now();
      await as('anon');
      assert.equal((await rpc('select public.log_job_board_activity($1,$2,$3,$4) result',[board.token,auditVisitor,'open-board',null])).ok,true);
      await rpc('select public.log_job_board_activity($1,$2,$3,$4) result',[board.token,auditVisitor,'open-board',null]);
      for(const [boardToken,visitToken] of [['guessed-token',auditVisitor],[board.token,'00000000-0000-4000-8000-000000000999'],[otherBoard.token,auditVisitor],[board.token,otherVisitor],[board.token,visitor],[board.token,null]]) await rejects('select public.log_job_board_activity($1,$2,$3,$4)',[boardToken,visitToken,'open-board',null]);
      await as('authenticated','client');
      await rejects('select public.log_job_board_activity($1,$2,$3,$4)',[board.token,auditVisitor,'open-board',null],/sign-in|access/i);
      await rpc('select public.log_job_board_activity($1,$2,$3,$4) result',[board.token,clientVisit,'open-board',null]);
      await as('authenticated','admin');
      const events=(await rpc('select public.get_job_board_activity($1,null,100) result',[board.id])).events;
      const opened=events.filter(e=>e.action==='open-board'&&e.actor_email==='audit@example.invalid'); assert.equal(opened.length,1,'immediate retry does not create a second scan/open event');
      assert.equal(opened[0].identity_type,'visitor'); assert.equal(opened[0].actor_name,'Synthetic Visitor'); assert.equal(opened[0].actor_company,'Synthetic Company'); assert.equal(opened[0].document_id,null); assert.equal(opened[0].document_title,'');
      assert(Math.abs(Date.parse(opened[0].created_at)-baseline)<30000,'timestamp comes from the server clock');
      const clientOpen=events.find(e=>e.action==='open-board'&&e.identity_type==='client'); assert(clientOpen); assert.equal(clientOpen.actor_email,'client@example.invalid'); assert.equal(clientOpen.actor_name,'Synthetic client');
      const otherEvents=(await rpc('select public.get_job_board_activity($1,null,100) result',[otherBoard.id])).events; assert(!otherEvents.some(e=>e.action==='open-board'),'cross-board failures leave no false audit event');
      await as('anon');
    });
    await rpc('select public.log_job_board_activity($1,$2,$3,$4) result',[board.token,auditVisitor,'view-document',publicDoc.id]);
    await rpc('select public.log_job_board_activity($1,$2,$3,$4) result',[board.token,auditVisitor,'view-document',publicDoc.id]);
    await rpc('select public.log_job_board_activity($1,$2,$3,$4) result',[board.token,auditVisitor,'email-link',publicDoc.id]);
    await check('audit captures identity and time, bounds duplicate events, paginates without loss, and is append-only',async()=>{
      await as('authenticated','admin');
      const history=await rpc('select public.get_job_board_activity($1,null,100) result',[board.id]);
      const views=history.events.filter(e=>e.actor_email==='audit@example.invalid'&&e.action==='view-document'); assert.equal(views.length,1);
      const email=history.events.find(e=>e.actor_email==='audit@example.invalid'&&e.action==='email-link'); assert(email); assert.equal(email.actor_name,'Synthetic Visitor'); assert(email.created_at); assert.equal(email.document_title,'Synthetic JSA');
      const all=[]; let before=null; let lastCursor;
      for(let i=0;i<100;i++) { const page=await rpc('select public.get_job_board_activity($1,$2,2) result',[board.id,before]); all.push(...page.events); lastCursor=page.next_before; if(!page.events.length || page.next_before===null) break; before=page.next_before; }
      assert.equal(all.length,history.events.length); assert.equal(new Set(all.map(e=>e.id)).size,all.length);
      assert.equal(lastCursor,null,'final page has no Load more cursor'); assert.equal(history.next_before,null,'one complete page has no older cursor');
      await rejects('select * from public.job_board_activity',[]);
      await rejects("insert into public.job_board_activity(board_id,actor_name,actor_company,actor_email,identity_type,action,created_at) values($1,'fake','fake','fake','system','publish',now())",[board.id]);
      await db.exec('reset role');
      await rejects("update public.job_board_activity set actor_name='changed' where board_id=$1",[board.id],/append.only/i);
      await rejects('delete from public.job_board_activity where board_id=$1',[board.id],/append.only/i);
      await as('authenticated','staff'); await rejects('select public.get_job_board_activity($1)',[board.id]);
    });
    await check('legacy broad Storage policies cannot leak, replace, delete or upload Job Board originals',async()=>{
      await db.exec(`reset role;
        create policy legacy_broad_read on storage.objects for select to anon,authenticated using(true);
        create policy legacy_broad_insert on storage.objects for insert to anon,authenticated with check(true);
        create policy legacy_broad_update on storage.objects for update to anon,authenticated using(true) with check(true);
        create policy legacy_broad_delete on storage.objects for delete to anon,authenticated using(true);
        insert into storage.buckets(id,name,public) values('legacy-unrelated','legacy-unrelated',true);
        insert into storage.objects(bucket_id,name,metadata) values('legacy-unrelated','example.pdf','{}');
      `);
      const original=(await db.query('select id,metadata from storage.objects where name=$1',[ownPending.object_path])).rows[0];
      for(const name of [null,'client','otherStaff','staff']) {
        await as(name?'authenticated':'anon',name);
        const originals=(await db.query("select name from storage.objects where bucket_id='job-board-files'")).rows;
        if(name==='staff') assert(originals.some(o=>o.name===ownPending.object_path)); else assert.equal(originals.length,0);
        assert.equal((await db.query("select * from storage.objects where bucket_id='legacy-unrelated'")).rows.length,1,'isolated rules preserve other buckets');
        await rejects('insert into storage.objects(bucket_id,name,owner,metadata) values($1,$2,$3,$4)',['job-board-files',`${board.id}/00000000-0000-4000-8000-000000000999/original.pdf`,name?ids[name]:null,{size:1234,mimetype:'application/pdf'}],/row.level security/i);
        assert.equal((await db.query("update storage.objects set metadata=$1 where name=$2 returning id",[{size:1,mimetype:'text/html'},ownPending.object_path])).rows.length,0);
        assert.equal((await db.query('delete from storage.objects where name=$1 returning id',[ownPending.object_path])).rows.length,0);
      }
      await db.exec('reset role');
      const preserved=(await db.query('select id,metadata from storage.objects where name=$1',[ownPending.object_path])).rows[0]; assert.deepEqual(preserved,original);
    });
    await check('rotation invalidates old QR tokens and visitor sessions; disabling hides the board',async()=>{
      await as('authenticated','admin');
      const rotated=await rpc('select public.configure_job_board($1,true,true) result',[board.id]); assert.notEqual(rotated.token,board.token);
      await as('anon'); await rejects('select public.get_job_board($1,$2)',[board.token,auditVisitor]);
      await rejects('select public.log_job_board_activity($1,$2,$3,$4)',[board.token,auditVisitor,'open-board',null]);
      assert.equal((await getBoard(rotated,auditVisitor)).requires_visitor_signin,true);
      await rejects('select public.log_job_board_activity($1,$2,$3,$4)',[rotated.token,auditVisitor,'open-board',null]);
      await rejects('select public.resolve_job_board_download($1,$2,$3)',[rotated.token,auditVisitor,publicDoc.id]);
      const newVisit=await register(rotated,'new@example.invalid'); assert.equal((await download(rotated,newVisit,publicDoc)).id,publicDoc.id);
      await as('authenticated','admin'); await rpc('select public.configure_job_board($1,false,false) result',[board.id]);
      await as('anon'); await rejects('select public.get_job_board($1,$2)',[rotated.token,newVisit]);
      await rejects('select public.log_job_board_activity($1,$2,$3,$4)',[rotated.token,newVisit,'open-board',null]);
      await rejects('select public.register_job_board_visit($1,$2,$3,$4)',[rotated.token,'Visitor','Company','visit@example.invalid']);
      await as('authenticated','staff'); await rejects('select public.finalize_job_board_upload($1)',[ownPending.id]);
    });
    // The automatic company policy correction adds no real document rows. All fixture
    // policy/source mutations below happen only in the transient local database.
    await db.exec(`reset role;
      drop policy legacy_broad_read on storage.objects;
      drop policy legacy_broad_insert on storage.objects;
      drop policy legacy_broad_update on storage.objects;
      drop policy legacy_broad_delete on storage.objects;
      insert into storage.buckets(id,name,public) values('policies','policies',false);
    `);
    await as('authenticated','admin');
    let policyBoard=await rpc('select public.configure_job_board($1,true,false) result',[board.id]);
    const policyIds=Object.fromEntries(['older','current','inactive','unrelated','nonPdf','missing','badObjectMime','traversal','otherBucket','leadingSlash','missingMime','replacement'].map((name,index)=>[name,`00000000-0000-4000-8000-${String(100+index).padStart(12,'0')}`]));
    const policyRows=[
      ['older','JGC Safety Policy',true,'application/pdf','company/old.pdf','2026-09-01','policies','application/pdf'],
      ['current',' JGC SAFETY POLICY ',true,'application/pdf','company/current.pdf','2026-10-02','policies','application/pdf'],
      ['inactive','JGC Safety Policy',false,'application/pdf','company/inactive.pdf','2026-10-04','policies','application/pdf'],
      ['unrelated','Disciplinary Policy',true,'application/pdf','company/unrelated.pdf','2026-10-04','policies','application/pdf'],
      ['nonPdf','JGC Safety Policy',true,'image/jpeg','company/non-pdf.jpg','2026-10-04','policies','image/jpeg'],
      ['missing','JGC Safety Policy',true,'application/pdf','company/missing.pdf','2026-10-04',null,null],
      ['badObjectMime','JGC Safety Policy',true,'application/pdf','company/bad-mime.pdf','2026-10-04','policies','image/jpeg'],
      ['traversal','JGC Safety Policy',true,'application/pdf','../unsafe.pdf','2026-10-04','policies','application/pdf'],
      ['otherBucket','JGC Safety Policy',true,'application/pdf','company/other-bucket.pdf','2026-10-04','legacy-unrelated','application/pdf'],
      ['leadingSlash','JGC Safety Policy',true,'application/pdf','/absolute.pdf','2026-10-04','policies','application/pdf'],
      ['missingMime','JGC Safety Policy',true,null,'company/no-type.pdf','2026-10-04','policies','application/pdf']
    ];
    await db.exec('reset role');
    for(const [name,title,active,type,filePath,stamp,bucket,objectMime] of policyRows) {
      await db.query('insert into public.policies(id,title,description,file_path,file_name,file_type,is_active,category,created_at,updated_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)',[policyIds[name],title,'POLICY_DESCRIPTION_SECRET',filePath,name+'.pdf',type,active,'Safety',stamp+'T12:00:00Z']);
      if(bucket) await db.query('insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3)',[bucket,filePath,{size:4321,mimetype:objectMime}]);
    }
    const realDocumentCount=(await db.query('select count(*)::integer count from public.job_board_documents')).rows[0].count;
    await as('anon');
    const policyVisit=await register(policyBoard,'policy-visitor@example.invalid');
    const automatic = model => model.documents.filter(d=>d.automatic===true);
    await check('automatic policy selects only newest exact-title active PDF with a private matching Storage object',async()=>{
      const visible=await getBoard(policyBoard,policyVisit);
      assert.equal(automatic(visible).length,1); assert.equal(automatic(visible)[0].id,policyIds.current);
      assert.equal(automatic(visible)[0].category,'jgc-policy'); assert.equal(automatic(visible)[0].status,'published'); assert.equal(automatic(visible)[0].visibility,'public');
      assert.equal(automatic(visible)[0].source_type,'policies'); assert.equal(automatic(visible)[0].source_id,policyIds.current);
      assert.equal(automatic(visible)[0].file_size,4321); assert.equal(automatic(visible)[0].created_by,null);
      assert(visible.documents.some(d=>d.id===publicDoc.id),'ordinary source_type-null upload stays visible with current policy');
      assert(!/file_path|company\/current|POLICY_DESCRIPTION_SECRET/.test(JSON.stringify(visible)),'public listing omits private paths and source description');
      for(const [name] of policyRows.filter(row=>row[0]!=='current')) await rejects('select public.resolve_job_board_download($1,$2,$3)',[policyBoard.token,policyVisit,policyIds[name]]);
      await as('authenticated','admin'); const management=await getBoard(policyBoard); assert.equal(automatic(management)[0].id,policyIds.current);
      await rejects('select public.review_job_board_document($1,$2,$3)',[policyIds.current,'archived','public'],/Finalize|unavailable/i);
      await as('anon');
    });
    await check('automatic policy preserves visitor, account and exact-board gates and rejects unknown IDs',async()=>{
      await as('anon');
      assert.equal(automatic(await getBoard(policyBoard)).length,0);
      for(const visit of [null,visitor,'00000000-0000-4000-8000-000000000999',otherVisitor]) await rejects('select public.resolve_job_board_download($1,$2,$3)',[policyBoard.token,visit,policyIds.current]);
      await rejects('select public.resolve_job_board_download($1,$2,$3)',[otherBoard.token,policyVisit,policyIds.current]);
      await rejects('select public.resolve_job_board_download($1,$2,$3)',[policyBoard.token,policyVisit,'00000000-0000-4000-8000-000000000999']);
      await as('authenticated','client'); assert.equal(automatic(await getBoard(policyBoard,policyVisit)).length,0);
      await rejects('select public.resolve_job_board_download($1,$2,$3)',[policyBoard.token,policyVisit,policyIds.current]);
      await rejects('select public.log_job_board_activity($1,$2,$3,$4)',[policyBoard.token,policyVisit,'view-document',policyIds.current]);
      for(const name of ['disabled','limited','deleted']) { await as('authenticated',name); assert.equal(automatic(await getBoard(policyBoard)).length,0); await rejects('select public.resolve_job_board_download($1,$2,$3)',[policyBoard.token,null,policyIds.current]); }
      await as('anon');
    });
    await check('expired and revoked policy visits deny download and activity immediately',async()=>{
      const expired=await register(policyBoard,'expired-policy@example.invalid'), revoked=await register(policyBoard,'revoked-policy@example.invalid');
      await db.exec('reset role');
      await db.query("update public.job_board_visitor_sessions set expires_at=now()-interval '1 second' where token_hash=private.jgc_job_board_token_hash($1)",[expired]);
      await db.query('update public.job_board_visitor_sessions set revoked_at=now() where token_hash=private.jgc_job_board_token_hash($1)',[revoked]);
      await as('anon');
      for(const visit of [expired,revoked]) { assert.equal(automatic(await getBoard(policyBoard,visit)).length,0); await rejects('select public.resolve_job_board_download($1,$2,$3)',[policyBoard.token,visit,policyIds.current]); await rejects('select public.log_job_board_activity($1,$2,$3,$4)',[policyBoard.token,visit,'email-link',policyIds.current]); }
      await as('authenticated','staff'); const approvedStaffVisit=await register(policyBoard);
      assert.equal(automatic(await getBoard(policyBoard,approvedStaffVisit)).length,1);
      await db.exec('reset role'); await db.query("update public.profiles set account_status='inactive' where id=$1",[ids.staff]);
      await as('authenticated','staff'); assert.equal(automatic(await getBoard(policyBoard,approvedStaffVisit)).length,0); await rejects('select public.resolve_job_board_download($1,$2,$3)',[policyBoard.token,approvedStaffVisit,policyIds.current]);
      await db.exec('reset role'); await db.query("update public.profiles set account_status='approved' where id=$1",[ids.staff]); await as('anon');
    });
    await check('automatic policy view email and download audit uses canonical identity, deduplicates retries, and avoids document FK errors',async()=>{
      const started=Date.now();
      for(const action of ['view-document','email-link']) { await rpc('select public.log_job_board_activity($1,$2,$3,$4) result',[policyBoard.token,policyVisit,action,policyIds.current]); await rpc('select public.log_job_board_activity($1,$2,$3,$4) result',[policyBoard.token,policyVisit,action,policyIds.current]); }
      const resolved=await download(policyBoard,policyVisit,{id:policyIds.current});
      assert.equal(resolved.id,policyIds.current); assert.equal(resolved.board_id,policyBoard.id); assert.equal(resolved.source_type,'policies'); assert.equal(resolved.source_payload.file_path,'company/current.pdf'); assert.equal(resolved.mime_type,'application/pdf');
      assert.deepEqual(Object.keys(resolved.source_payload).sort(),['file_name','file_path','file_type','id','title']);
      await rejects('select public.log_job_board_activity($1,$2,$3,$4)',[policyBoard.token,policyVisit,'publish',policyIds.current],/Unsupported/i);
      await rejects('select private.jgc_job_board_append($1,$2,$3,$4)',[policyBoard.id,'view-document',policyIds.current,{name:'Spoofed admin',email:'admin@example.invalid',identity_type:'staff',profile_id:ids.admin}]);
      await as('authenticated','client'); const canonicalClientVisit=await register(policyBoard,'spoofed-policy@example.invalid');
      await rpc('select public.log_job_board_activity($1,$2,$3,$4) result',[policyBoard.token,canonicalClientVisit,'view-document',policyIds.current]);
      await as('authenticated','admin'); const events=(await rpc('select public.get_job_board_activity($1,null,100) result',[policyBoard.id])).events;
      for(const action of ['view-document','email-link','download-request']) { const rows=events.filter(e=>e.action===action&&e.actor_email==='policy-visitor@example.invalid'); assert.equal(rows.length,1); assert.equal(rows[0].document_id,null); assert.equal(rows[0].document_title,' JGC SAFETY POLICY '); assert.equal(rows[0].identity_type,'visitor'); assert(Math.abs(Date.parse(rows[0].created_at)-started)<30000); }
      const clientEvent=events.find(e=>e.action==='view-document'&&e.actor_email==='client@example.invalid'&&e.document_title===' JGC SAFETY POLICY '); assert(clientEvent); assert.equal(clientEvent.actor_name,'Synthetic client'); assert.equal(clientEvent.document_id,null);
      assert(!events.some(e=>e.actor_email==='spoofed-policy@example.invalid'));
      await db.exec('reset role'); assert.equal((await db.query('select count(*)::integer count from public.job_board_documents')).rows[0].count,realDocumentCount,'derived policy reads/logs never materialize a board document');
      await as('anon');
    });
    await check('public policy bucket is excluded and restoring privacy restores the automatic policy without materialization',async()=>{
      await db.exec('reset role'); await db.query("update storage.buckets set public=true where id='policies'");
      await as('anon'); assert.equal(automatic(await getBoard(policyBoard,policyVisit)).length,0); await rejects('select public.resolve_job_board_download($1,$2,$3)',[policyBoard.token,policyVisit,policyIds.current]);
      await db.exec('reset role'); await db.query("update storage.buckets set public=false where id='policies'");
      await as('anon'); assert.equal(automatic(await getBoard(policyBoard,policyVisit))[0].id,policyIds.current);
    });
    await check('automatic current policy deduplicates an explicit office import while preserving original upload visibility',async()=>{
      await as('authenticated','admin');
      const imported=await rpc('select public.attach_job_board_report_by_id($1,$2,$3) result',[policyBoard.id,'policies',policyIds.current]);
      assert.equal(imported.status,'pending');
      const management=await getBoard(policyBoard); assert.equal(management.documents.filter(d=>d.source_type==='policies'&&d.source_id===policyIds.current).length,1); assert.equal(automatic(management)[0].id,policyIds.current);
      assert(!management.documents.some(d=>d.id===imported.id)); assert(management.documents.some(d=>d.id===publicDoc.id));
      await as('anon'); assert.equal((await getBoard(policyBoard,policyVisit)).documents.filter(d=>d.source_type==='policies'&&d.source_id===policyIds.current).length,1);
    });
    await check('policy file replacement deactivation and newest active version update immediately on the next authorized request',async()=>{
      await db.exec('reset role');
      await db.query("insert into storage.objects(bucket_id,name,metadata) values('policies','company/revised.pdf',$1)",[{size:5678,mimetype:'application/pdf'}]);
      await db.query("update public.policies set file_path='company/revised.pdf',file_name='Revised.pdf',updated_at='2026-12-01T12:00:00Z' where id=$1",[policyIds.current]);
      await as('anon'); const changed=automatic(await getBoard(policyBoard,policyVisit))[0]; assert.equal(changed.id,policyIds.current); assert.equal(changed.file_name,'Revised.pdf'); assert.equal(changed.file_size,5678); assert.equal(changed.report_date,'2026-12-01');
      assert.equal((await download(policyBoard,policyVisit,{id:policyIds.current})).source_payload.file_path,'company/revised.pdf');
      await db.exec('reset role'); await db.query('update public.policies set is_active=false where id=$1',[policyIds.current]);
      await as('anon'); assert.equal(automatic(await getBoard(policyBoard,policyVisit))[0].id,policyIds.older); await rejects('select public.resolve_job_board_download($1,$2,$3)',[policyBoard.token,policyVisit,policyIds.current]);
      await db.exec('reset role'); await db.query("insert into public.policies(id,title,file_path,file_name,file_type,is_active,category,created_at,updated_at) values($1,'JGC Safety Policy','company/replacement.pdf','Replacement.pdf','application/pdf',true,'Safety','2027-01-01','2027-01-01')",[policyIds.replacement]);
      await db.query("insert into storage.objects(bucket_id,name,metadata) values('policies','company/replacement.pdf',$1)",[{size:6789,mimetype:'application/pdf'}]);
      await as('anon'); assert.equal(automatic(await getBoard(policyBoard,policyVisit))[0].id,policyIds.replacement); await rejects('select public.resolve_job_board_download($1,$2,$3)',[policyBoard.token,policyVisit,policyIds.older]);
      assert.equal((await download(policyBoard,policyVisit,{id:policyIds.replacement})).source_payload.file_path,'company/replacement.pdf');
      await db.exec('reset role'); await db.query("delete from storage.objects where bucket_id='policies' and name='company/replacement.pdf'");
      await as('anon'); assert.equal(automatic(await getBoard(policyBoard,policyVisit))[0].id,policyIds.older); await rejects('select public.resolve_job_board_download($1,$2,$3)',[policyBoard.token,policyVisit,policyIds.replacement]);
    });
    await check('policy correction preserves all existing RPC/raw ACLs and Storage policies and denies direct helper access',async()=>{
      assert.deepEqual(policyAclAfter,policyAclBefore,'correction does not add direct data access or Storage permissions');
      for(const [role,name] of [['anon',null],['authenticated','staff'],['authenticated','client']]) {
        await as(role,name); await rejects('select private.jgc_job_board_current_policy()'); await rejects('select private.jgc_job_board_policy_document($1,null)',[policyBoard.id]);
        assert.equal((await db.query("select * from storage.objects where bucket_id='policies'")).rows.length,0,'private policy files still require authorization-gated signed download');
        await rejects('select * from public.policies');
      }
    });
    await check('automatic policy obeys QR rotation disabled-board and revoked visitor gates',async()=>{
      await as('authenticated','admin'); const rotated=await rpc('select public.configure_job_board($1,true,true) result',[policyBoard.id]);
      await as('anon'); await rejects('select public.resolve_job_board_download($1,$2,$3)',[policyBoard.token,policyVisit,policyIds.older]); assert.equal(automatic(await getBoard(rotated,policyVisit)).length,0); await rejects('select public.resolve_job_board_download($1,$2,$3)',[rotated.token,policyVisit,policyIds.older]);
      const renewed=await register(rotated,'renewed-policy@example.invalid'); assert.equal(automatic(await getBoard(rotated,renewed))[0].id,policyIds.older);
      await as('authenticated','admin'); await rpc('select public.configure_job_board($1,false,false) result',[rotated.id]);
      await as('anon'); await rejects('select public.get_job_board($1,$2)',[rotated.token,renewed]); await rejects('select public.resolve_job_board_download($1,$2,$3)',[rotated.token,renewed,policyIds.older]); await rejects('select public.log_job_board_activity($1,$2,$3,$4)',[rotated.token,renewed,'view-document',policyIds.older]);
    });
    await db.exec('reset role');
    const migration=fs.readdirSync(path.join(__dirname,'../supabase/migrations')).find(n=>n.endsWith('_jgc_job_board_signins_976.sql'));
    await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations',migration),'utf8'));
    await as('authenticated','admin'); const attendanceBoard=await rpc('select public.get_or_create_job_board($1) result',[ids.otherJob]);
    const submission='11111111-1111-4111-8111-111111111111';
    const site=(token=attendanceBoard.token,name='Synthetic Site Visitor',company='Synthetic Contractor',reason='Delivery',id=submission)=>rpc('select public.record_job_board_site_signin($1,$2,$3,$4,$5) result',[token,name,company,reason,id]);
    await check('site sign-in records bounded attendance with server time and idempotent retries without document access',async()=>{
      await as('anon'); const before=Date.now(),first=await site(),again=await site(); assert.deepEqual(first,again); assert(Math.abs(Date.parse(first.recorded_at)-before)<30000);
      assert.equal((await getBoard(attendanceBoard)).requires_visitor_signin,true); await rejects('select * from public.job_board_activity');
      await rejects('select public.get_job_board_activity($1)',[attendanceBoard.id]); await rejects('select private.jgc_job_board_append($1,$2,null,$3)',[attendanceBoard.id,'visit',{name:'spoof'}]);
      await rejects('select public.record_job_board_site_signin($1,$2,$3,$4,$5)',[attendanceBoard.token,'Changed','Synthetic Contractor','Delivery',submission],/retry/i);
      for(const values of [['', 'Company','',submission],['Name','','',submission],['n'.repeat(151),'Company','',submission],['Name','Company','r'.repeat(1001),submission],['Name','Company','',null]]) await rejects('select public.record_job_board_site_signin($1,$2,$3,$4,$5)',[attendanceBoard.token,...values],/name|company|reason/i);
      await site(attendanceBoard.token,'Another Visitor','Company','', '22222222-2222-4222-8222-222222222222');
    });
    await check('sign-in log excludes historical actions and new document telemetry while preserving canonical login records',async()=>{
      await as('anon'); const visit=await register(attendanceBoard,'signin-only@example.invalid');
      await rpc('select public.log_job_board_activity($1,$2,$3,null) result',[attendanceBoard.token,visit,'open-board']);
      await as('authenticated','admin'); const history=await rpc('select public.get_job_board_activity($1,null,100) result',[attendanceBoard.id]);
      assert(history.events.every(e=>['visit','site-signin'].includes(e.action))); assert(history.events.some(e=>e.action==='site-signin'&&e.reason==='Delivery'));
      assert.equal(history.events.filter(e=>e.action==='site-signin'&&e.actor_name==='Synthetic Site Visitor').length,1);
      const all=[];let before=null;do {const page=await rpc('select public.get_job_board_activity($1,$2,1) result',[attendanceBoard.id,before]);all.push(...page.events);before=page.next_before;}while(before);
      assert.equal(new Set(all.map(e=>e.id)).size,history.events.length);
      await db.exec('reset role'); const actions=(await db.query("select action from public.job_board_activity where board_id=$1 and created_at>$2",[attendanceBoard.id,history.events.find(e=>e.action==='site-signin'&&e.reason==='Delivery').created_at])).rows;assert(actions.every(e=>['visit','site-signin'].includes(e.action)));
    });
    await check('attendance rejects disabled and replaced QR links and remains append-only and admin-only',async()=>{
      await as('authenticated','staff');await rejects('select public.get_job_board_activity($1)',[attendanceBoard.id]);
      await as('authenticated','admin');const rotated=await rpc('select public.configure_job_board($1,true,true) result',[attendanceBoard.id]);
      await as('anon');await rejects('select public.record_job_board_site_signin($1,$2,$3,$4,$5)',[attendanceBoard.token,'Name','Company','',submission]);
      await as('authenticated','admin');await rpc('select public.configure_job_board($1,false,false) result',[attendanceBoard.id]);
      await as('anon');await rejects('select public.record_job_board_site_signin($1,$2,$3,$4,$5)',[rotated.token,'Name','Company','',submission]);
      await db.exec('reset role');await rejects('delete from public.job_board_activity where board_id=$1',[attendanceBoard.id],/append.only/i);
    });
    await db.exec('reset role');
    await db.exec(`create table public.contacts(id uuid primary key default gen_random_uuid(),name text,role text,phone text,email text,notes text,sort_order integer,is_active boolean);
      alter table public.contacts enable row level security; revoke all on public.contacts from public,anon,authenticated;
      insert into public.contacts(name,role,phone,email,notes,sort_order,is_active) values ('Site office','Coordinator','613-555-0100','office@example.invalid','PRIVATE NOTE',1,true),('Inactive contact','Old','','','PRIVATE NOTE',0,false);`);
    await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261005153612_jgc_job_board_staff_forms_contacts_977.sql'),'utf8'));
    await db.exec("update public.job_board_visitor_sessions set created_at=now()-interval '1 hour'");
    await as('authenticated','admin'); const oldAutoBoard=await rpc('select public.get_or_create_job_board($1) result',[ids.job]); const autoBoard=await rpc('select public.configure_job_board($1,true,false) result',[oldAutoBoard.id]); Object.assign(otherBoard,await rpc('select public.configure_job_board($1,true,false) result',[otherBoard.id]));
    await check('contacts require an active board login and expose only active directory contact fields',async()=>{
      await as('anon'); await rejects('select public.get_job_board_contacts($1,null)',[autoBoard.token]); await rejects('select * from public.contacts');
      const v=await register(autoBoard,'contacts-977@example.invalid'); const contacts=await rpc('select public.get_job_board_contacts($1,$2) result',[autoBoard.token,v]);
      assert.equal(contacts.length,1); assert.deepEqual(Object.keys(contacts[0]).sort(),['email','name','phone','role']); assert(!JSON.stringify(contacts).includes('PRIVATE'));
      await rejects('select public.get_job_board_contacts($1,$2)',[otherBoard.token,v]);
      await db.exec('reset role');await db.query("update public.job_board_visitor_sessions set expires_at=now()-interval '1 minute' where token_hash=private.jgc_job_board_token_hash($1)",[v]);
      await as('anon');await rejects('select public.get_job_board_contacts($1,$2)',[autoBoard.token,v]);
      await as('authenticated','staff');const staffVisit=await register(autoBoard,'staff-contacts-977@example.invalid');assert.equal((await rpc('select public.get_job_board_contacts($1,$2) result',[autoBoard.token,staffVisit])).length,1);
      await as('authenticated','disabled');await rejects('select public.get_job_board_contacts($1,$2)',[autoBoard.token,staffVisit]);
    });
    await check('equipment QR inspections and every supported staff form auto-publish only to the exact selected job',async()=>{
      await as('authenticated','staff');
      // Fixture grants represent existing production insert policies, restricted to the submitting worker.
      await db.exec('reset role');await db.exec(`alter table public.inspection_records enable row level security;grant insert on public.inspection_records to authenticated;
        create policy synthetic_insert on public.inspection_records for insert to authenticated with check(worker_name=(select worker_key from public.profiles where id=auth.uid()));`);
      await as('authenticated','staff');
      const equipmentId='97700000-0000-4000-8000-000000000001';
      await db.query("insert into public.inspection_records(id,worker_name,inspection_type,inspection_date,title,form_data) values($1,'staff','Aerial Lift','2026-10-05','Equipment QR lift check',$2)",[equipmentId,{job_context:{jobNumber:'26999'},fields:[{label:'Equipment',value:'LIFT-1'}]}]);
      const formVisit=await register(autoBoard,'equipment-977@example.invalid');const m=await getBoard(autoBoard,formVisit);const d=m.documents.find(d=>d.source_id===equipmentId);assert(d);assert.equal(d.status,'published');assert.equal(d.visibility,'public');assert.equal(d.category,'inspection');
      assert.equal((await getBoard(otherBoard)).documents.filter(d=>d.source_id===equipmentId).length,0);
      const retry=await rpc('select public.attach_job_board_report_by_id($1,$2,$3) result',[autoBoard.id,'inspection_records',equipmentId]);assert.equal(retry.id,d.id);assert(retry.already_attached);
      await db.exec('reset role');
      for(const [i,table,owner,date,extra] of [[2,'toolbox_talk_reports','submitted_by_worker','report_date',",talk_title"],[3,'daily_site_reports','worker_name','report_date',''],[4,'incident_reports','reported_by_worker','report_date',",incident_type"],[5,'accident_reports','created_by_worker','accident_date',''],[6,'employee_injury_reports','created_by_worker','accident_date','']]) {
        const id=`97700000-0000-4000-8000-${String(i).padStart(12,'0')}`;
        const project=table==='employee_injury_reports'?'accident_location':table==='accident_reports'?'site_location':'project';
        await db.query(`insert into public.${table}(id,${owner},${date},${project}${extra}) values($1,'staff','2026-10-05','26999 - Exact selected job'${extra?",'Synthetic report'":''})`,[id]);
        const row=(await db.query('select status,visibility from public.job_board_documents where source_id=$1',[id])).rows[0]; assert(row,table);assert.equal(row.status,'published');assert.equal(row.visibility,i>=4?'restricted':'public');
      }
      await as('anon'); const visit=await register(autoBoard,'equipment-visitor-977@example.invalid');const publicModel=await getBoard(autoBoard,visit);assert(publicModel.documents.some(d=>d.source_id===equipmentId));assert(!publicModel.documents.some(d=>d.source_type==='employee_injury_reports'&&d.source_id.startsWith('977')));
    });
    await check('automatic routing does not publish for unapproved identities, unknown jobs or prefix collisions and preserves archives',async()=>{
      for(const [i,actor,number] of [[10,'disabled','26999'],[11,'limited','26999'],[12,'staff','269990'],[13,'staff','UNKNOWN']]) {
        await as('authenticated',actor);await db.exec('reset role');
        const id=`97700000-0000-4000-8000-${String(i).padStart(12,'0')}`;
        await db.query("insert into public.inspection_records(id,worker_name,inspection_type,inspection_date,title,form_data) values($1,$2,'Forklift','2026-10-05','Not eligible',$3)",[id,actor,{job_context:{jobNumber:number}}]);
        assert.equal((await db.query('select count(*)::integer n from public.job_board_documents where source_id=$1',[id])).rows[0].n,0);
      }
      await as('authenticated','admin');const equipment=(await getBoard(autoBoard)).documents.find(d=>d.source_id==='97700000-0000-4000-8000-000000000001');
      await rpc('select public.review_job_board_document($1,$2,$3) result',[equipment.id,'archived','public']);
      await as('authenticated','staff');assert.equal((await rpc('select public.attach_job_board_report_by_id($1,$2,$3) result',[autoBoard.id,'inspection_records',equipment.source_id])).status,'archived');
      await rejects('select private.jgc_job_board_auto_attach_staff_form()');
    });
    await db.exec('reset role');
    await db.exec(`create table public.safety_acknowledgements(id uuid primary key default gen_random_uuid(),record_type text not null,record_id uuid not null,record_title text,record_date date,job_id uuid,job_number text,job_name text,project text,location text,attendee_name text not null,attendee_key text not null,attendee_company text default '',attendee_type text not null default 'unknown',matched_employee_id uuid,matched_employee_email text,acknowledgement_status text not null default 'pending',acknowledgement_method text,acknowledged_at timestamptz,acknowledged_by_user_id uuid,acknowledged_by_name text,acknowledgement_note text,is_late boolean not null default false,unmatched_qr_entry boolean not null default false,qr_token text,created_by text,created_by_name text,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),removed_at timestamptz,unique(record_type,record_id,attendee_key));
      alter table public.safety_acknowledgements enable row level security;revoke all on public.safety_acknowledgements from public,anon,authenticated;`);
    await db.exec(`alter table public.safety_acknowledgements add column signature_strokes jsonb,add column signature_width integer,add column signature_height integer,add column signature_version smallint not null default 1,add column signature_signed_name text,add column signature_signed_at timestamptz;
      alter table public.safety_acknowledgements add constraint synthetic_ack_status check(acknowledgement_status in ('pending','acknowledged_by_user','acknowledged_by_creator','acknowledged_by_qr','late_acknowledgement','not_required','removed')),add constraint synthetic_ack_method check(acknowledgement_method is null or acknowledgement_method in ('user_portal','creator_on_behalf','qr_external','late_user_portal','late_qr_external','shared_device','late_shared_device')),add constraint synthetic_ack_shape check(signature_strokes is null or (jsonb_typeof(signature_strokes)='array' and jsonb_array_length(signature_strokes) between 1 and 200 and octet_length(signature_strokes::text)<=51200 and signature_width between 200 and 2000 and signature_height between 80 and 1000 and nullif(trim(signature_signed_name),'') is not null and signature_signed_at is not null));`);
    await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261005155511_jgc_job_board_history_jsa_sign_on_978.sql'),'utf8'));
    await as('authenticated','staff');
    const jsaSource='97800000-0000-4000-8000-000000000001';await db.query("insert into public.inspection_records(id,worker_name,inspection_type,inspection_date,title,form_data) values($1,'staff','JSA','2026-10-05','Late arrival JSA',$2)",[jsaSource,{job_context:{jobNumber:'26999'},fields:[{label:'Project',value:'26999 - Selected job'}],rows:[{cells:['Lift work','Falls','Fall protection']}]}]);
    await as('authenticated','admin');const jsaDoc=(await getBoard(autoBoard)).documents.find(d=>d.source_id===jsaSource);
    const getJsa=(token,visit,id=jsaDoc.id)=>rpc('select public.get_job_board_jsa($1,$2,$3) result',[token,visit,id]);
    const signature=[[[.1,.2],[.5,.6],[.8,.2]]];
    const sign=(token,visit,version,strokes=signature,read=true,id=jsaDoc.id)=>rpc('select public.sign_job_board_jsa($1,$2,$3,$4,$5,$6,$7,$8) result',[token,visit,id,read,version,strokes,500,230]);
    await check('JSA read/sign endpoints require the current board session and published exact-job JSA',async()=>{
      await as('anon');await rejects('select public.get_job_board_jsa($1,null,$2)',[autoBoard.token,jsaDoc.id]);await rejects('select * from public.safety_acknowledgements');
      const v=await register(otherBoard,'wrong-job-jsa@example.invalid');await rejects('select public.get_job_board_jsa($1,$2,$3)',[otherBoard.token,v,jsaDoc.id]);
      await as('authenticated','admin');await rejects('select public.get_job_board_jsa($1,null,$2)',[autoBoard.token,policyIds.current],/JSA|document/i);
    });
    let visitor978;
    await check('visitor JSA read confirmation and signature validation precede canonical late sign-on with immutable retries',async()=>{
      await as('anon');visitor978=await register(autoBoard,'late-visitor-978@example.invalid');const model=await getJsa(autoBoard.token,visitor978);assert.deepEqual(model.identity,{name:'Synthetic Visitor',company:'Synthetic Company'});assert.equal(model.signed,false);assert(!JSON.stringify(model).includes('qr_token'));
      await rejects('select public.sign_job_board_jsa($1,$2,$3,false,$4,$5,500,230)',[autoBoard.token,visitor978,jsaDoc.id,model.version,signature],/confirm/i);
      for(const bad of [null,[],[[]],[[[0,0]]],[[[0,0],[2,0]]],[[[0,0],['bad',.5]]],[[[0,0],null]],[[[0,0],[.1,.1,.1]]]])await assert.rejects(()=>sign(autoBoard.token,visitor978,model.version,bad),/signature/i);
      const saved=await sign(autoBoard.token,visitor978,model.version);assert(saved.ok);const again=await sign(autoBoard.token,visitor978,model.version,[[[.2,.2],[.3,.3]]]);assert(again.already_signed);assert.equal(again.signed_at,saved.signed_at);
      const signed=await getJsa(autoBoard.token,visitor978);assert(signed.signed);assert.equal(signed.acknowledgements.length,1);assert.deepEqual(signed.acknowledgements[0].signature_strokes,signature);assert.equal(signed.acknowledgements[0].attendee_company,'Synthetic Company');assert(!JSON.stringify(signed).includes('late-visitor-978@example.invalid'));
    });
    await check('staff sign-on uses the approved profile and preserves the original existing crew acknowledgement',async()=>{
      await db.exec('reset role');const crewId='97800000-0000-4000-8000-000000000002';await db.query("insert into public.safety_acknowledgements(id,record_type,record_id,attendee_name,attendee_key,attendee_company,matched_employee_id) values($1,'jsa',$2,'Old name','existing-crew-key','Old company',$3)",[crewId,jsaSource,ids.staff]);
      await as('authenticated','staff');const v=await register(autoBoard,'ignored-staff-978@example.invalid');const model=await getJsa(autoBoard.token,v);assert.equal(model.identity.name,'Synthetic staff');assert.equal(model.identity.company,'John Gordon Construction');await sign(autoBoard.token,v,model.version);
      await db.exec('reset role');const crew=(await db.query('select * from public.safety_acknowledgements where id=$1',[crewId])).rows[0];assert.equal(crew.signature_signed_name,'Synthetic staff');assert.equal(crew.attendee_company,'John Gordon Construction');assert.equal(crew.attendee_key,'existing-crew-key');assert(crew.is_late);assert.equal(crew.acknowledgement_method,'late_user_portal');
      assert.equal((await db.query('select count(*)::integer n from public.safety_acknowledgements where record_id=$1',[jsaSource])).rows[0].n,2);
    });
    await check('JSA changed revisions, revoked visitors, disabled boards and accounts cannot sign stale reports',async()=>{
      await as('anon');const model=await getJsa(autoBoard.token,visitor978);await db.exec('reset role');await db.query("update public.job_board_documents set updated_at=clock_timestamp(),title='Revised JSA' where id=$1",[jsaDoc.id]);await as('anon');await assert.rejects(()=>sign(autoBoard.token,visitor978,model.version),/changed|updated/i);
      await db.exec('reset role');await db.query('update public.job_board_visitor_sessions set revoked_at=now() where token_hash=private.jgc_job_board_token_hash($1)',[visitor978]);await as('anon');await rejects('select public.get_job_board_jsa($1,$2,$3)',[autoBoard.token,visitor978,jsaDoc.id]);
      await as('authenticated','disabled');await rejects('select public.get_job_board_jsa($1,null,$2)',[autoBoard.token,jsaDoc.id]);
      await as('authenticated','admin');await rpc('select public.configure_job_board($1,false,false) result',[autoBoard.id]);await rejects('select public.get_job_board_jsa($1,null,$2)',[autoBoard.token,jsaDoc.id]);await rpc('select public.configure_job_board($1,true,false) result',[autoBoard.id]);
    });
    await check('Portal and Site sign-in pagination are independent and remain admin-only',async()=>{
      await as('authenticated','admin');for(const kind of ['portal','site']){let before=null,events=[];do{const page=await rpc('select public.get_job_board_signins($1,$2,$3,1) result',[autoBoard.id,kind,before]);events.push(...page.events);before=page.next_before;}while(before);assert(events.every(e=>e.action===(kind==='portal'?'visit':'site-signin')));assert.equal(new Set(events.map(e=>e.id)).size,events.length);}
      await rejects('select public.get_job_board_signins($1,$2)',[autoBoard.id,'invalid'],/Portal|Site/i);await as('authenticated','staff');await rejects('select public.get_job_board_signins($1,$2)',[autoBoard.id,'portal']);await as('anon');await rejects('select public.get_job_board_signins($1,$2)',[autoBoard.id,'site']);
    });
    console.log(`${passed}/${passed+failures.length} local Job Board security groups passed. No production connections or writes.`);
    if(failures.length) process.exitCode=1;
  } finally { await db.close(); }
})().catch(error => { console.error(error.stack || error.message); process.exitCode=1; });
