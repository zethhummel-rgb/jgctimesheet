const fs=require('fs'),path=require('path'),vm=require('vm'),ts=require('../estimating-app/node_modules/typescript');
const {test,expect}=require('@playwright/test');
const root=path.resolve(__dirname,'..'),TOKEN='ab'.repeat(32),USER='00000000-0000-4000-8000-000000000001',OTHER='00000000-0000-4000-8000-000000000002';
function compile(file){return ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;}
function shared(file){const module={exports:{}};Function('module','exports',compile('supabase/functions/_shared/'+file+'.ts'))(module,module.exports);return module.exports;}
function worker(slug,options={}){
 let handler;const calls=[],push=[];
 const profile={id:USER,role:options.role||'worker',account_status:options.status||'approved',worker_key:'fixture worker',display_name:'Fixture worker'};
 const db={auth:{getUser:async token=>({data:{user:token==='signed-user'?{id:USER,email:'fixture@example.invalid'}:null},error:token==='signed-user'?null:{message:'Invalid user JWT'}})},rpc:async(name,args)=>{calls.push(['rpc',name,args]);return {data:name==='jgc_validate_worker_token'?args.p_token===TOKEN:name==='jgc_claim_po_cancellation'?null:[],error:null};},from:table=>{
  calls.push(['from',table]);const result={data:table==='notifications'?options.notifications||[]:table==='push_subscriptions'?options.subscriptions||[]:[],error:null};
  const q=new Proxy({}, {get:(_,method)=>{
   if(method==='then')return(resolve,reject)=>Promise.resolve(result).then(resolve,reject);
   if(method==='single')return async()=>({data:table==='profiles'?profile:table==='digital_purchase_orders'?{id:OTHER,po_number:30001,creator_profile_id:USER,workflow_status:'cancelled'}:null,error:null});
   return(...args)=>{calls.push([table,String(method),...args]);return q;};
  }});return q;
 }};
 const env={SUPABASE_URL:'https://synthetic.invalid',SUPABASE_SERVICE_ROLE_KEY:'test-only-service-placeholder',JGC_VAPID_PUBLIC_KEY:'test-public',JGC_VAPID_PRIVATE_KEY:'test-private'};
 const c={module:{exports:{}},exports:{},Request,Response,Headers,URL,Date,console,AbortSignal,setTimeout,clearTimeout,Deno:{env:{get:name=>env[name]},serve:fn=>handler=fn},fetch:async(...args)=>{calls.push(['outbound',...args]);throw Error('No real email is allowed in this test');},require:module=>{
  if(module.startsWith('jsr:')||module.includes('work-order-pdf-branding'))return {};
  if(module.startsWith('https://esm.sh/'))return {createClient:()=>db};
  if(module.includes('worker-auth'))return shared('worker-auth');
  if(module.includes('push-endpoint'))return shared('push-endpoint');
  if(module.startsWith('npm:web-push'))return {default:{setVapidDetails(){},sendNotification:async subscription=>{push.push(subscription.endpoint);if(options.pushError)throw {statusCode:503,body:'PRIVATE UPSTREAM RESPONSE',message:'PRIVATE HOST DETAILS'};}}};
  throw Error('Unexpected module '+module);
 }};c.exports=c.module.exports;
 vm.runInNewContext(compile('supabase/functions/'+slug+'/index.ts'),c);
 return {calls,push,request:async(body={},headers={})=>handler(new Request('https://synthetic.invalid/worker',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)}))};
}

for(const slug of ['send-schedule-reminders','auto-submit-work-orders','send-digital-po-email','send-push-notification']){
 test(slug+' rejects anonymous and public-key callers before business queries',async()=>{
  for(const headers of [{},{Authorization:'Bearer public-anon-key'},{'x-jgc-worker-token':'cd'.repeat(32)}]){
   const h=worker(slug),response=await h.request({},headers);expect(response.status).toBe(403);
   expect(h.calls.filter(c=>c[0]==='from'&&c[1]!=='profiles')).toEqual([]);expect(h.calls.filter(c=>c[0]==='outbound')).toEqual([]);
   expect(h.calls.filter(c=>c[0]==='rpc'&&c[1]!=='jgc_validate_worker_token')).toEqual([]);
  }
 });
 test(slug+' accepts a dedicated scheduler token without sending real email',async()=>{
  const h=worker(slug),response=await h.request({}, {'x-jgc-worker-token':TOKEN});expect(response.status).toBe(200);expect(h.calls.filter(c=>c[0]==='outbound')).toEqual([]);
 });
}

test('Work Order early-submit requires approved admin identity and rejects unknown actions',async()=>{
 for(const options of [{role:'worker'},{role:'admin',status:'inactive'}]){
  const h=worker('auto-submit-work-orders',options),response=await h.request({work_order_id:OTHER},{Authorization:'Bearer signed-user'});expect(response.status).toBe(403);expect(h.calls.filter(c=>c[0]==='from'&&c[1]==='work_orders')).toEqual([]);
 }
 const h=worker('auto-submit-work-orders',{role:'admin'});expect((await h.request({work_order_id:OTHER},{Authorization:'Bearer signed-user'})).status).toBe(200);
 expect((await h.request({action:'delete_everything'},{Authorization:'Bearer signed-user'})).status).toBe(400);
});

test('PO worker rejects unknown actions and deactivated creators/admins cannot email cancellation',async()=>{
 const unknown=worker('send-digital-po-email');expect((await unknown.request({action:'unknown'})).status).toBe(400);expect(unknown.calls.filter(c=>c[0]==='rpc')).toEqual([]);
 for(const role of ['worker','admin']){const h=worker('send-digital-po-email',{role,status:'inactive'});expect((await h.request({action:'cancellation_notification',po_id:OTHER},{Authorization:'Bearer signed-user'})).status).toBe(403);expect(h.calls.filter(c=>c[0]==='outbound')).toEqual([]);}
 const h=worker('send-digital-po-email');const response=await h.request({action:'cancellation_notification',po_id:OTHER},{Authorization:'Bearer signed-user'});expect(response.status).toBe(200);expect((await response.json()).result.status).toBe('already_notified_or_sending');expect(h.calls.filter(c=>c[0]==='outbound')).toEqual([]);
});

test('push cannot reach private or arbitrary endpoints or disclose upstream response bodies',async()=>{
 for(const endpoint of ['https://127.0.0.1/private','https://10.0.0.1/private','https://[::1]/private','https://internal.invalid/private','https://web.push.apple.com.evil.invalid/x','https://user@web.push.apple.com/x','https://web.push.apple.com:8443/x']){
  const h=worker('send-push-notification',{notifications:[{id:OTHER,title:'Fixture',target_profile_id:USER}],subscriptions:[{id:USER,endpoint,enabled:true}]});
  const response=await h.request({notification_ids:[OTHER]},{'x-jgc-worker-token':TOKEN});expect(response.status).toBe(200);expect(h.push).toEqual([]);
 }
 const h=worker('send-push-notification',{notifications:[{id:OTHER,title:'Fixture',target_profile_id:USER}],subscriptions:[{id:USER,endpoint:'https://web.push.apple.com/fixture',enabled:true}],pushError:true});
 const response=await h.request({notification_ids:[OTHER]},{'x-jgc-worker-token':TOKEN}),body=await response.text();expect(h.push).toEqual(['https://web.push.apple.com/fixture']);expect(body).not.toContain('PRIVATE');expect(JSON.stringify(h.calls)).not.toContain('PRIVATE');expect(body).toContain('HTTP 503');
});

test('signed-in push lookup cannot relay another employee notification',async()=>{
 const h=worker('send-push-notification',{notifications:[{id:OTHER,created_by:OTHER,target_profile_id:OTHER}],subscriptions:[{id:OTHER,endpoint:'https://web.push.apple.com/fixture'}]});
 const response=await h.request({notification_ids:[OTHER]},{Authorization:'Bearer signed-user'});expect(response.status).toBe(200);expect(h.push).toEqual([]);
});
