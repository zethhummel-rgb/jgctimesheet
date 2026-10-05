import type { Job } from './estimator-data';
export type SafetyField = { id: string; label: string; value: string; multiline?: boolean };
export type SafetyPage = { id: string; kind: 'section'|'task'|'procedure'|'risk'|'custom'; title: string; included: boolean; fields: SafetyField[] };
export type SafetyLibraryPage = SafetyPage & { savedAt: string; savedBy: string; jobNumber: string };
export type SafetyAttachment = { id: string; kind: 'certificate'|'board'; title: string; included: boolean; fileName: string; fileType?: string; filePath?: string; boardId?: string; documentId?: string; category?: string; expiryDate?: string };
export interface SiteSpecificPlan { version: 1; project: string; jobNumber: string; address: string; client: string; preparedBy: string; planDate: string; revision: string; pages: SafetyPage[]; attachments: SafetyAttachment[]; visibility: 'public'|'restricted'; updatedAt: string; published?: {documentId: string; at: string; revision: string; updatedAt: string} }
export function sitePlanDate() { const p = new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()); return ['year','month','day'].map(k=>p.find(x=>x.type===k)?.value).join('-'); }
export const safetyId = () => crypto.randomUUID();
const section=(id:string,title:string,labels:string[],included=true):SafetyPage=>({id,kind:'section',title,included,fields:labels.map((label,index)=>({id:`${id}-${index}`,label,value:'',multiline:true}))});
export function createSitePlan(job:Job,author:string):SiteSpecificPlan {
 const pages=[
 section('scope','Project location and scope',['Scope of work','Work areas and access','Schedule and working hours','Site-specific requirements']),
 section('contacts','Client and contractor contacts',['Client / site contact and phone','JGC project manager and phone','Site supervisor and phone','First aid personnel and phone','Subcontractor contacts']),
 section('roles','Roles and communication',['Site responsibilities','Orientation and daily safety briefings','Reporting hazards and incidents','Communication with client and contractors']),
 section('hazards','Site hazard assessment',['Activities and site hazards','Risk assessment','Control measures','Required training and permits']),
 section('ppe','Personal protective equipment',['Required site PPE','Additional PPE by activity']),
 section('emergency','Emergency response and evacuation',['Emergency phone number','Nearest hospital and address','First aid supplies and equipment','Fire response and evacuation procedure','Muster point and site access for emergency services']),
 section('logistics','Site layout and traffic',['Site layout and access routes','Public and vehicle separation','Deliveries, storage and pedestrian controls'],false),
 section('noise','Noise and vibration',['Noise / vibration sources','Exposure controls and communication'],false),
 section('dust','Dust management',['Dust-generating activities','Containment and exposure controls','Housekeeping and monitoring'],false),
 section('locates','Locates and utilities',['Services / utility locations','Locate records and isolation procedures'],false),
 section('waste','Waste and environmental controls',['Waste handling and disposal','Spill prevention and response'],false),
 section('fire','Fire prevention and hot work',['Fire prevention measures','Hot work permits and fire watch'],false),
 section('sds','Safety data sheets',['Products and hazardous materials','SDS locations and handling controls'],false),
 ];
 pages[1].fields[1].value=job.projectManager||author;
 pages[5].fields[0].value='911';
 return {version:1,project:job.portalJobName||job.project,jobNumber:job.jobNumber,address:job.portalAddress||'',client:job.portalCustomer||'',preparedBy:author,planDate:sitePlanDate(),revision:'1',pages,attachments:[],visibility:'public',updatedAt:''};
}
export function createTaskPage(kind:SafetyPage['kind']):SafetyPage {return {id:safetyId(),kind,title:kind==='task'?'New task':kind==='procedure'?'New procedure':kind==='risk'?'New risk assessment':'Additional page',included:true,fields:['Task / activity','Work steps or procedure','Hazards and risks','Controls and safe work measures','PPE, equipment and training','Person responsible / review'].map((label,index)=>({id:`field-${index}`,label,value:'',multiline:true}))};}
export function sitePlanErrors(plan:SiteSpecificPlan) { const errors:string[]=[]; for(const [key,label] of [['project','Project'],['jobNumber','Job number'],['address','Site address'],['preparedBy','Prepared by'],['planDate','Plan date'],['revision','Revision']] as const) if(!plan[key].trim()) errors.push(label); if(!/^\d{4}-\d{2}-\d{2}$/.test(plan.planDate)||Number.isNaN(Date.parse(plan.planDate+'T12:00:00Z'))||new Date(plan.planDate+'T12:00:00Z').toISOString().slice(0,10)!==plan.planDate)errors.push('Valid plan date'); if(!plan.pages.some(p=>p.included))errors.push('At least one plan page'); if(plan.pages.some(p=>p.included&&!p.title.trim()))errors.push('Page titles'); return [...new Set(errors)]; }
export function sitePlanFileName(plan:SiteSpecificPlan) {return `JGC-Site-Specific-${plan.jobNumber}-Rev-${plan.revision}.pdf`.replace(/[<>:"/\\|?*\x00-\x1f]/g,'-');}
