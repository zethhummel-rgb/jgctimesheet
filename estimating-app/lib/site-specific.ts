import type { Job } from './estimator-data';
import { standardSafetyPages, standardProcedure } from './site-specific-content';
import { structuredSafetyPages } from './site-specific-structure';
export type SafetyField = { id: string; label: string; value: string; multiline?: boolean };
export type SafetyTable = { type:'table'; id:string; title:string; columns:{id:string;label:string;weight?:number}[]; rows:{id:string;cells:Record<string,string>}[] };
export type SafetyQuestions = { type:'questions'; id:string; title:string; rows:{id:string;label:string;options:string[];value:string;notes:string}[] };
export type SafetyChecklist = { type:'checklist'; id:string; title:string; rows:{id:string;label:string;value:string;notes:string}[] };
export type SafetySteps = { type:'steps'; id:string; title:string; rows:{id:string;title:string;body:string}[] };
export type SafetyBlock = SafetyTable | SafetyQuestions | SafetyChecklist | SafetySteps;
export type SafetyPage = { id: string; kind: 'section'|'task'|'procedure'|'risk'|'custom'; title: string; included: boolean; fields: SafetyField[]; layoutKey?:string; blocks?:SafetyBlock[]; illustrations?:SafetyIllustration[] };
export type SafetyLibraryPage = SafetyPage & { savedAt: string; savedBy: string; jobNumber: string };
export type SafetyAttachment = { id: string; kind: 'certificate'|'board'; title: string; included: boolean; fileName: string; fileType?: string; filePath?: string; boardId?: string; documentId?: string; category?: string; expiryDate?: string };
export type SafetyIllustration = SafetyAttachment & { caption?:string };
export interface SiteSpecificPlan { version: 1; project: string; jobNumber: string; address: string; client: string; preparedBy: string; planDate: string; revision: string; pages: SafetyPage[]; attachments: SafetyAttachment[]; hospitalMap?: SafetyAttachment; visibility: 'public'|'restricted'; updatedAt: string; published?: {documentId: string; at: string; revision: string; updatedAt: string} }
export function sitePlanDate() { const p = new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()); return ['year','month','day'].map(k=>p.find(x=>x.type===k)?.value).join('-'); }
export const safetyId = () => crypto.randomUUID();
export function createSitePlan(job:Job,author:string):SiteSpecificPlan {
 const pages=structuredSafetyPages();
 const contacts=pages.find(p=>p.id==='contacts')!.blocks!.find(b=>b.id==='contractor-contacts');
 if(contacts?.type==='table')contacts.rows[0].cells.name=job.projectManager||author;
 return {version:1,project:job.portalJobName||job.project,jobNumber:job.jobNumber,address:job.portalAddress||'',client:job.portalCustomer||'',preparedBy:author,planDate:sitePlanDate(),revision:'1',pages,attachments:[],visibility:'public',updatedAt:''};
}
// Explicit, additive upgrade. Never interpret a legacy paragraph as a person,
// a Yes/No decision or an approved control; preserve it alongside the new inputs.
export function addStructuredSafetyContent(plan:SiteSpecificPlan) {
 const defaults=structuredSafetyPages();let blocksAdded=0,pagesAdded=0,fieldsAdded=0;
 const pages=plan.pages.map(page=>{
  const standard=defaults.find(p=>p.id===(page.layoutKey||page.id));if(!standard)return page;
  const blocks=[...(page.blocks||[])],fields=[...page.fields];
  for(const b of standard.blocks||[])if(!blocks.some(x=>x.id===b.id)){blocks.push(structuredClone(b));blocksAdded++;}
  for(const f of standard.fields)if(!fields.some(x=>x.id===f.id)){fields.push({...f});fieldsAdded++;}
  return {...page,layoutKey:standard.id,blocks,fields};
 });
 for(const p of defaults)if(!pages.some(x=>(x.layoutKey||x.id)===p.id)){pages.push(p);pagesAdded++;}
 return {plan:{...plan,pages},blocksAdded,pagesAdded,fieldsAdded};
}
export function pageHasContent(page:SafetyPage) {
 return page.fields.some(f=>f.value.trim()) || (page.illustrations||[]).length>0 || (page.blocks||[]).some(b=>b.type==='table'?b.rows.some(r=>Object.values(r.cells).some(v=>v.trim())):b.type==='steps'?b.rows.some(r=>r.body.trim()):b.rows.some(r=>r.value||r.notes.trim()));
}
// Existing plans change only when the administrator explicitly requests standard content.
// Keep titles, inclusion choices, ordering, entered values, map/files and publication history.
export function addStandardSafetyContent(plan:SiteSpecificPlan) {
 let fieldsAdded=0,pagesAdded=0;
 const defaults=plan.pages.some(p=>p.blocks?.length)?structuredSafetyPages():standardSafetyPages(),pages=plan.pages.map(page=>{
  const standard=defaults.find(p=>p.id===page.id);if(!standard)return page;
  const fields=page.fields.map(field=>{const value=standard.fields.find(f=>f.id===field.id)?.value;if(field.value.trim()||!value)return field;fieldsAdded++;return {...field,value};});
  for(const field of standard.fields)if(!fields.some(f=>f.id===field.id)){fields.push({...field});fieldsAdded++;}
  return {...page,fields};
 });
 for(const page of defaults)if(!pages.some(p=>p.id===page.id)){pages.push(page);pagesAdded++;fieldsAdded+=page.fields.filter(f=>f.value).length;}
 return {plan:{...plan,pages},fieldsAdded,pagesAdded};
}
export function createStandardProcedure(id:string):SafetyPage {const page=standardProcedure(id);if(!page)throw new Error('Choose a standard procedure.');return {...page,id:safetyId()};}
export function createTaskPage(kind:SafetyPage['kind']):SafetyPage {
 const id=safetyId(),fields=['Task / activity','Work steps or procedure','Hazards and risks','Controls and safe work measures','PPE, equipment and training','Person responsible / review'].map((label,index)=>({id:`field-${index}`,label,value:'',multiline:true}));
 const blocks:SafetyBlock[]=kind==='procedure'?[{type:'steps',id:'procedure-steps',title:'Procedure steps',rows:[{id:safetyId(),title:'',body:''}]}]:kind==='task'||kind==='risk'?[{type:'table',id:'task-analysis',title:kind==='risk'?'Risk assessment':'Task hazard analysis',columns:[{id:'task',label:'Task / work step',weight:1.3},{id:'hazards',label:'Potential hazards',weight:1.5},{id:'controls',label:'Required action / procedure',weight:2.5},{id:'responsible',label:'Responsible person',weight:1.2}],rows:[{id:safetyId(),cells:{task:'',hazards:'',controls:'',responsible:''}}]}]:[];
 return {id,kind,title:kind==='task'?'New task':kind==='procedure'?'New procedure':kind==='risk'?'New risk assessment':'Additional page',included:true,fields,blocks};
}
export function sitePlanErrors(plan:SiteSpecificPlan) { const errors:string[]=[]; for(const [key,label] of [['project','Project'],['jobNumber','Job number'],['address','Site address'],['preparedBy','Prepared by'],['planDate','Plan date'],['revision','Revision']] as const) if(!plan[key].trim()) errors.push(label); if(!/^\d{4}-\d{2}-\d{2}$/.test(plan.planDate)||Number.isNaN(Date.parse(plan.planDate+'T12:00:00Z'))||new Date(plan.planDate+'T12:00:00Z').toISOString().slice(0,10)!==plan.planDate)errors.push('Valid plan date'); if(!plan.pages.some(p=>p.included))errors.push('At least one plan page'); if(plan.pages.some(p=>p.included&&!p.title.trim()))errors.push('Page titles'); return [...new Set(errors)]; }
export function sitePlanFileName(plan:SiteSpecificPlan) {return `JGC-Site-Specific-${plan.jobNumber}-Rev-${plan.revision}.pdf`.replace(/[<>:"/\\|?*\x00-\x1f]/g,'-');}
