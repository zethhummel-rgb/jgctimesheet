// Synthetic local Postgres only. No network or production credentials.
const {PGlite}=require(process.env.JGC_PGLITE_MODULE || '@electric-sql/pglite');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const db=new PGlite();
 const creator='00000000-0000-4000-8000-000000000001',worker='00000000-0000-4000-8000-000000000002',admin='00000000-0000-4000-8000-000000000003';
 await db.exec(`create role authenticated;create role anon;create schema auth;create schema private;
 create table auth.users(id uuid primary key);insert into auth.users values('${creator}'),('${worker}'),('${admin}');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table public.profiles(id uuid primary key,worker_key text,display_name text,email text,role text,account_status text);
 insert into profiles values('${creator}','creator','Synthetic Creator','creator@example.com','admin','approved'),('${worker}','worker','Synthetic Worker','worker@example.com','worker','approved'),('${admin}','admin','Other Admin','other@example.com','admin','approved');
 create function public.is_admin() returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.profiles where id=auth.uid() and role='admin' and account_status='approved')$$;
 create function private.jgc_has_full_portal_access() returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.profiles where id=auth.uid() and account_status='approved')$$;
 grant usage on schema auth,private to authenticated,anon;
 create table inspection_records(id uuid primary key,worker_name text not null,worker_display_name text,inspection_type text not null,inspection_date date,title text,summary jsonb default '{}',form_data jsonb default '{}',email_body text,created_at timestamptz default now());
 create table safety_acknowledgements(id uuid primary key default gen_random_uuid(),record_type text not null,record_id uuid not null,record_title text,record_date date,job_id uuid,project text,location text,job_number text,job_name text,attendee_name text not null,attendee_key text not null,attendee_company text,attendee_type text not null,matched_employee_id uuid,matched_employee_email text,qr_token text,created_by text,created_by_name text,created_at timestamptz default now(),updated_at timestamptz default now(),removed_at timestamptz,acknowledgement_status text not null default 'pending',acknowledgement_method text,acknowledged_at timestamptz,acknowledged_by_user_id uuid,acknowledged_by_name text,acknowledgement_note text,is_late boolean default false,unmatched_qr_entry boolean default false,signature_strokes jsonb,signature_width integer,signature_height integer,signature_version smallint default 1,signature_signed_name text,signature_signed_at timestamptz,unique(record_type,record_id,attendee_key));
 alter table inspection_records enable row level security;alter table safety_acknowledgements enable row level security;
 grant select,insert,update,delete on inspection_records,safety_acknowledgements to authenticated;
 create policy read_records on inspection_records for select to authenticated using(true);
 create policy insert_records on inspection_records for insert to authenticated with check(true);
 create policy update_records on inspection_records for update to authenticated using(true) with check(true);
 create policy read_ack on safety_acknowledgements for select to authenticated using(true);
 create policy insert_ack on safety_acknowledgements for insert to authenticated with check(true);
 create policy update_ack on safety_acknowledgements for update to authenticated using(true) with check(true);
 create policy delete_ack on safety_acknowledgements for delete to authenticated using(true);
 create table notifications(id uuid primary key default gen_random_uuid(),notification_type text,title text,message text,link_url text,target_profile_id uuid,target_worker_email text,target_worker_key text,source_table text,source_id text,metadata jsonb,created_by uuid,created_by_name text,expires_at timestamptz,dedupe_key text unique,cleared_at timestamptz);
 create table notification_settings(notification_type text primary key,admin_enabled boolean,employee_enabled boolean,supervisor_enabled boolean);
 create table job_boards(id uuid primary key,enabled boolean,portal_job_id uuid,job_number text,job_name text,address text);
 create table job_board_documents(id uuid primary key,board_id uuid,status text,category text,source_type text,source_id uuid,source_payload jsonb,title text,report_date date,updated_at timestamptz default now());
 create function private.jgc_job_board_read_document(text,uuid,uuid) returns public.job_board_documents language sql security definer as $$select d from public.job_board_documents d where id=$3$$;
 create function private.jgc_job_board_actor(uuid,uuid) returns jsonb language sql security definer as $$select jsonb_build_object('identity_type','staff','profile_id',auth.uid(),'name',p.display_name,'company','John Gordon Construction','email',p.email) from profiles p where id=auth.uid()$$;
 `);

// The fixture below adds board-session contracts; all first-signature code runs from the real migration.
 const sql=name=>fs.readFileSync(path.join(__dirname,'../supabase/migrations/',name),'utf8');
 await db.exec(sql('20260923010940_prepared_jsas.sql'));
 await db.exec(sql('20261005185735_jsa_personal_worker_signoff_984.sql'));
 const privacy=sql('20261009175359_public_qr_privacy_1014.sql');
 const start=privacy.indexOf('CREATE OR REPLACE FUNCTION private.jgc1014_public_safety_model');
 await db.exec(privacy.slice(start,privacy.indexOf('END $function$;',start)+'END $function$;'.length));
 await db.exec(`alter table job_boards add column token text;
 alter table job_board_documents add column created_at timestamptz default now(),add column file_name text,add column mime_type text,add column file_size bigint,add column object_path text,add column notes text,add column visibility text,add column created_by uuid;
 create table job_board_visitor_sessions(id uuid primary key,board_id uuid,token uuid,profile_id uuid,actor_name text,actor_company text,actor_email text,identity_type text,expires_at timestamptz,revoked_at timestamptz,purpose text default 'portal');
 create function private.jgc_job_board_admin() returns boolean language sql stable security definer set search_path='' as $$select public.is_admin()$$;
 create function private.jgc_job_board_staff() returns boolean language sql stable security definer set search_path='' as $$select private.jgc_has_full_portal_access()$$;
 create function private.jgc_job_board_visit(p_board uuid,p_visit uuid) returns public.job_board_visitor_sessions language sql stable security definer set search_path='' as $$select s from public.job_board_visitor_sessions s where s.board_id=p_board and s.token=p_visit and s.purpose='portal' and s.expires_at>now() and s.revoked_at is null and ((s.profile_id is null and auth.uid() is null) or (s.profile_id=auth.uid() and exists(select 1 from public.profiles p where p.id=s.profile_id and p.account_status in ('approved','limited'))))$$;
 create or replace function private.jgc_job_board_actor(p_board uuid,p_visit uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$declare p public.profiles;s public.job_board_visitor_sessions;begin
 if private.jgc_job_board_admin() then select * into p from public.profiles where id=auth.uid();return jsonb_build_object('profile_id',p.id,'name',p.display_name,'company','John Gordon Construction','identity_type','staff','email',p.email);end if;
 s:=private.jgc_job_board_visit(p_board,p_visit);if s.id is null then raise exception 'Visitor sign-in is required' using errcode='42501';end if;
 return jsonb_build_object('profile_id',s.profile_id,'name',s.actor_name,'company',s.actor_company,'email',s.actor_email,'identity_type',s.identity_type);end$$;
 create or replace function private.jgc_job_board_read_document(p_token text,p_visit uuid,p_id uuid) returns public.job_board_documents language plpgsql stable security definer set search_path='' as $$declare d public.job_board_documents;b public.job_boards;begin
 select * into b from public.job_boards where token=p_token and enabled;if b.id is null then raise exception 'Board unavailable' using errcode='42501';end if;perform private.jgc_job_board_actor(b.id,p_visit);
 select * into d from public.job_board_documents where id=p_id and board_id=b.id and status='published' and (visibility='public' or private.jgc_job_board_staff());if d.id is null then raise exception 'Document unavailable' using errcode='42501';end if;return d;end$$;
 create function private.jgc_job_board_source_matches(p_source jsonb,p_board uuid,p_number text) returns boolean language sql immutable set search_path='' as $$select case when p_source#>>'{form_data,job_context,job_board_id}' is not null then p_source#>>'{form_data,job_context,job_board_id}'=p_board::text else p_source#>>'{form_data,job_context,jobNumber}'=p_number end$$;
 create function private.jgc_job_board_clean_snapshot(p_source jsonb) returns jsonb language sql immutable set search_path='' as $$select p_source$$;`);
 await db.exec(sql('20261015115019_job_board_first_signature_1018.sql'));
 const as=async user=>db.exec(`reset role;set request.jwt.claim.sub='${user||''}';set role ${user?'authenticated':'anon'};`);
 const call=async(q,args=[])=>(await db.query(q,args)).rows[0]?.result;
 const rejects=(q,args,pattern)=>assert.rejects(()=>db.query(q,args),pattern);
 const board='00000000-0000-4000-8000-000000000060',otherBoard='00000000-0000-4000-8000-000000000061';
 const visit='00000000-0000-4000-8000-000000000070',secondVisit='00000000-0000-4000-8000-000000000071',staffVisit='00000000-0000-4000-8000-000000000072';
 const prep='00000000-0000-4000-8000-000000000080',future='00000000-0000-4000-8000-000000000081',past='00000000-0000-4000-8000-000000000082',wrongJob='00000000-0000-4000-8000-000000000083';
 const dates=(await db.query("select (now() at time zone 'America/Toronto')::date::text today,((now() at time zone 'America/Toronto')::date+1)::text future,((now() at time zone 'America/Toronto')::date-1)::text past")).rows[0];
 const payload=(date,job='26999')=>({record:{inspection_date:date,form_data:{fields:[{label:'Project / Job',value:job+' - Synthetic job'}],rows:[{cells:['Task','Hazard','Control']}],job_context:{jobNumber:job,project:job+' - Synthetic job'}},summary:{}},crew:[{profile_id:worker,display_name:'Synthetic Worker'}],manual:[{name:'First Visitor',company:'Trade Co'},{name:'Second Visitor',company:'Other Co'}]});
 const sig=[[[.1,.2],[.3,.4],[.5,.3]]];
 await db.query("insert into job_boards(id,token,enabled,job_number,job_name) values($1,'board-token',true,'26999','Synthetic job'),($2,'other-token',true,'26888','Other job')",[board,otherBoard]);
 await db.query(`insert into job_board_visitor_sessions(id,board_id,token,actor_name,actor_company,actor_email,identity_type,expires_at) values
 ($1,$2,$1,'First Visitor','Trade Co','first@example.test','visitor',now()+interval '1 day'),
 ($3,$2,$3,'Second Visitor','Other Co','second@example.test','visitor',now()+interval '1 day')`,[visit,board,secondVisit]);
 await db.query("insert into job_board_visitor_sessions(id,board_id,token,profile_id,actor_name,actor_company,actor_email,identity_type,expires_at) values($1,$2,$1,$3,'Synthetic Worker','John Gordon Construction','worker@example.com','staff',now()+interval '1 day')",[staffVisit,board,worker]);
 for(const [id,date,job]of[[prep,dates.today,'26999'],[future,dates.future,'26999'],[past,dates.past,'26999'],[wrongJob,dates.today,'26888']])
  await db.query('insert into jsa_preparations(id,payload,created_by,created_at) values($1,$2,$3,now()-interval\'2 days\')',[id,payload(date,job),creator]);
 await as(null);
 await rejects('select public.list_job_board_prepared_jsas($1,null)',['board-token'],/sign-in/);
 const list=await call('select public.list_job_board_prepared_jsas($1,$2) result',['board-token',visit]);assert.equal(list.length,1);assert.equal(list[0].id,prep);
 await rejects('select public.get_job_board_prepared_jsa($1,$2,$3)',['other-token',visit,prep],/sign-in/);
 await rejects('select public.get_job_board_prepared_jsa($1,$2,$3)',['board-token',visit,wrongJob],/unavailable/);
 for(const id of [future,past])await rejects('select public.get_job_board_prepared_jsa($1,$2,$3)',['board-token',visit,id],/unavailable/);
 let model=await call('select public.get_job_board_prepared_jsa($1,$2,$3) result',['board-token',visit,prep]);
 assert.equal(model.prepared,true);assert.equal(model.signed,false);assert.equal(model.identity.name,'First Visitor');assert.equal(model.workflow.required,3);assert.equal(model.record.form_data.jsa_worker_workflow_version,2);assert.equal(model.record.jsa_workflow.status,'Prepared — first signature activates');
 const key=model.review_key;
 const sign=(visitToken,keyValue=key,signature=sig,confirm=true)=>db.query('select public.sign_today_job_board_jsa($1,$2,$3,true,$4,$5,$6,300,150) result',['board-token',visitToken,prep,keyValue,confirm,signature]);
 await assert.rejects(()=>sign(visit,key,sig,false),/confirm/);await assert.rejects(()=>sign(visit,'changed'),/changed/);await assert.rejects(()=>sign(visit,key,[[[2,0],[0,0]]]),/Invalid signature/);
 await db.exec('reset role');assert.equal((await db.query('select * from inspection_records where id=$1',[prep])).rows.length,0,'review and failed signatures never activate');
 await as(null);let result=(await sign(visit)).rows[0].result;assert.equal(result.ok,true);assert.equal(result.workflow.signed,1);assert.equal(result.workflow.required,3);assert.equal(result.workflow.status,'Draft — Awaiting Worker Sign-Offs');
 await db.exec('reset role');const preparation=(await db.query('select * from jsa_preparations where id=$1',[prep])).rows[0];assert(preparation.activated_at);assert.equal(preparation.activated_by,null);assert.equal(preparation.activated_visit_id,visit);assert.equal(preparation.activation_identity.name,'First Visitor');
 assert.equal((await db.query('select count(*)::int n from job_board_documents where source_id=$1',[prep])).rows[0].n,1);
 const first=(await db.query('select * from safety_acknowledgements where record_id=$1 and signature_signed_at is not null',[prep])).rows[0];assert.equal(first.attendee_name,'First Visitor');assert.equal(first.signature_signed_name,'First Visitor');assert.equal(first.is_late,false);
 await as(null);model=await call('select public.get_job_board_prepared_jsa($1,$2,$3) result',['board-token',visit,prep]);assert.equal(model.signed,true);assert.equal(model.review_key,key,'first activation does not invalidate other people’s reviewed copy');
 assert(!JSON.stringify(model).includes('signature_strokes'),'visitor reviews redact other signatures');
 result=(await sign(visit,key,[[[.7,.7],[.8,.8]]])).rows[0].result;assert.equal(result.already_signed,true);
 result=(await sign(secondVisit)).rows[0].result;assert.equal(result.workflow.signed,2);assert.equal(result.workflow.outstanding,1);
 await as(worker);await rejects('select public.get_job_board_prepared_jsa($1,$2,$3)',['board-token',visit,prep],/sign-in/);
 result=(await sign(staffVisit)).rows[0].result;assert.equal(result.workflow.status,'Completed');assert.equal(result.workflow.signed,3);assert.equal(result.workflow.outstanding,0);
 await db.exec('reset role');assert.deepEqual((await db.query('select signature_strokes from safety_acknowledgements where id=$1',[first.id])).rows[0].signature_strokes,first.signature_strokes,'retry preserved original signature');
 assert.equal((await db.query('select count(*)::int n from inspection_records where id=$1',[prep])).rows[0].n,1);assert.equal((await db.query('select count(*)::int n from notifications')).rows[0].n,0);
 // Staff may be first too; a changed reviewed report cannot be signed or activated.
 const staffFirst='00000000-0000-4000-8000-000000000084',unmatched='00000000-0000-4000-8000-000000000085',empty='00000000-0000-4000-8000-000000000086';
 await db.query('insert into jsa_preparations(id,payload,created_by) values($1,$2,$3)',[staffFirst,payload(dates.today),creator]);
 const unknown=payload(dates.today);delete unknown.record.form_data.job_context.jobNumber;
 await db.query('insert into jsa_preparations(id,payload,created_by) values($1,$2,$3)',[unmatched,unknown,creator]);
 const none=payload(dates.today);none.crew=[];none.manual=[];
 await db.query('insert into jsa_preparations(id,payload,created_by) values($1,$2,$3)',[empty,none,creator]);
 await as(worker);await rejects('select public.get_job_board_prepared_jsa($1,$2,$3)',['board-token',staffVisit,unmatched],/unavailable/);
 const oldKey=(await call('select public.get_job_board_prepared_jsa($1,$2,$3) result',['board-token',staffVisit,staffFirst])).review_key;
 await db.exec('reset role');const revised=payload(dates.today);revised.record.form_data.rows[0].cells[2]='Updated control';
 await db.query('update jsa_preparations set payload=$2,revision=revision+1 where id=$1',[staffFirst,revised]);
 await as(worker);await rejects('select public.sign_today_job_board_jsa($1,$2,$3,true,$4,true,$5,300,150)',['board-token',staffVisit,staffFirst,oldKey,sig],/changed/);
 const newKey=(await call('select public.get_job_board_prepared_jsa($1,$2,$3) result',['board-token',staffVisit,staffFirst])).review_key;
 await db.query('select public.sign_today_job_board_jsa($1,$2,$3,true,$4,true,$5,300,150)',['board-token',staffVisit,staffFirst,newKey,sig]);
 await db.exec('reset role');const staffActivation=(await db.query('select activated_by,activated_visit_id from jsa_preparations where id=$1',[staffFirst])).rows[0];assert.equal(staffActivation.activated_by,worker);assert.equal(staffActivation.activated_visit_id,null);
 // No planned workers: the first signer is added as themselves, and is the only required signer.
 await as(null);const emptyKey=(await call('select public.get_job_board_prepared_jsa($1,$2,$3) result',['board-token',secondVisit,empty])).review_key;
 const emptyResult=await call('select public.sign_today_job_board_jsa($1,$2,$3,true,$4,true,$5,300,150) result',['board-token',secondVisit,empty,emptyKey,sig]);assert.equal(emptyResult.workflow.required,1);assert.equal(emptyResult.workflow.signed,1);assert.equal(emptyResult.workflow.status,'Completed');
 await db.exec('reset role');const emptyAck=(await db.query('select attendee_name,attendee_company from safety_acknowledgements where record_id=$1',[empty])).rows[0];assert.equal(emptyAck.attendee_name,'Second Visitor');assert.equal(emptyAck.attendee_company,'Other Co');
 // Sessions are board-bound, revocable, expiring and tied to the current account.
 await db.query("update job_board_visitor_sessions set revoked_at=now() where id=$1",[visit]);await as(null);await rejects('select public.get_job_board_prepared_jsa($1,$2,$3)',['board-token',visit,prep],/sign-in/);
 await rejects('select private.jgc_seed_board_prepared_jsa($1)',[future],/permission denied/);
 await rejects('select * from jsa_preparations',[],/permission denied/);
 await db.close();console.log('PASS: visitor first signature atomically activates only today’s matching job JSA; roster retained, later staff/visitor self-sign, completion, idempotence/privacy, session/job/date/version/signature guards and owner-only seeding.');
})().catch(e=>{console.error(e);process.exitCode=1;});
