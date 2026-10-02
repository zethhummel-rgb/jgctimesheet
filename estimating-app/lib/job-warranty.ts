import type { AppState, Job } from './estimator-data';

// Keep template v1 and its versioned assets available for historical PDFs.
export const warrantyTemplateV1 = {
  coverage: 'The company will repair, at their expense, any defects as a result of faulty workmanship for a period of one (1) year commencing thirty days after the above date of completion.',
  introduction: 'The warranty is given and accepted on the following conditions:',
  conditions: [
    'The Owner shall notify the Company immediately in writing and if repairs are to be made under this warranty, the Owner shall allow for reasonable time to effect such repairs. Such repairs are to be made during normal working hours by our forces.',
    'Neither this warranty nor the contract for the project completed shall render the Company liable in any way for any damage to the above described building or to any contents thereof. Acceptance of this warranty shall constitute conclusive evidence that he does not hold the Company liable for any damage to said building or any contents, thereof, notwithstanding anything to the contrary contained in any agreement, written or oral, for the completed project',
    'No responsibility or liability is assumed in respect of repairs made necessary by: gale, hurricane, tornado, hail, lightening or other phenomena of the elements or other hazards which may cause damage to the exterior, interior or contents of said building or structure; inadequate design or specification; settling of the building or distortion or failure of the buildings foundations, walls; nor damage caused during or after the applications thereof by other persons working or being on said project.',
    'This warranty will be cancelled automatically if the project is altered by attachments made thereto or if the building is used for any purpose than originally designed without the prior written approval of the Company.',
    'This warranty is given expressly in lieu of any other guarantees or warranties expressed or implied including any implied warrant of merchantability, quality, or fitness for a particular purpose.',
    'Complete payment to the Company for the above work is a condition precedent to this warranty taking effect.',
    'This warranty does not warrant any materials or design or methods specified by the Owner, his Architect or their Agent.',
  ],
  acceptance: 'We confirm the above project to be in good condition, as of the date below and accept this warranty as the full extent of the Contractors liability.',
};
export interface WarrantyFields {
  owner: string;
  building: string;
  location: string;
  project: string;
  completionDate: string;
  issueDate: string;
  ownerOfficial: string;
  ownerDate: string;
}
export interface WarrantyRevision {
  id: string;
  number: number;
  templateVersion: 1;
  fields: WarrantyFields;
  lockedAt: string;
  lockedBy: string;
  filename: string;
}
export interface JobWarranty {
  templateVersion: 1;
  revision: number;
  status: 'Draft' | 'Locked';
  fields: WarrantyFields;
  updatedAt: string;
  updatedBy: string;
  revisions: WarrantyRevision[];
}
export const warrantyFieldLimits: Record<keyof WarrantyFields, number> = {owner:260,building:180,location:500,project:260,completionDate:10,issueDate:10,ownerOfficial:180,ownerDate:10};
export function warrantyToday() {
  const d=new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
export function warrantyDateValid(v:string) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(v))return false;
  const d=new Date(v+'T12:00:00');
  return Number.isFinite(d.getTime()) && d.getFullYear()>=1900 && d.getFullYear()<=2200 && `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`===v;
}
export function warrantyDate(v:string) {
  if(!warrantyDateValid(v))return '';
  const d=new Date(v+'T12:00:00'),day=d.getDate(),suffix=day%100>=11&&day%100<=13?'th':day%10===1?'st':day%10===2?'nd':day%10===3?'rd':'th';
  return `${d.toLocaleDateString('en-CA',{month:'long'})} ${day}${suffix}, ${d.getFullYear()}`;
}
export function warrantyDefaults(job:Job,state:AppState):WarrantyFields {
  const client=state.clients.find(c=>c.id===job.clientId),quote=state.quotes.find(q=>q.id===job.quoteId);
  return {owner:job.portalCustomer||client?.name||'',building:job.portalSiteName||quote?.site||'',location:job.portalAddress||quote?.address||'',project:job.project||job.portalJobName||'',completionDate:'',issueDate:warrantyToday(),ownerOfficial:'',ownerDate:''};
}
export function createWarranty(fields:WarrantyFields,actor:string):JobWarranty {
  return {templateVersion:1,revision:0,status:'Draft',fields:structuredClone(fields),updatedAt:new Date().toISOString(),updatedBy:actor,revisions:[]};
}
export function warrantyFieldErrors(fields:WarrantyFields,required=true) {
  const errors:Partial<Record<keyof WarrantyFields,string>>={};
  for(const key of Object.keys(warrantyFieldLimits) as (keyof WarrantyFields)[]) {
    if(typeof fields[key]!=='string'||fields[key].length>warrantyFieldLimits[key])errors[key]='This field is too long.';
  }
  if(required)for(const key of ['owner','location','project'] as const)if(!fields[key]?.trim())errors[key]='Enter this information before downloading.';
  for(const key of ['completionDate','issueDate','ownerDate'] as const)if((required&&key!=='ownerDate')||fields[key])if(!warrantyDateValid(fields[key]))errors[key]='Enter a valid date.';
  return errors;
}
export function warrantyFilename(client:string,project:string) {
  return cleanWarrantyFilename(`${client.trim()||'Client'} - ${project.trim()||'Job'} - JGC Warranty.pdf`);
}
export function cleanWarrantyFilename(value:string) {
  const name=value.trim().replace(/\.pdf$/i,'').replace(/[<>:"/\\|?*\u0000-\u001f]/g,'-').replace(/[. ]+$/g,'').slice(0,180);
  return `${name||'JGC Warranty'}.pdf`;
}
export function lockWarranty(value:JobWarranty,actor:string,filename:string):JobWarranty {
  if(value.status!=='Draft')throw new Error('This warranty is already locked.');
  if(Object.keys(warrantyFieldErrors(value.fields)).length)throw new Error('Complete the warranty information before locking.');
  const at=new Date().toISOString(),record:WarrantyRevision={id:crypto.randomUUID(),number:value.revision,templateVersion:value.templateVersion,fields:structuredClone(value.fields),lockedAt:at,lockedBy:actor,filename:cleanWarrantyFilename(filename)};
  return {...value,status:'Locked',updatedAt:at,updatedBy:actor,revisions:[...value.revisions,record]};
}
export function reopenWarranty(value:JobWarranty,actor:string):JobWarranty {
  if(value.status!=='Locked')throw new Error('This warranty is already editable.');
  return {...value,fields:structuredClone(value.fields),revision:value.revision+1,status:'Draft',updatedAt:new Date().toISOString(),updatedBy:actor};
}
export function warrantyPersistenceError(base:{jobs:{id:string;warranty?:JobWarranty}[]}|null,next:{jobs:{id:string;warranty?:JobWarranty}[]}) {
  const conflict='This warranty changed in another browser. Copy any unsaved information, then refresh before editing or locking it.';
  for(const previous of base?.jobs??[])if(previous.warranty&&!next.jobs.some(j=>j.id===previous.id))return 'Keep the job and its warranty history.';
  for(const job of next.jobs) {
    const old=base?.jobs.find(j=>j.id===job.id)?.warranty,value=job.warranty;
    if(JSON.stringify(old)===JSON.stringify(value))continue;
    if(!value||value.templateVersion!==1||!Number.isInteger(value.revision)||value.revision<0||!['Draft','Locked'].includes(value.status)||!value.fields||!Array.isArray(value.revisions))return 'A complete warranty revision is required.';
    if(Object.keys(warrantyFieldErrors(value.fields,value.status==='Locked')).length)return 'Correct the warranty fields before saving.';
    const oldHistory=old?.revisions??[];
    if(JSON.stringify(value.revisions.slice(0,oldHistory.length))!==JSON.stringify(oldHistory))return 'Locked warranty history must remain unchanged.';
    if(value.revisions.length!==value.revision+(value.status==='Locked'?1:0))return 'Keep every locked warranty revision.';
    for(let i=0;i<value.revisions.length;i++) {
      const r=value.revisions[i];
      if(r.number!==i||r.templateVersion!==1||!r.id||!r.lockedAt||!r.lockedBy||!r.fields||Object.keys(warrantyFieldErrors(r.fields)).length)return 'A complete locked warranty record is required.';
    }
    if(!old&&value.revision!==0)return conflict;
    if(old&&value.revision!==old.revision+(old.status==='Locked'?1:0))return conflict;
    if(value.status==='Draft'&&value.revisions.length!==oldHistory.length)return 'Locked warranty history must remain unchanged.';
    if(value.status==='Locked') {
      if(value.revisions.length!==oldHistory.length+1)return conflict;
      if(JSON.stringify(value.revisions.at(-1)?.fields)!==JSON.stringify(value.fields))return 'The locked warranty must match its saved history.';
    }
  }
  return '';
}
