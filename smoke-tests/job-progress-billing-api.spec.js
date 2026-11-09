
const {test,expect}=require("@playwright/test");
const {load}=require("./fixtures/job-accounting-fixture");
const {jobProgressBillingResponse}=load("estimating-app/src/job-progress-billing-api.ts");
const jobId="11111111-1111-4111-8111-111111111111", requestId="22222222-2222-4222-8222-222222222222";
function client(role="admin",status="approved") {
 const calls=[];
 const c={calls,auth:{getUser:async()=>({data:{user:{id:jobId}}})},rpc:async(name,args)=>{calls.push({name,args});return {data:{id:args.p_request_id}};},from(table){
   calls.push({table}); const chain={select(){return chain;},eq(){return chain;},single:async()=>({data:{role,account_status:status}})};
   return chain;
 }}; return c;
}
const send=(c,body,method="POST")=>jobProgressBillingResponse(c,new Request("https://test.invalid/api/job-progress-billing",{method,body:JSON.stringify(body)}));
test("billing endpoint restricts employees and inactive admins before any mutation",async()=>{
 for(const [role,status] of [["employee","approved"],["admin","inactive"]]) {
  const c=client(role,status);
  expect((await send(c,{jobId,requestId,action:"request"})).status).toBe(403);
  expect(c.calls).toEqual([{table:"profiles"}]);
 }
});
test("billing endpoint validates identity and sends scoped requests and cancellation to the database",async()=>{
 const c=client();
 expect((await send(c,{jobId:"bad",requestId,action:"request"})).status).toBe(400);
 expect((await send(c,{jobId,requestId,action:"delete"})).status).toBe(400);
 for(const action of ["request","cancel"]) {
  expect((await send(c,{jobId,requestId,action})).status).toBe(200);
  expect(c.calls.at(-1)).toEqual({name:"change_job_progress_billing",args:{p_job_id:jobId,p_request_id:requestId,p_action:action}});
 }
 expect((await send(c,{jobId,requestId},"DELETE")).status).toBe(405);
});
