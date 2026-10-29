import {createPortal} from 'react-dom';
import {formatPhoneRichText,phonePosition,phoneDeletion} from '../lib/phone-number';
import { useEffect, useLayoutEffect, useRef, useState, type ChangeEvent, type TextareaHTMLAttributes } from 'react';
import type { SafetyField } from '../lib/site-specific';
import { safetyTextHtml, safetyTextPlain, safetyList, safetyTextRuns, safetyRunValue, safetyTextDefault, safetyToken, safetyEdit, type SafetyTextStyle } from '../lib/site-specific-rich-text';
let activeEditor:HTMLElement|null=null,savedRange:Range|null=null;
const histories=new WeakMap<HTMLElement,{past:string[];future:string[];value:string}>(),pending=new WeakMap<HTMLElement,SafetyTextStyle>();
function announce(){document.dispatchEvent(new Event('ss-selection'));}
function remember(editor:HTMLElement){const selection=getSelection();if(selection?.rangeCount&&editor.contains(selection.anchorNode)&&editor.contains(selection.focusNode)){activeEditor=editor;savedRange=selection.getRangeAt(0).cloneRange();announce();}}
function childrenValue(node:Node){let value='',previousBlock=false;for(const child of node.childNodes){const block=child instanceof HTMLElement&&/^(DIV|P|UL|OL)$/.test(child.tagName),part=serialize(child);if(value&&(block||previousBlock)&&!safetyTextPlain(value).endsWith('\n')&&!safetyTextPlain(part).startsWith('\n'))value+='\n';value+=part;previousBlock=block;}return value;}
function serialize(node:Node):string{
 if(node.nodeType===Node.TEXT_NODE)return node.textContent||'';
 if(!(node instanceof HTMLElement))return childrenValue(node);
 if(node.tagName==='BR')return '\n';
 let value=childrenValue(node);if(!value)return '';
 const tokens=(node.dataset.ssStyle||'').split(' ').filter(x=>safetyToken.test(x));
 if(node.matches('b,strong')||node.style.fontWeight==='bold'||Number(node.style.fontWeight)>=600)tokens.push('b');
 if(node.matches('i,em')||node.style.fontStyle==='italic')tokens.push('i');
 if(node.tagName==='U'||node.style.textDecoration.includes('underline'))tokens.push('u');
 for(const t of [...new Set(tokens)])value='['+t+']'+value+'[/'+t+']';
 if(node.tagName==='LI'){const number=node.parentElement?.tagName==='OL'?[...node.parentElement.children].indexOf(node)+1:null;return (number?number+'. ':'\u2022 ')+value+'\n';}
 return value;
}
const editorValue=(editor:HTMLElement)=>childrenValue(editor).replace(/\u00a0/g,' ').replace(/\n{3,}/g,'\n\n').replace(/\n$/,'');
function selectionInfo(){
 const editor=activeEditor;if(!editor?.isConnected||!savedRange)return null;
 const before=savedRange.cloneRange();try{before.selectNodeContents(editor);before.setEnd(savedRange.startContainer,savedRange.startOffset);const length=()=>{const box=document.createElement('div');box.append(before.cloneContents());return safetyTextPlain(childrenValue(box)).length;};const start=length();before.setEnd(savedRange.endContainer,savedRange.endOffset);return {editor,start,end:length()};}catch{return null;}
}
function currentStyle(){const info=selectionInfo();if(!info)return safetyTextDefault;if(pending.has(info.editor)&&info.start===info.end)return pending.get(info.editor)!;let at=0;for(const run of safetyTextRuns(editorValue(info.editor))){at+=run.text.length;if(at>info.start)return run.style;}return safetyTextDefault;}
function replace(editor:HTMLElement,value:string,start:number,end:number){editor.innerHTML=safetyTextHtml(value);editor.focus();selectText(editor,start,end);editor.dispatchEvent(new Event('input',{bubbles:true}));remember(editor);}
function history(editor:HTMLElement,redo=false){if(editor.contentEditable!=='true'||editor.closest('fieldset[disabled]'))return;const h=histories.get(editor),from=redo?h?.future:h?.past,to=redo?h?.past:h?.future;if(!h||!from?.length||!to)return;to.push(h.value);const value=from.pop()!;h.value=value;pending.delete(editor);replace(editor,value,safetyTextPlain(value).length,safetyTextPlain(value).length);}
function format(command:string,scope:HTMLElement|null){
 const info=selectionInfo();if(!info)return;const {editor}=info;
 if(!scope?.contains(editor)||editor.getAttribute('contenteditable')!=='true'||editor.closest('fieldset[disabled]'))return;
 if(command==='undo'||command==='redo'){history(editor,command==='redo');return;}
 let {start,end}=info;const value=editorValue(editor),plain=safetyTextPlain(value),style=currentStyle();
 const paragraph=/^(a[lcr]|in[+-]|ls|insert)/.test(command);
 if(paragraph){start=plain.lastIndexOf('\n',Math.max(0,start-1))+1;const next=plain.indexOf('\n',Math.max(start,end-1));end=next<0?plain.length:next;}
 let patch:Partial<SafetyTextStyle>={};
 if(['bold','italic','underline','strike'].includes(command)){const key=command as 'bold'|'italic'|'underline'|'strike';patch[key]=!style[key];}
 else if(command==='clear')patch={...safetyTextDefault,strike:false,points:undefined,highlight:undefined,color:undefined,align:undefined,indent:undefined,spacing:undefined};
 else if(['sans','serif','mono'].includes(command))patch.family=command as SafetyTextStyle['family'];
 else if(command.startsWith('pt'))patch={points:Number(command.slice(2)),size:'normal'};
 else if(['sm','lg','nm'].includes(command))patch={points:undefined,size:command==='sm'?'small':command==='lg'?'large':'normal'};
 else if(command==='hy'||command==='hg')patch.highlight=command==='hy'?'yellow':'green';
 else if(command.startsWith('color:'))patch.color=command.slice(6)||undefined;
 else if(command.startsWith('highlight:'))patch.highlight=command.slice(10)||undefined;
 else if(/^a[lcr]$/.test(command))patch.align=command==='ac'?'center':command==='ar'?'right':'left';
 else if(command.startsWith('in'))patch.indent=Math.min(3,Math.max(0,(style.indent||0)+(command==='in+'?1:-1)));
 else if(command.startsWith('ls'))patch.spacing=Number(command.slice(2))/10;
 if(start===end){pending.set(editor,{...style,...patch});editor.focus();announce();return;}
 pending.delete(editor);
 let result=safetyEdit(value,start,end,patch);
 if(command.startsWith('insert')){
  let offset=0;const left: string[]=[],middle:string[]=[],right:string[]=[];
  for(const run of safetyTextRuns(value)){const a=Math.max(0,Math.min(run.text.length,start-offset)),b=Math.max(0,Math.min(run.text.length,end-offset));left.push(safetyRunValue({...run,text:run.text.slice(0,a)}));middle.push(safetyRunValue({...run,text:run.text.slice(a,b)}));right.push(safetyRunValue({...run,text:run.text.slice(b)}));offset+=run.text.length;}
  const body=safetyList(middle.join(''),command==='insertOrderedList');result=left.join('')+body+right.join('');end=start+safetyTextPlain(body).length;
 }
 replace(editor,result,start,end);
}
const colors=[['','Automatic'],['#172d24','Black'],['#145b3d','JGC green'],['#b42318','Red'],['#184e9e','Blue'],['#713ba4','Purple'],['#9a6700','Gold'],['#596579','Grey']];
const highlights=[['','No highlight'],['yellow','Yellow'],['green','Green'],['#cce9ff','Blue'],['#fbd5e5','Pink'],['#ffdcb5','Orange']];
export function SiteFormattingToolbar(){
 const host=useRef<HTMLSpanElement>(null),ref=useRef<HTMLDivElement>(null),dismissed=useRef(false),[tick,setTick]=useState(0),[tab,setTab]=useState('Font'),[expanded,setExpanded]=useState(false),[mobile,setMobile]=useState(()=>matchMedia('(max-width:760px)').matches),[position,setPosition]=useState({left:8,top:8,width:620,maxHeight:500,visible:false});
 const scope=()=>host.current?.closest<HTMLElement>('.ss-builder')||null;
 const apply=(command:string)=>format(command,scope());
 const hide=()=>{dismissed.current=true;setExpanded(false);setTick(n=>n+1);};
 useEffect(()=>{
  let frame=0;const update=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>setTick(n=>n+1));};
  const inside=(target:EventTarget|null)=>target instanceof Node&&Boolean(ref.current?.contains(target));
  const selection=()=>{const sel=getSelection(),el=sel?.anchorNode?.parentElement?.closest<HTMLElement>('[data-ss-rich-editor]');if(el&&scope()?.contains(el)){if(el.contains(sel?.focusNode||null))remember(el);else{activeEditor=null;savedRange=null;update();}}};
  const focus=(event:FocusEvent)=>{const target=event.target;if(inside(target))return;if(target instanceof Element&&target.closest('[data-ss-rich-editor]')&&scope()?.contains(target))return;activeEditor=null;savedRange=null;setExpanded(false);update();};
  const pointer=(event:PointerEvent)=>{if(inside(event.target))return;const target=event.target;if(target instanceof Element&&scope()?.contains(target)&&target.closest('[data-ss-rich-editor]')){dismissed.current=false;return;}activeEditor=null;savedRange=null;setExpanded(false);update();};
  const keys=(event:KeyboardEvent)=>{if(event.key==='Escape'&&(inside(event.target)||scope()?.contains(event.target as Node))){event.preventDefault();hide();activeEditor?.focus({preventScroll:true});}};
  const media=matchMedia('(max-width:760px)'),resize=()=>{setMobile(media.matches);update();};
  document.addEventListener('focusin',focus);document.addEventListener('pointerdown',pointer,true);document.addEventListener('keydown',keys);document.addEventListener('ss-selection',update);document.addEventListener('selectionchange',selection);window.addEventListener('scroll',update,true);window.addEventListener('resize',resize);window.visualViewport?.addEventListener('resize',update);window.visualViewport?.addEventListener('scroll',update);media.addEventListener('change',resize);
  return ()=>{cancelAnimationFrame(frame);document.removeEventListener('focusin',focus);document.removeEventListener('pointerdown',pointer,true);document.removeEventListener('keydown',keys);document.removeEventListener('ss-selection',update);document.removeEventListener('selectionchange',selection);window.removeEventListener('scroll',update,true);window.removeEventListener('resize',resize);window.visualViewport?.removeEventListener('resize',update);window.visualViewport?.removeEventListener('scroll',update);media.removeEventListener('change',resize);activeEditor=null;savedRange=null;};
 },[]);
 const info=selectionInfo(),s=currentStyle(),enabled=Boolean(info&&scope()?.contains(info.editor)&&info.editor.contentEditable==='true'&&!info.editor.closest('fieldset[disabled]'));
 useLayoutEffect(()=>{
  const box=ref.current,editor=activeEditor,view=window.visualViewport,left=view?.offsetLeft||0,top=view?.offsetTop||0,vw=view?.width||innerWidth,vh=view?.height||innerHeight;
  const width=Math.min(expanded?(mobile?360:640):(mobile?204:164),vw-16),maxHeight=Math.max(60,vh-24);
  if(!enabled||dismissed.current||!box||!editor){setPosition(p=>p.visible?{...p,visible:false}:p);return;}
  const editRect=editor.getBoundingClientRect(),selectionRect=savedRange?.getBoundingClientRect(),anchor=selectionRect?.height?selectionRect:editRect;
  const within=editRect.bottom>top&&editRect.top<top+vh&&editRect.right>left&&editRect.left<left+vw;
  const height=Math.min(box.getBoundingClientRect().height,maxHeight),keyboard=vh<innerHeight*.8;
  let x=mobile?left+(vw-width)/2:anchor.left,y=mobile?top+vh-height-(keyboard?8:80):anchor.top-height-12;
  if(!mobile&&y<top+8)y=anchor.bottom+12;
  x=Math.max(left+8,Math.min(x,left+vw-width-8));y=Math.max(top+8,Math.min(y,top+vh-height-8));
  const next={left:Math.round(x),top:Math.round(y),width,maxHeight,visible:within};setPosition(p=>JSON.stringify(p)===JSON.stringify(next)?p:next);
 },[tick,mobile,expanded,tab,enabled,position.width]);
 const button=(command:string,title:string,icon:React.ReactNode,pressed?:boolean)=><button type="button" aria-label={title} title={title} disabled={!enabled||(command==='undo'&&!histories.get(info!.editor)?.past.length)||(command==='redo'&&!histories.get(info!.editor)?.future.length)} aria-pressed={pressed} onPointerDown={e=>e.preventDefault()} onClick={()=>apply(command)}>{icon}</button>;
 const alignIcon=(align:string)=><svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">{[3,7,11,15].map((y,i)=><path key={y} d={`M${i%2?(align==='center'?5:align==='right'?8:2):2} ${y}h${i%2?8:14}`} stroke="currentColor" strokeWidth="1.6"/>)}</svg>;
 return <><span ref={host} className="ss-format-anchor" aria-hidden="true"/>{createPortal(<div ref={ref} className="ss-format-toolbar ss-format-floating" data-expanded={expanded} role="group" aria-label="Site plan text formatting" style={{left:position.left,top:position.top,width:position.width,maxHeight:position.maxHeight,visibility:position.visible?'visible':'hidden',pointerEvents:position.visible?'auto':'none'}}>

  <div className="ss-ribbon-header">{expanded?<><strong>Formatting</strong><span className="ss-active-field">{enabled?info!.editor.getAttribute('aria-label'):''}</span></>:<div className="ss-quick-format">{button('bold','Bold',<b>B</b>,s.bold)}{button('italic','Italic',<i>I</i>,s.italic)}{button('underline','Underline',<u>U</u>,s.underline)}</div>}<button type="button" className="ss-format-toggle" aria-label={expanded?'Collapse formatting':'Expand formatting'} title={expanded?'Collapse formatting':'More formatting'} aria-expanded={expanded} onPointerDown={e=>e.preventDefault()} onClick={()=>setExpanded(v=>!v)}>{expanded?'▴':'▾'}</button>{expanded&&<div className="ss-history">{button('undo','Undo','↶')}{button('redo','Redo','↷')}<button type="button" aria-label="Close formatting" title="Close formatting (Esc)" onPointerDown={e=>e.preventDefault()} onClick={hide}>×</button></div>}</div>
  <div className="ss-ribbon-tabs" role="tablist" aria-label="Formatting tools">{['Font','Paragraph'].map(name=><button key={name} role="tab" type="button" aria-selected={tab===name} onPointerDown={e=>e.preventDefault()} onClick={()=>setTab(name)}>{name}</button>)}</div>
  <div className="ss-ribbon-body" data-mobile-tab={tab}>
   <div className="ss-ribbon-group ss-font-group"><div className="ss-ribbon-row"><select disabled={!enabled} aria-label="Text font" value={s.family} onChange={e=>apply(e.target.value)}><option value="sans">Arial</option><option value="serif">Times New Roman</option><option value="mono">Courier New</option></select><select disabled={!enabled} aria-label="Text size" value={s.points?'pt'+s.points:s.size==='small'?'sm':s.size==='large'?'lg':'nm'} onChange={e=>apply(e.target.value)}><option value="nm">Auto</option><option value="sm">Small (legacy)</option><option value="lg">Large (legacy)</option>{[8,9,10,11,12,14,16,18,20,24,28,32,36].map(n=><option key={n} value={'pt'+n}>{n}</option>)}</select>{button('clear','Clear formatting',<span>A⌫</span>)}</div><div className="ss-ribbon-row">{button('bold','Bold',<b>B</b>,s.bold)}{button('italic','Italic',<i>I</i>,s.italic)}{button('underline','Underline',<u>U</u>,s.underline)}{button('strike','Strikethrough',<s>ab</s>,!!s.strike)}<label className="ss-colour-control" title="Font colour"><span style={{borderBottomColor:s.color||'#172d24'}}>A</span><select disabled={!enabled} aria-label="Font colour" value={s.color||''} onChange={e=>apply('color:'+e.target.value)}>{colors.map(([v,n])=><option key={v} value={v}>{n}</option>)}</select></label><label className="ss-colour-control" title="Text highlight"><span style={{background:s.highlight==='yellow'?'#fff2a8':s.highlight==='green'?'#cfecc8':s.highlight}}>▰</span><select disabled={!enabled} aria-label="Highlight colour" value={s.highlight||''} onChange={e=>apply('highlight:'+e.target.value)}>{highlights.map(([v,n])=><option key={v} value={v}>{n}</option>)}</select></label></div><small>Font</small></div>
   <div className="ss-ribbon-group ss-paragraph-group"><div className="ss-ribbon-row">{button('insertUnorderedList','Bullets','• ≡')}{button('insertOrderedList','Numbered list','1. ≡')}{button('in-','Decrease indent','⇤')}{button('in+','Increase indent','⇥')}</div><div className="ss-ribbon-row">{button('al','Align left',alignIcon('left'),!s.align||s.align==='left')}{button('ac','Align centre',alignIcon('center'),s.align==='center')}{button('ar','Align right',alignIcon('right'),s.align==='right')}<select disabled={!enabled} aria-label="Line spacing" value={'ls'+((s.spacing||1)*10)} onChange={e=>apply(e.target.value)}><option value="ls10">Single</option><option value="ls15">1.5 lines</option><option value="ls20">Double</option></select></div><small>Paragraph</small></div>
  </div>
 </div>,document.body)}</>;
}
export function FormattedSiteText({value}:{value:string}){return <span dangerouslySetInnerHTML={{__html:safetyTextHtml(value)}}/>;}
function textSelection(editor:HTMLElement){
 const selection=getSelection();if(!selection?.rangeCount)return null;const range=selection.getRangeAt(0);if(!editor.contains(range.commonAncestorContainer))return null;
 const before=range.cloneRange();before.selectNodeContents(editor);before.setEnd(range.startContainer,range.startOffset);const start=before.toString().length;before.setEnd(range.endContainer,range.endOffset);return {start,end:before.toString().length};
}
function selectText(editor:HTMLElement,start:number,end:number){
 const walker=document.createTreeWalker(editor,NodeFilter.SHOW_TEXT);let node:Node|null,offset=0,first:{node:Node;offset:number}|undefined,last:{node:Node;offset:number}|undefined;
 while((node=walker.nextNode())){const length=node.textContent?.length||0;if(!first&&start<=offset+length)first={node,offset:Math.max(0,start-offset)};if(end<=offset+length){last={node,offset:Math.max(0,end-offset)};break;}offset+=length;}
 if(!first||!last)return;const range=document.createRange();range.setStart(first.node,first.offset);range.setEnd(last.node,last.offset);const selection=getSelection();selection?.removeAllRanges();selection?.addRange(range);
}
export function DocumentText(props:TextareaHTMLAttributes<HTMLTextAreaElement>){
 const ref=useRef<HTMLDivElement>(null),local=useRef(String(props.value||''));const [locked,setLocked]=useState(false);
 const label=safetyTextPlain(props['aria-label']||''),phone=props.inputMode==='tel'||(/\b(?:phone|telephone|fax|mobile|cell)(?: number)?$/i.test(label)&&!/\band\s+(?:phone|telephone|mobile|cell)(?: number)?$/i.test(label));
 function commit(editor:HTMLElement,final=false){
  const typed=editorValue(editor),value=phone?formatPhoneRichText(typed,final):typed;
  if(props.maxLength&&value.length>props.maxLength){editor.innerHTML=safetyTextHtml(local.current);return;}
  if(value!==typed){const selection=textSelection(editor),before=safetyTextPlain(typed),after=safetyTextPlain(value);editor.innerHTML=safetyTextHtml(value);if(selection&&document.activeElement===editor)selectText(editor,phonePosition(before,after,selection.start),phonePosition(before,after,selection.end));}
  if(final&&value===local.current)return;const h=histories.get(editor)||{past:[],future:[],value:local.current};if(h.value!==value){h.past.push(h.value);if(h.past.length>100)h.past.shift();h.future=[];h.value=value;}histories.set(editor,h);local.current=value;props.onChange?.({target:{value},currentTarget:{value}} as ChangeEvent<HTMLTextAreaElement>);remember(editor);
 }

 useEffect(()=>{const el=ref.current;if(!el)return;const insert=(event:InputEvent)=>{const style=pending.get(el);if(!style||event.inputType!=='insertText'||event.isComposing||!event.data||el.contentEditable!=='true'||el.closest('fieldset[disabled]'))return;event.preventDefault();document.execCommand('insertHTML',false,safetyTextHtml(safetyRunValue({text:event.data,style})));};el.addEventListener('beforeinput',insert);return ()=>el.removeEventListener('beforeinput',insert);},[]);
 useLayoutEffect(()=>{const parent=ref.current?.closest('fieldset');if(!parent)return;const update=()=>setLocked(parent.disabled);update();const observer=new MutationObserver(update);observer.observe(parent,{attributes:true,attributeFilter:['disabled']});return ()=>observer.disconnect();},[]);
 useLayoutEffect(()=>{const el=ref.current;if(!el)return;if(document.activeElement===el&&local.current===String(props.value||''))return;const html=safetyTextHtml(String(props.value||''));if(el.innerHTML!==html)el.innerHTML=html;local.current=String(props.value||'');},[props.value]);
 return <div ref={ref} role="textbox" aria-label={props['aria-label']?safetyTextPlain(props['aria-label']):undefined} aria-multiline="true" aria-readonly={props.readOnly||undefined} aria-required={props.required||undefined} contentEditable={!locked&&!props.disabled&&!props.readOnly} suppressContentEditableWarning className={`ss-document-text ss-rich-editor ${props.className||''}`} data-ss-rich-editor data-placeholder={props.placeholder||''} inputMode={props.inputMode||(phone?'tel':undefined)} onMouseDown={e=>pending.delete(e.currentTarget)} onSelect={e=>remember(e.currentTarget)} onKeyUp={e=>remember(e.currentTarget)} onMouseUp={e=>remember(e.currentTarget)} onTouchEnd={e=>remember(e.currentTarget)} onFocus={e=>remember(e.currentTarget)} onInput={e=>{if(!(e.nativeEvent as InputEvent).isComposing)commit(e.currentTarget);}} onCompositionEnd={e=>commit(e.currentTarget)} onBlur={e=>{if(phone&&!props.readOnly&&!props.disabled&&!locked)commit(e.currentTarget,true);}} onKeyDown={e=>{if((e.ctrlKey||e.metaKey)&&['z','y'].includes(e.key.toLowerCase())){e.preventDefault();history(e.currentTarget,e.key.toLowerCase()==='y'||e.shiftKey);return;}if(!phone||!['Backspace','Delete'].includes(e.key))return;const selection=textSelection(e.currentTarget);if(!selection)return;const plain=safetyTextPlain(editorValue(e.currentTarget)),range=phoneDeletion(plain,selection.start,selection.end,e.key);if(range.start!==selection.start||range.end!==selection.end)selectText(e.currentTarget,range.start,range.end);}} onDrop={e=>{e.preventDefault();if(!props.readOnly&&!props.disabled&&!locked)document.execCommand('insertText',false,e.dataTransfer.getData('text/plain'));}} onPaste={e=>{e.preventDefault();if(!props.readOnly&&!props.disabled&&!locked)document.execCommand('insertText',false,e.clipboardData.getData('text/plain'));}}/>;
}
export function DocumentFields({fields,onChange}:{fields:SafetyField[];onChange:(fields:SafetyField[])=>void}){
 return <div className="ss-document-fields">{fields.map((field,index)=><section className="ss-document-field" key={field.id}><div className="ss-document-label"><DocumentText aria-label={`Field ${index+1} heading`} value={field.label} maxLength={200} onChange={e=>onChange(fields.map(f=>f.id===field.id?{...f,label:e.target.value}:f))}/></div><DocumentText aria-label={safetyTextPlain(field.label)} placeholder={`Enter ${safetyTextPlain(field.label).toLowerCase()}...`} maxLength={20000} value={field.value} onChange={e=>onChange(fields.map(f=>f.id===field.id?{...f,value:e.target.value}:f))}/></section>)}</div>;
}
