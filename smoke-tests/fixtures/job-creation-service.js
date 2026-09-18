const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ts = require('../../estimating-app/node_modules/typescript');
function load(relative) {
  const file = path.resolve(__dirname, '../../estimating-app/lib', relative + '.ts');
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(code,{module,exports:module.exports,require:(name)=>load(name),console,crypto:require('node:crypto').webcrypto,structuredClone});
  return module.exports;
}
const { createDefaultState, normalizeAppState } = load('estimator-data');
const { prepareJobCreation } = load('job-creation');
async function mockCreation(page, initialState = createDefaultState(), number='26123') {
  let state = initialState;
  const requests=[];
  await page.route('**/api/state', route=>{
    if(route.request().method()==='PUT') state=route.request().postDataJSON().state;
    return route.fulfill({json:{state,saved:true,updatedAt:new Date().toISOString()}});
  });
  await page.route('**/api/job-create',route=>{
    const body=route.request().postDataJSON();requests.push(body);
    const job={...prepareJobCreation(state,body.draft,body.client),id:'synthetic-created-job',portalJobId:'00000000-0000-4000-8000-000000000091',jobNumber:number,status:'Active',portalActive:true,portalJobName:body.draft.jobName,acceptedAt:new Date().toISOString(),jobDate:'2026-09-18'};
    state=normalizeAppState({...state,jobs:[job,...state.jobs],quotes:state.quotes.map(q=>q.id===job.quoteId?{...q,status:'Won',jobId:job.id}:q)});
    return route.fulfill({json:{state,jobId:job.id,jobNumber:number,updatedAt:new Date().toISOString()}});
  });
  return {requests,getState:()=>state};
}
module.exports={mockCreation,load};
