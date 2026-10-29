export type SafetyTextStyle={bold:boolean;italic:boolean;underline:boolean;strike?:boolean;highlight?:string;size:'small'|'normal'|'large';points?:number;color?:string;family:'sans'|'serif'|'mono';align?:'left'|'center'|'right';indent?:number;spacing?:number};
export type SafetyTextRun={text:string;style:SafetyTextStyle};
export const safetyTextDefault:SafetyTextStyle={bold:false,italic:false,underline:false,size:'normal',family:'sans'};
export const safetyToken=/^(b|i|u|strike|hy|hg|sm|lg|nm|sans|serif|mono|pt(?:8|9|10|11|12|14|16|18|20|24|28|32|36)|[ch][0-9a-f]{6}|al|ac|ar|in[0-3]|ls(?:10|15|20))$/i;
export function safetyTextRuns(value:string):SafetyTextRun[]{
 const runs:SafetyTextRun[]=[],stack:{token:string;style:SafetyTextStyle}[]=[];let style={...safetyTextDefault},cursor=0;
 for(const match of value.matchAll(/\[(\/)?([^\[\]]+)\]/g)){
  const token=match[2].toLowerCase();if(!safetyToken.test(token))continue;
  if(match.index!>cursor)runs.push({text:value.slice(cursor,match.index),style:{...style}});
  if(match[1]){const i=stack.map(x=>x.token).lastIndexOf(token);if(i>=0){style=stack[i].style;stack.splice(i);}}
  else{stack.push({token,style:{...style}});if(token==='b')style.bold=true;else if(token==='i')style.italic=true;else if(token==='u')style.underline=true;else if(token==='strike')style.strike=true;else if(token==='hy'||token==='hg')style.highlight=token==='hy'?'yellow':'green';else if(token==='sm'||token==='lg'||token==='nm'){style.size=token==='sm'?'small':token==='lg'?'large':'normal';delete style.points;}else if(token.startsWith('pt'))style.points=Number(token.slice(2));else if(/^[ch][0-9a-f]{6}$/.test(token))style[token[0]==='c'?'color':'highlight']='#'+token.slice(1);else if(/^a[lcr]$/.test(token))style.align=token==='ac'?'center':token==='ar'?'right':'left';else if(token.startsWith('in'))style.indent=Number(token.slice(2));else if(token.startsWith('ls'))style.spacing=Number(token.slice(2))/10;else style.family=token as SafetyTextStyle['family'];}
  cursor=match.index!+match[0].length;
 }
 if(cursor<value.length)runs.push({text:value.slice(cursor),style:{...style}});return runs;
}
export const safetyTextPlain=(value:string)=>safetyTextRuns(value).map(r=>r.text).join('');
export function safetyTokens(s:SafetyTextStyle){return [s.family!=='sans'?s.family:'',s.bold?'b':'',s.italic?'i':'',s.underline?'u':'',s.strike?'strike':'',s.color?'c'+s.color.slice(1):'',s.highlight==='yellow'?'hy':s.highlight==='green'?'hg':s.highlight?'h'+s.highlight.slice(1):'',s.points?'pt'+s.points:s.size==='small'?'sm':s.size==='large'?'lg':'',s.align?'a'+(s.align==='center'?'c':s.align==='right'?'r':'l'):'',s.indent?'in'+s.indent:'',s.spacing?'ls'+(s.spacing*10):''].filter(Boolean);}
export function safetyRunValue(run:SafetyTextRun){const tokens=safetyTokens(run.style);return tokens.map(t=>'['+t+']').join('')+run.text+tokens.reverse().map(t=>'[/'+t+']').join('');}
export const safetySizeFactor=(style:SafetyTextStyle)=>style.size==='small'?.85:style.size==='large'?1.3:1;
export const safetyPointSize=(style:SafetyTextStyle,base:number)=>style.points||base*safetySizeFactor(style);
export const safetyFontFamily=(family:SafetyTextStyle['family'])=>family==='serif'?'Times New Roman, Times, serif':family==='mono'?'Courier New, monospace':'Arial, Helvetica, sans-serif';
export const safetyHighlight=(value:string)=>value==='yellow'?'#fff2a8':value==='green'?'#cfecc8':value;
export function safetyTextLines(value:string){const lines:SafetyTextRun[][]=[[]];for(const run of safetyTextRuns(value)){run.text.split('\n').forEach((text,i)=>{if(i)lines.push([]);if(text)lines.at(-1)!.push({text,style:run.style});});}return lines;}
export function safetyTextHtml(value:string){
 const escape=(s:string)=>s.replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]!));
 const span=(run:SafetyTextRun)=>{const s=run.style;return `<span style="font-family:${safetyFontFamily(s.family)};font-size:${s.points?s.points+'pt':safetySizeFactor(s)+'em'};${s.bold?'font-weight:bold;':''}${s.italic?'font-style:italic;':''}text-decoration:${[s.underline?'underline':'',s.strike?'line-through':''].filter(Boolean).join(' ')||'none'};${s.highlight?'background-color:'+safetyHighlight(s.highlight)+';':''}${s.color||s.highlight?'color:'+(s.color||'#102018')+';':''}" data-ss-style="${safetyTokens(s).join(' ')}">${escape(run.text)}</span>`;};
 return safetyTextLines(value).map(line=>{const s=line[0]?.style;const content=line.map(span).join('');return s&&(s.align||s.indent||s.spacing)?`<div data-ss-line style="text-align:${s.align||'left'};padding-left:${(s.indent||0)*18}pt;line-height:${(s.spacing||1)*1.4}">${content||'<br>'}</div>`:content;}).join('\n');
}
export function safetyEdit(value:string,start:number,end:number,patch:Partial<SafetyTextStyle>){let offset=0;return safetyTextRuns(value).flatMap(run=>{const a=Math.max(0,start-offset),b=Math.min(run.text.length,end-offset);offset+=run.text.length;if(b<=a)return [run];return [{...run,text:run.text.slice(0,a)},{text:run.text.slice(a,b),style:{...run.style,...patch}},{...run,text:run.text.slice(b)}].filter(r=>r.text);}).map(safetyRunValue).join('');}
export function safetyList(value:string,numbered:boolean){return safetyTextLines(value).map((line,index)=>{const plain=line.map(r=>r.text).join('');let remove=plain.match(/^\s*(?:[\u2022*-]|\d+[.)])\s+/)?.[0].length||0;const next=line.map(run=>{const skip=Math.min(remove,run.text.length);remove-=skip;return {...run,text:run.text.slice(skip)};}).filter(r=>r.text);return (numbered?`${index+1}. `:'\u2022 ')+next.map(safetyRunValue).join('');}).join('\n');}
