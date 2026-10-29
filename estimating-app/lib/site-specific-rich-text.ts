export type SafetyTextStyle={bold:boolean;italic:boolean;underline:boolean;highlight?:'yellow'|'green';size:'small'|'normal'|'large';family:'sans'|'serif'|'mono'};
export type SafetyTextRun={text:string;style:SafetyTextStyle};
export const safetyTextDefault:SafetyTextStyle={bold:false,italic:false,underline:false,size:'normal',family:'sans'};
export function safetyTextRuns(value:string):SafetyTextRun[]{
 const runs:SafetyTextRun[]=[],stack:{token:string;style:SafetyTextStyle}[]=[];let style={...safetyTextDefault},cursor=0;
 const pattern=/\[(\/)?(b|i|u|hy|hg|sm|lg|nm|sans|serif|mono)\]/gi;
 for(const match of value.matchAll(pattern)){
  if(match.index!>cursor)runs.push({text:value.slice(cursor,match.index),style:{...style}});
  const token=match[2].toLowerCase();if(match[1]){const i=stack.map(x=>x.token).lastIndexOf(token);if(i>=0){style=stack[i].style;stack.splice(i);}}
  else{stack.push({token,style:{...style}});if(token==='b')style.bold=true;else if(token==='i')style.italic=true;else if(token==='u')style.underline=true;else if(token==='hy'||token==='hg')style.highlight=token==='hy'?'yellow':'green';else if(token==='sm'||token==='lg'||token==='nm')style.size=token==='sm'?'small':token==='lg'?'large':'normal';else style.family=token as SafetyTextStyle['family'];}
  cursor=match.index!+match[0].length;
 }
 if(cursor<value.length)runs.push({text:value.slice(cursor),style:{...style}});return runs;
}
export const safetyTextPlain=(value:string)=>safetyTextRuns(value).map(r=>r.text).join('');
export function safetyRunValue(run:SafetyTextRun){
 const s=run.style,tokens=[s.family!=='sans'?s.family:'',s.bold?'b':'',s.italic?'i':'',s.underline?'u':'',s.highlight==='yellow'?'hy':s.highlight==='green'?'hg':'',s.size==='small'?'sm':s.size==='large'?'lg':''].filter(Boolean);
 return tokens.map(t=>'['+t+']').join('')+run.text+tokens.reverse().map(t=>'[/'+t+']').join('');
}
export const safetySizeFactor=(style:SafetyTextStyle)=>style.size==='small'?.85:style.size==='large'?1.3:1;
export const safetyFontFamily=(family:SafetyTextStyle['family'])=>family==='serif'?'"Times New Roman", Times, serif':family==='mono'?'"Courier New", monospace':'Arial, Helvetica, sans-serif';
export function safetyTextHtml(value:string){
 const escape=(s:string)=>s.replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]!));
 return safetyTextRuns(value).map(run=>{const s=run.style;return `<span style="font-family:${s.family==='serif'?'Times New Roman,serif':s.family==='mono'?'Courier New,monospace':'Arial,sans-serif'};font-size:${safetySizeFactor(s)}em;${s.bold?'font-weight:bold;':''}${s.italic?'font-style:italic;':''}${s.underline?'text-decoration:underline;':''}${s.highlight?'background-color:'+(s.highlight==='yellow'?'#fff2a8':'#cfecc8')+';color:#102018;':''}" data-ss-style="${[s.family==='sans'?'':s.family,s.size,s.bold?'b':'',s.italic?'i':'',s.underline?'u':'',s.highlight==='yellow'?'hy':s.highlight==='green'?'hg':''].join(' ')}">${escape(run.text).replace(/\n/g,'<br>')}</span>`;}).join('');
}

export function safetyList(value:string,numbered:boolean){
 const lines:SafetyTextRun[][]=[[]];for(const run of safetyTextRuns(value)){const parts=run.text.split('\n');parts.forEach((part,i)=>{if(i)lines.push([]);if(part)lines.at(-1)!.push({text:part,style:run.style});});}
 return lines.map((line,index)=>{const plain=line.map(r=>r.text).join('');let remove=plain.match(/^\s*(?:[\u2022*-]|\d+[.)])\s+/)?.[0].length||0;const next=line.map(run=>{const skip=Math.min(remove,run.text.length);remove-=skip;return {...run,text:run.text.slice(skip)};}).filter(r=>r.text);return (numbered?`${index+1}. `:'\u2022 ')+next.map(safetyRunValue).join('');}).join('\n');
}
