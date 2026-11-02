import {safetyPageContent,moveSafetyPageContent,removeSafetyPageContent,pageHasContent,type SafetyPage} from '../lib/site-specific';
import {safetyTextPlain} from '../lib/site-specific-rich-text';
import {SafetyBlocksEditor} from './site-specific-blocks';
import {DocumentFields} from './site-specific-entry';
export function SafetyPageContentEditor({page,onChange}:{page:SafetyPage;onChange:(page:SafetyPage)=>void}) {
 const items=safetyPageContent(page);
 return <>{items.map((item,index)=>{
  const title=safetyTextPlain(item.title).trim()||'Untitled section';
  const remove=()=>{
   const filled=pageHasContent({...page,fields:item.field?[item.field]:[],blocks:item.block?[item.block]:[],illustrations:[]});
   if(filled&&!window.confirm(`Remove "${title}" and its contents from this page? Previously published PDFs and saved library copies are kept.`))return;
   onChange(removeSafetyPageContent(page,item.key));
  };
  return <div className="ss-content-item" data-content-key={item.key} key={item.key}>
   <details className="ss-content-actions"><summary aria-label={`${title} section options`}>Section options</summary><div>
    <button type="button" className="button secondary" aria-label={`Move ${title} section up`} disabled={index===0} onClick={()=>onChange(moveSafetyPageContent(page,item.key,-1))}>Move up</button>
    <button type="button" className="button secondary" aria-label={`Move ${title} section down`} disabled={index===items.length-1} onClick={()=>onChange(moveSafetyPageContent(page,item.key,1))}>Move down</button>
    <button type="button" className="button secondary" aria-label={`Remove ${title} section`} onClick={remove}>Remove</button>
   </div></details>
   {item.block&&<SafetyBlocksEditor blocks={[item.block]} onChange={blocks=>onChange({...page,blocks:page.blocks?.map(block=>block.id===item.block!.id?blocks[0]:block)})}/>}
   {item.field&&<DocumentFields fields={[item.field]} startIndex={page.fields.findIndex(field=>field.id===item.field!.id)} onChange={fields=>onChange({...page,fields:page.fields.map(field=>field.id===item.field!.id?fields[0]:field)})}/>}
  </div>;
 })}</>;
}
