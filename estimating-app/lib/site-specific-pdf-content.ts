import { sitePlanTemplateChoices, sitePlanTemplate } from './site-specific-plan-templates';
import {safetyTextPlain} from './site-specific-rich-text';
import type { SafetyAttachment, SafetyBlock, SafetyPage, SiteSpecificPlan } from './site-specific';
import { structuredSafetyPages } from './site-specific-structure';

const filled = (value: string) => Boolean(safetyTextPlain(value).trim());

// A default contact role or map legend label is a prompt, not a completed row.
// Reusable procedure/responsibility text is real plan content and stays in the PDF.
const tablePrompts = new Map<string, Set<string>>();
for (const page of [...structuredSafetyPages(), ...sitePlanTemplateChoices.map(choice=>sitePlanTemplate(choice.id)!)]) {
  for (const block of page.blocks || []) {
    if (block.type !== 'table') continue;
    const prompts = new Set<string>();
    for (const row of block.rows) {
      const values = block.columns.filter(column => filled(row.cells[column.id] || ''));
      if (values.length === 1) {
        const column = values[0];
        prompts.add(JSON.stringify([column.id, safetyTextPlain(row.cells[column.id]).trim()]));
      }
    }
    if (prompts.size) tablePrompts.set(block.id, prompts);
  }
}

function pdfBlock(block: SafetyBlock): SafetyBlock | undefined {
  if (block.type === 'table') {
    const rows = block.rows.filter(row => {
      const values = block.columns.filter(column => filled(row.cells[column.id] || ''));
      if (!values.length) return false;
      if (values.length !== 1) return true;
      const column = values[0];
      return !tablePrompts.get(block.id)?.has(JSON.stringify([column.id, safetyTextPlain(row.cells[column.id]).trim()]));
    });
    if (!rows.length) return;
    const columns = block.columns.filter(column => rows.some(row => filled(row.cells[column.id] || '')));
    return { ...block, columns, rows };
  }
  if (block.type === 'steps') {
    const rows = block.rows.filter(row => filled(row.body));
    return rows.length ? { ...block, rows } : undefined;
  }
  if (block.type === 'questions') {
    const rows = block.rows.filter(row => filled(row.value) || filled(row.notes));
    return rows.length ? { ...block, rows } : undefined;
  }
  const rows = block.rows.filter(row => filled(row.value) || filled(row.notes));
  return rows.length ? { ...block, rows } : undefined;
}

// Build an output-only view. Blank fields and inclusion choices remain saved
// exactly as entered so the next editor session can fill them in.
export function siteSpecificPdfPages(plan: SiteSpecificPlan): SafetyPage[] {
  return plan.pages.filter(page => page.included).map(page => ({
    ...page,
    fields: page.fields.filter(field => filled(field.value)),
    blocks: (page.blocks || []).map(pdfBlock).filter((block): block is SafetyBlock => Boolean(block)),
    illustrations: (page.illustrations || []).filter(item => item.included),
  })).filter(page => page.fields.length || page.blocks.length || page.illustrations.length ||
    (page.id === 'emergency' && plan.hospitalMap?.included));
}


export type SafetyAppendix = {number:number;title:string;items:SafetyAttachment[]};
// One shared, output-only order for the editor contents and the combined PDF.
// JSA and certificate groups keep complete originals; other attachments follow.
export function siteSpecificAppendices(plan:SiteSpecificPlan,pages=siteSpecificPdfPages(plan)):SafetyAppendix[] {
 const inlineIds=new Set(pages.flatMap(page=>(page.illustrations||[]).map(item=>item.id)));
 if(plan.hospitalMap?.included&&pages.some(page=>page.id==='emergency'))inlineIds.add(plan.hospitalMap.id);
 const selected=[...new Map(plan.attachments.filter(item=>item.included&&!inlineIds.has(item.id)).map(item=>[item.id,item])).values()];
 const jsas=selected.filter(item=>item.kind!=='certificate'&&item.category==='jsa'),certificates=selected.filter(item=>item.kind==='certificate');
 const groups:{title:string;items:SafetyAttachment[]}[]=[];
 if(jsas.length)groups.push({title:'JSA',items:jsas});
 if(certificates.length)groups.push({title:'Certificates',items:certificates});
 groups.push(...selected.filter(item=>item.kind!=='certificate'&&item.category!=='jsa').map(item=>({title:item.title,items:[item]})));
 const rank=new Map((plan.documentOrder||[]).map((key,index)=>[key,index]));
 const key=(group:{items:SafetyAttachment[]})=>group.items[0].kind==='certificate'?'appendix:certificates':group.items[0].category==='jsa'?'appendix:jsa':'attachment:'+group.items[0].id;
 groups.sort((a,b)=>(rank.get(key(a))??Number.MAX_SAFE_INTEGER)-(rank.get(key(b))??Number.MAX_SAFE_INTEGER));
 return groups.map((group,index)=>({...group,number:index+1}));
}

// Stable keys keep saved plans compatible as sections/files are added or excluded.
export function siteSpecificDocumentOrder(plan:SiteSpecificPlan,pages=siteSpecificPdfPages(plan)) {
 const entries=[...pages.map(page=>({key:'page:'+page.id,title:page.title,page,appendix:undefined as SafetyAppendix|undefined})),
 ...siteSpecificAppendices(plan,pages).map(appendix=>({key:appendix.items[0].kind==='certificate'?'appendix:certificates':appendix.items[0].category==='jsa'?'appendix:jsa':'attachment:'+appendix.items[0].id,title:appendix.title,page:undefined as SafetyPage|undefined,appendix}))];
 const rank=new Map((plan.documentOrder||[]).map((key,index)=>[key,index]));
 return entries.sort((a,b)=>(rank.get(a.key)??Number.MAX_SAFE_INTEGER)-(rank.get(b.key)??Number.MAX_SAFE_INTEGER));
}
export function moveSiteSpecificDocument(plan:SiteSpecificPlan,key:string,delta:number):SiteSpecificPlan {
 const entries=siteSpecificDocumentOrder(plan,plan.pages),index=entries.findIndex(item=>item.key===key),next=index+delta;
 if(index<0||next<0||next>=entries.length)return plan;
 [entries[index],entries[next]]=[entries[next],entries[index]];
 const documentOrder=entries.map(item=>item.key),rank=new Map(documentOrder.map((key,index)=>[key,index]));
 return {...plan,documentOrder,pages:[...plan.pages].sort((a,b)=>rank.get('page:'+a.id)!-rank.get('page:'+b.id)!)};
}
