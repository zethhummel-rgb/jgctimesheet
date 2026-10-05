import type { SafetyBlock, SafetyPage, SafetyTable, SafetySteps } from './site-specific';
import { standardSafetyPages, standardProcedure } from './site-specific-content';

// The supplied framework and combined SSSP have the same 14-section plan.
// Keep their information structure, not their old site's answers or personal data.
const table=(id:string,title:string,columns:[string,string,number?][],values:Record<string,string>[]=[]):SafetyTable=>({
 type:'table',id,title,columns:columns.map(([id,label,weight])=>({id,label,weight})),
 rows:(values.length?values:[{}]).map((cells,i)=>({id:`${id}-${i}`,cells:Object.fromEntries(columns.map(([key])=>[key,cells[key]||'']))})),
});
const questions=(id:string,items:[string,string[]?][]):SafetyBlock=>({type:'questions',id,title:'Project requirements',rows:items.map(([label,options],i)=>({id:`${id}-${i}`,label,options:options||['Yes','No'],value:'',notes:''}))});
const steps=(id:string,title:string,values:[string,string][]):SafetySteps=>({type:'steps',id,title,rows:values.map(([title,body],i)=>({id:`${id}-${i}`,title,body}))});
const applicable:[string,string[]]=['Project requirement',['Applicable','Not applicable']];
const contactColumns:[string,string,number][]=[['role','Title / role',1],['name','Name',1],['phone','Phone',1],['email','Email',1.45]];

export function structuredSafetyPages():SafetyPage[] {
 const legacy=standardSafetyPages();
 const old=(id:string)=>legacy.find(p=>p.id===id)!;
 const value=(id:string,index:number)=>old(id).fields[index]?.value||'';
 const page=(id:string,title:string,blocks:SafetyBlock[],fields=old(id)?.fields||[]):SafetyPage=>({id,layoutKey:id,kind:'section',title,included:true,fields:structuredClone(fields),blocks});
 const extra=(id:string,label:string,value='')=>({id,label,value,multiline:true});
 const lockout=standardProcedure('lockout')!.fields[1].value.split('\n').map(line=>line.replace(/^\d+\.\s*/,''));
 const responsibilities=value('roles',0).split('\n').map(line=>{const colon=line.indexOf(':');return {role:line.slice(0,colon),name:'',company:'',responsibilities:line.slice(colon+1).trim()};});
 return [
  page('scope','Specific location of project',[
   table('work-areas','Work areas and access',[['floor','Floor / level',1],['area','Room / work area',1.4],['location','Location / access restrictions',2]],[]),
  ]),
  page('work','Description of work',[
   table('work-scope','Work by area or phase',[['area','Area / phase',1],['tasks','Work steps (one per line)',2.6],['trade','Responsible trade',1.2]],[]),
  ],[extra('work-closeout','Demobilization and closeout','Remove temporary protection when authorized, remove remaining waste and leave work areas clean. Confirm any reinstatement and handover requirements with the client.')]),
  page('contacts','Contact names and numbers',[
   table('contractor-contacts','JGC / contractor contacts',contactColumns,[{role:'Project manager'},{role:'Site supervisor'},{role:'Safety coordinator'}]),
   table('client-contacts','Client / facility contacts',contactColumns,[{role:'Project manager'},{role:'Property / facility manager'},{role:'Health and safety representative'}]),
   table('trade-contacts','Subcontractor contacts',[['company','Company / trade',1.3],['name','Contact name',1],['phone','Phone',1],['email','Email',1.4]]),
  ],[]),
  page('roles','Roles and responsibilities',[
   table('responsibilities','Assigned roles',[['role','Title / role',1],['name','Name / company',1.2],['responsibilities','Responsibilities',3]],responsibilities),
  ],old('roles').fields.slice(1)),
  page('ppe','Personal protective equipment',[
   {type:'checklist',id:'ppe-equipment',title:'PPE and site equipment requirements',rows:[
    'Safety glasses','Hard hat','Face shield','Safety footwear','Gloves','Supplementary lighting','Warning signs','Barricades','Non-sparking tools','Explosion-proof equipment','Safety harness / fall protection','Lifeline','Tripod / rescue equipment','Two-way radio / phone','Respirators','Hearing protection','Protective clothing','Mechanical ventilation','Shower / eyewash','Self-contained breathing apparatus','Ground-fault protection','Ladder / lift / scaffold','Other equipment',
   ].map((label,i)=>({id:`ppe-${i}`,label,value:'',notes:''}))},
   table('extinguishers','Fire extinguishers',[['type','Type',1],['size','Size / rating',1],['quantity','Quantity',.7],['location','Location',2]]),
  ]),
  page('noise','Noise mitigation plan',[
   questions('noise-questions',[applicable,['Powder-actuated tools required'],['Power tools required'],['Heavy equipment required'],['Generators required']]),
   table('noise-controls','Noise / vibration sources and controls',[['activity','Activity / source',1.2],['area','Affected area / people',1.2],['controls','Controls / permitted hours',2.2]]),
  ]),
  page('dust','Dust mitigation plan',[
   questions('dust-questions',[applicable,['System bypass required'],['Demolition work required'],['Silica work required'],['Asbestos / designated substances present'],['Fire watch required']]),
   steps('dust-plan','Dust control procedure',[
    ['Dust suppression during work',value('dust',1).split('\n')[1]],
    ['Material handling and storage','Cover or contain dust-generating materials. Agree staging and transport routes away from occupied areas; use off-site or enclosed cutting where appropriate.'],
    ['Cleanup and housekeeping',value('dust',2)],
    ['Containment and area protection',value('dust',1).split('\n')[2]],
    ['Designated substances / specialist work',value('dust',1).split('\n')[0]],
    ['Monitoring, training and worker protection',value('dust',1).split('\n')[3]],
    ['Silica exposure controls','Record the task-specific exposure control plan, source controls, access restrictions, monitoring and respiratory protection arrangements for the assessed work. Review changes with affected workers.'],
   ]),
   table('dust-site','Site-specific dust arrangements',[['task','Task / material',1],['controls','Method / containment / monitoring',2.5],['responsible','Responsible person / specialist',1.5]]),
  ],[old('dust').fields[0]]),
  page('locates','Locates and scanning requirements',[
   questions('locate-questions',[applicable,['Utility locates required'],['Concrete / floor scanning required'],['Service isolation required']]),
   table('locate-records','Locate and scanning records',[['area','Area / service',1],['provider','Provider',1],['reference','Report / attachment reference',1.4],['date','Date / validity / limits',1.3],['release','Authorization before work',1.5]]),
  ],[...old('locates').fields,extra('locates-reason','If not applicable, explain why')]),
  page('logistics','Site plan, logistics and traffic control',[
   table('site-legend','Site plan legend and locations',[['item','Feature / map marker',1.5],['location','Location / arrangements',2.5]],[
    {item:'Work limits / project area'},{item:'Site entrance / access'},{item:'Emergency exits'},{item:'Muster point'},{item:'Job Board / first aid / eyewash'},{item:'Fire extinguishers'},{item:'Washrooms / welfare facilities'},{item:'Parking / deliveries / material storage'},{item:'Waste bins / disposal route'},
   ]),
  ]),
  page('waste','Waste and material storage',[
   table('waste-plan','Waste arrangements',[['type','Waste stream',1.1],['location','Collection location',1.2],['route','Removal route / frequency',1.7],['disposal','Disposal / responsible party',1.5]]),
   table('storage-plan','Material storage',[['material','Material',1],['location','Storage location',1.2],['controls','Labelling / storage controls',2],['responsible','Responsible person',1.2]]),
  ]),
  page('fire','Fire protection plan',[
   questions('fire-questions',[applicable,['System bypass required'],['Hot work required'],['Fire watch required']]),
   table('hot-work','Hot work and fire-watch arrangements',[['activity','Spark-generating work / area',1.5],['permit','Permit / authorization',1.3],['watch','Fire watch / monitoring period',1.7],['equipment','Equipment / location',1.5]]),
   steps('fire-plan','Fire protection procedure',[
    ['Fire prevention measures',value('fire',0)],['Hot work controls',value('fire',1)],
    ['Firefighting equipment','Confirm the extinguisher types, ratings, quantities and locations in the PPE / site equipment schedule. Keep equipment accessible and tell workers where it is.'],
    ['Emergency response','Explain alarms, evacuation routes, emergency contacts and muster arrangements during orientation. Follow the Emergency response plan in this document.'],
    ['Housekeeping and combustible waste','Keep exits clear, remove unnecessary combustible waste and store flammable products according to the SDS and site arrangements.'],
    ['Monitoring and review','Inspect fire controls and equipment, record deficiencies and correct them before affected work starts. Follow the permit and site monitoring requirements.'],
   ]),
  ],[extra('fire-site','Additional site fire requirements')]),
  page('controls','Control measures and safe work procedures',[
   table('control-measures','Task controls',[['activity','Task / activity',1.2],['hazards','Potential hazards',1.4],['controls','Required action / procedure',2.5],['responsible','Responsible person',1.1]]),
   questions('isolation-questions',[['Lockout / tagout required',['Yes','No']]]),
   steps('isolation-plan','Lockout / tagout procedure (when required)',lockout.map((body,i)=>[['Notify and identify','Shut down and isolate','Apply personal locks and tags','Control stored energy','Verify isolation','Maintain isolation','Prepare to restore','Restore and notify'][i],body] as [string,string])),
  ],[extra('controls-site','Additional site control measures')]),
  page('sds','Controlled products and safety data sheets',[
   table('product-register','Hazardous product / SDS register',[['product','Product / supplier',1.2],['use','Use / area',1],['sds','SDS date / location',1.2],['controls','Handling / storage controls',2]]),
   steps('sds-procedure','SDS management',[
    ['Collect and review current SDS',value('sds',1).split('\n')[0]],
    ['Make information accessible',value('sds',1).split('\n')[1]],
    ['Worker awareness and subcontractor coordination',value('sds',1).split('\n')[2]],
    ['Updates and maintenance',value('sds',1).split('\n')[3]],
    ['Emergency use','Make SDS first aid, firefighting and spill information available to those responding to an incident. Identify the product and provide the current information to emergency responders.'],
   ]),
  ],[extra('sds-location','Site SDS binder / digital access location')]),
  page('emergency','Emergency response and evacuation',[
   table('first-aiders','Qualified first aid personnel',[['name','Name',1],['phone','Phone',1],['qualification','Qualification / expiry',1.3],['coverage','Coverage / shift',1.3]]),
   table('first-aid-equipment','First aid and emergency equipment',[['type','Equipment',1.2],['location','Location',1.7],['inspection','Inspection / responsible person',1.8]],[{type:'First aid kit'},{type:'Eyewash'},{type:'AED (if required)'}]),
   table('emergency-events','Foreseeable emergencies and response',[['event','Emergency event',1.3],['response','Site response / responsible person',2.7]],[
    {event:'Medical emergency / injury'},{event:'Fire / smoke'},{event:'Hazardous material spill / release'},{event:'Severe weather'},{event:'Structural failure / equipment incident'},{event:'Workplace violence / security threat'},
   ]),
  ],[
   old('emergency').fields[0],old('emergency').fields[1],extra('hospital-phone','Hospital phone'),old('emergency').fields[5],
   extra('medical-arrangements','Medical aid and transport arrangements'),old('emergency').fields[2],old('emergency').fields[4],
   extra('emergency-alarm','Alarm method and person directing emergency responders'),old('emergency').fields[3],
  ]),
  {...page('hazards','Site hazard assessment',[
   table('hazard-register','Hazards, risks and controls',[['activity','Task / area',1],['hazard','Hazard / who may be harmed',1.5],['risk','Risk before / after controls',1.2],['controls','Controls / responsible person',2.3]]),
  ]),included:false},
 ];
}
