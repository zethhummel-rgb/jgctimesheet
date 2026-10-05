import type { Job } from './estimator-data';
import { standardSafetyPages, standardProcedure } from './site-specific-content';
export type SafetyField = { id: string; label: string; value: string; multiline?: boolean };
export type SafetyPage = { id: string; kind: 'section'|'task'|'procedure'|'risk'|'custom'; title: string; included: boolean; fields: SafetyField[] };
export type SafetyLibraryPage = SafetyPage & { savedAt: string; savedBy: string; jobNumber: string };
export type SafetyAttachment = { id: string; kind: 'certificate'|'board'; title: string; included: boolean; fileName: string; fileType?: string; filePath?: string; boardId?: string; documentId?: string; category?: string; expiryDate?: string };
export interface SiteSpecificPlan { version: 1; project: string; jobNumber: string; address: string; client: string; preparedBy: string; planDate: string; revision: string; pages: SafetyPage[]; attachments: SafetyAttachment[]; hospitalMap?: SafetyAttachment; visibility: 'public'|'restricted'; updatedAt: string; published?: {documentId: string; at: string; revision: string; updatedAt: string} }
export function sitePlanDate() { const p = new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()); return ['year','month','day'].map(k=>p.find(x=>x.type===k)?.value).join('-'); }
export const safetyId = () => crypto.randomUUID();
export function createSitePlan(job:Job,author:string):SiteSpecificPlan {
 const pages=standardSafetyPages();
 pages[1].fields[1].value=job.projectManager||author;
 pages[5].fields[0].value='911';
 return {version:1,project:job.portalJobName||job.project,jobNumber:job.jobNumber,address:job.portalAddress||'',client:job.portalCustomer||'',preparedBy:author,planDate:sitePlanDate(),revision:'1',pages,attachments:[],visibility:'public',updatedAt:''};
}
// Existing plans change only when the administrator explicitly requests standard content.
// Keep titles, inclusion choices, ordering, entered values, map/files and publication history.
export function addStandardSafetyContent(plan:SiteSpecificPlan) {
 let fieldsAdded=0,pagesAdded=0;
 const defaults=standardSafetyPages(),pages=plan.pages.map(page=>{
  const standard=defaults.find(p=>p.id===page.id);if(!standard)return page;
  const fields=page.fields.map(field=>{const value=standard.fields.find(f=>f.id===field.id)?.value;if(field.value.trim()||!value)return field;fieldsAdded++;return {...field,value};});
  for(const field of standard.fields)if(!fields.some(f=>f.id===field.id)){fields.push({...field});fieldsAdded++;}
  return {...page,fields};
 });
 for(const page of defaults)if(!pages.some(p=>p.id===page.id)){pages.push(page);pagesAdded++;fieldsAdded+=page.fields.filter(f=>f.value).length;}
 return {plan:{...plan,pages},fieldsAdded,pagesAdded};
}
export function createStandardProcedure(id:string):SafetyPage {const page=standardProcedure(id);if(!page)throw new Error('Choose a standard procedure.');return {...page,id:safetyId()};}
export function createTaskPage(kind:SafetyPage['kind']):SafetyPage {return {id:safetyId(),kind,title:kind==='task'?'New task':kind==='procedure'?'New procedure':kind==='risk'?'New risk assessment':'Additional page',included:true,fields:['Task / activity','Work steps or procedure','Hazards and risks','Controls and safe work measures','PPE, equipment and training','Person responsible / review'].map((label,index)=>({id:`field-${index}`,label,value:'',multiline:true}))};}
export function sitePlanErrors(plan:SiteSpecificPlan) { const errors:string[]=[]; for(const [key,label] of [['project','Project'],['jobNumber','Job number'],['address','Site address'],['preparedBy','Prepared by'],['planDate','Plan date'],['revision','Revision']] as const) if(!plan[key].trim()) errors.push(label); if(!/^\d{4}-\d{2}-\d{2}$/.test(plan.planDate)||Number.isNaN(Date.parse(plan.planDate+'T12:00:00Z'))||new Date(plan.planDate+'T12:00:00Z').toISOString().slice(0,10)!==plan.planDate)errors.push('Valid plan date'); if(!plan.pages.some(p=>p.included))errors.push('At least one plan page'); if(plan.pages.some(p=>p.included&&!p.title.trim()))errors.push('Page titles'); return [...new Set(errors)]; }
export function sitePlanFileName(plan:SiteSpecificPlan) {return `JGC-Site-Specific-${plan.jobNumber}-Rev-${plan.revision}.pdf`.replace(/[<>:"/\\|?*\x00-\x1f]/g,'-');}
