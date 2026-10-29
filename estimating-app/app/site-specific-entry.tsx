import { useEffect, useLayoutEffect, useRef, useState, type ChangeEvent, type TextareaHTMLAttributes } from 'react';
import type { SafetyField } from '../lib/site-specific';
import { safetyTextHtml, safetyTextPlain, safetyList } from '../lib/site-specific-rich-text';
let activeEditor:HTMLElement|null=null,savedRange:Range|null=null;
function remember(editor:HTMLElement){const selection=getSelection();if(selection?.rangeCount&&editor.contains(selection.anchorNode)&&editor.contains(selection.focusNode)){activeEditor=editor;savedRange=selection.getRangeAt(0).cloneRange();}}
function serialize(node:Node):string{
 if(node.nodeType===Node.TEXT_NODE)return node.textContent||'';
 if(!(node instanceof HTMLElement))return [...node.childNodes].map(serialize).join('');
 if(node.tagName==='BR')return '\n';
 let value=[...node.childNodes].map(serialize).join('');if(!value)return '';
 const tokens=(node.dataset.ssStyle||node.dataset.ssFormat||'').split(' ').filter(x=>['b','i','u','hy','hg','sm','lg','nm','sans','serif','mono'].includes(x));
 if(node.matches('b,strong')||node.style.fontWeight==='bold'||Number(node.style.fontWeight)>=600)tokens.push('b');
 if(node.matches('i,em')||node.style.fontStyle==='italic')tokens.push('i');
 if(node.tagName==='U'||node.style.textDecoration.includes('underline'))tokens.push('u');
 for(const t of [...new Set(tokens)])value='['+t+']'+value+'[/'+t+']';
 if(node.tagName==='LI'){const number=node.parentElement?.tagName==='OL'?[...node.parentElement.children].indexOf(node)+1:null;return (number?number+'. ':'\u2022 ')+value+'\n';}
 if(/^(DIV|P|UL|OL)$/.test(node.tagName)&&node.nextSibling)value+='\n';return value;
}
const editorValue=(editor:HTMLElement)=>[...editor.childNodes].map(serialize).join('').replace(/\u00a0/g,' ').replace(/\n{3,}/g,'\n\n').replace(/\n$/,'');
function format(command:string,scope:HTMLElement|null){
 const editor=activeEditor;if(!editor?.isConnected||!scope?.contains(editor)||editor.getAttribute('contenteditable')!=='true'||editor.closest('fieldset[disabled]')||!savedRange)return;
 const selection=getSelection();if(!selection)return;const restore=savedRange.cloneRange();editor.focus();try{selection.removeAllRanges();selection.addRange(restore);}catch{return;}
 const range=selection.getRangeAt(0);
 if(command==='insertUnorderedList'||command==='insertOrderedList'){
  if(range.collapsed)return;const box=document.createElement('div');box.append(range.extractContents());const template=document.createElement('template');template.innerHTML=safetyTextHtml(safetyList(editorValue(box),command==='insertOrderedList'));const nodes=[...template.content.childNodes];range.insertNode(template.content);if(nodes.length){range.setStartBefore(nodes[0]);range.setEndAfter(nodes.at(-1)!);selection.removeAllRanges();selection.addRange(range);}
 }
 else if(['bold','italic','underline','undo','redo'].includes(command))document.execCommand(command);
 else if(command==='clear'){const fragment=range.extractContents(),box=document.createElement('div');box.append(fragment);const node=document.createTextNode(safetyTextPlain(editorValue(box)));range.insertNode(node);range.selectNodeContents(node);selection.removeAllRanges();selection.addRange(range);}
 else {const span=document.createElement('span');span.dataset.ssStyle=command;
  if(command==='hy'||command==='hg'){span.style.backgroundColor=command==='hy'?'#fff2a8':'#cfecc8';span.style.color='#102018';}
  if(['sm','lg','nm'].includes(command))span.style.fontSize=(parseFloat(getComputedStyle(editor).fontSize)*(command==='sm'?.85:command==='lg'?1.3:1))+'px';
  if(['sans','serif','mono'].includes(command))span.style.fontFamily=command==='serif'?'Times New Roman,serif':command==='mono'?'Courier New,monospace':'Arial,sans-serif';
  if(range.collapsed)return;span.append(range.extractContents());range.insertNode(span);range.selectNodeContents(span);selection.removeAllRanges();selection.addRange(range);
 }
 editor.dispatchEvent(new Event('input',{bubbles:true}));remember(editor);
}
export function SiteFormattingToolbar(){
 const ref=useRef<HTMLDivElement>(null);const apply=(command:string)=>format(command,ref.current?.closest('.ss-builder')||null);
 useEffect(()=>{const focus=(event:FocusEvent)=>{const target=event.target;if(target instanceof Element&&!target.closest('[data-ss-rich-editor],.ss-format-toolbar')){activeEditor=null;savedRange=null;}};document.addEventListener('focusin',focus);return ()=>document.removeEventListener('focusin',focus);},[]);
 return <div ref={ref} className="ss-format-toolbar" role="group" aria-label="Site plan text formatting"><span>Select text to format</span>{[['bold','Bold'],['italic','Italic'],['underline','Underline'],['hy','Highlight'],['hg','Green highlight'],['insertUnorderedList','Bullets'],['insertOrderedList','Numbered list'],['clear','Clear formatting']].map(([command,title])=><button type="button" key={command} aria-label={title} title={title} onPointerDown={e=>e.preventDefault()} onClick={()=>apply(command)}>{title==='Bold'?<b>B</b>:title==='Italic'?<i>I</i>:title==='Underline'?<u>U</u>:title}</button>)}<label>Font<select aria-label="Text font" defaultValue="" onChange={e=>{apply(e.target.value);e.currentTarget.value='';}}><option value="" disabled>Choose font</option><option value="sans">Arial</option><option value="serif">Times New Roman</option><option value="mono">Courier</option></select></label><label>Size<select aria-label="Text size" defaultValue="" onChange={e=>{apply(e.target.value==='normal'?'nm':e.target.value);e.currentTarget.value='';}}><option value="" disabled>Choose size</option><option value="sm">Small</option><option value="normal">Normal</option><option value="lg">Large</option></select></label></div>;
}
export function FormattedSiteText({value}:{value:string}){return <span dangerouslySetInnerHTML={{__html:safetyTextHtml(value)}}/>;}
export function DocumentText(props:TextareaHTMLAttributes<HTMLTextAreaElement>){
 const ref=useRef<HTMLDivElement>(null),local=useRef(String(props.value||''));const [locked,setLocked]=useState(false);
 useLayoutEffect(()=>{const parent=ref.current?.closest('fieldset');if(!parent)return;const update=()=>setLocked(parent.disabled);update();const observer=new MutationObserver(update);observer.observe(parent,{attributes:true,attributeFilter:['disabled']});return ()=>observer.disconnect();},[]);
 useLayoutEffect(()=>{const el=ref.current;if(!el)return;if(document.activeElement===el&&local.current===String(props.value||''))return;const html=safetyTextHtml(String(props.value||''));if(el.innerHTML!==html)el.innerHTML=html;local.current=String(props.value||'');},[props.value]);
 return <div ref={ref} role="textbox" aria-label={props['aria-label']?safetyTextPlain(props['aria-label']):undefined} aria-multiline="true" aria-readonly={props.readOnly||undefined} aria-required={props.required||undefined} contentEditable={!locked&&!props.disabled&&!props.readOnly} suppressContentEditableWarning className={`ss-document-text ss-rich-editor ${props.className||''}`} data-ss-rich-editor data-placeholder={props.placeholder||''} inputMode={props.inputMode} onSelect={e=>remember(e.currentTarget)} onKeyUp={e=>remember(e.currentTarget)} onMouseUp={e=>remember(e.currentTarget)} onTouchEnd={e=>remember(e.currentTarget)} onFocus={e=>remember(e.currentTarget)} onInput={e=>{const value=editorValue(e.currentTarget);if(props.maxLength&&value.length>props.maxLength){e.currentTarget.innerHTML=safetyTextHtml(local.current);return;}local.current=value;props.onChange?.({target:{value},currentTarget:{value}} as ChangeEvent<HTMLTextAreaElement>);remember(e.currentTarget);}} onDrop={e=>{e.preventDefault();if(!props.readOnly&&!props.disabled&&!locked)document.execCommand('insertText',false,e.dataTransfer.getData('text/plain'));}} onPaste={e=>{e.preventDefault();if(!props.readOnly&&!props.disabled&&!locked)document.execCommand('insertText',false,e.clipboardData.getData('text/plain'));}}/>;
}
export function DocumentFields({fields,onChange}:{fields:SafetyField[];onChange:(fields:SafetyField[])=>void}){
 return <div className="ss-document-fields">{fields.map((field,index)=><section className="ss-document-field" key={field.id}><div className="ss-document-label"><DocumentText aria-label={`Field ${index+1} heading`} value={field.label} maxLength={200} onChange={e=>onChange(fields.map(f=>f.id===field.id?{...f,label:e.target.value}:f))}/></div><DocumentText aria-label={safetyTextPlain(field.label)} placeholder={`Enter ${safetyTextPlain(field.label).toLowerCase()}...`} maxLength={20000} value={field.value} onChange={e=>onChange(fields.map(f=>f.id===field.id?{...f,value:e.target.value}:f))}/></section>)}</div>;
}
