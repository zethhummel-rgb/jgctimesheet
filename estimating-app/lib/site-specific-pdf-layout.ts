import { rgb, type PDFDocument, type PDFFont, type PDFPage, type PDFImage } from 'pdf-lib';
import type { SafetyPage } from './site-specific';

export const safetyColors={green:rgb(.07,.25,.19),gold:rgb(.68,.53,.18),ink:rgb(.10,.17,.14),muted:rgb(.34,.41,.38),line:rgb(.8,.85,.82),pale:rgb(.94,.96,.95)};
export function clean(value:string,font:PDFFont) {return [...String(value).normalize('NFC').replace(/[\u2010-\u2015]/g,'-').replace(/[\u2018\u2019]/g,"'").replace(/[\u201c\u201d]/g,'"').replace(/\r/g,'')].map(c=>{if(c==='\n')return c;try{font.encodeText(c);return c;}catch{return '?';}}).join('');}
export function wrap(value:string,font:PDFFont,size:number,width:number) {const lines:string[]=[];for(const paragraph of clean(value,font).split('\n')){let row='';for(let word of paragraph.split(/\s+/).filter(Boolean)){if(row&&font.widthOfTextAtSize(row+' '+word,size)>width){lines.push(row);row='';}while(font.widthOfTextAtSize(word,size)>width){let n=1;while(n<word.length&&font.widthOfTextAtSize(word.slice(0,n+1),size)<=width)n++;if(row){lines.push(row);row='';}lines.push(word.slice(0,n));word=word.slice(n);}row+=(row?' ':'')+word;}lines.push(row);}return lines;}

type Illustration={title:string;caption?:string;image:PDFImage};
export function renderSafetySection({doc,section,number,regular,bold,header,illustrations}: {doc:PDFDocument;section:SafetyPage;number:number;regular:PDFFont;bold:PDFFont;header:(p:PDFPage)=>void;illustrations:Illustration[]}) {
 const {green,gold,ink,muted,line,pale}=safetyColors,W=516,L=48,B=66;
 let p!:PDFPage,y=0;
 const text=(value:string,x:number,baseline:number,size=9.5,font=regular,color=ink)=>p.drawText(clean(value,font),{x,y:baseline,size,font,color});
 function start(continued=false){p=doc.addPage([612,792]);header(p);y=666;const title=`${number}. ${section.title}${continued?' - continued':''}`;for(const row of wrap(title,bold,15,W)){text(row,L,y,15,bold,green);y-=20;}p.drawLine({start:{x:L,y:y-2},end:{x:L+W,y:y-2},color:gold,thickness:1});y-=24;}
 function ensure(height:number){if(y-height<B)start(true);}
 function heading(title:string,continued=false,minBody=24){const rows=wrap(title+(continued?' - continued':''),bold,10.5,W-20);ensure(rows.length*14+18+minBody);const h=rows.length*14+8;p.drawRectangle({x:L,y:y-h+10,width:W,height:h,color:pale});let baseline=y-3;for(const row of rows){text(row,L+10,baseline,10.5,bold,green);baseline-=14;}y-=h+6;}
 function body(value:string,label=''){const paragraphs=(value.trim()||'Not entered').split('\n');for(const [i,paragraph] of paragraphs.entries()){
  const isList=paragraphs.length>1&&paragraph.trim(),numbered=/^\d+[.)]\s/.test(paragraph),prefix=isList&&!numbered?'• ':'';
  const rows=wrap(prefix+paragraph.trim(),regular,9.5,W-20);for(const [n,row] of rows.entries()){if(y<B+14){start(true);if(label)heading(label,true);}text(row,L+10+(n&&prefix?8:0),y,9.5);y-=14;}if(i<paragraphs.length-1)y-=5;
 }y-=9;}
 function narrative(label:string,value:string){
  if(!value.trim()){const rows=wrap(label+': Not entered',regular,9.5,W-20);ensure(rows.length*14+12);for(const row of rows){text(row,L+10,y,9.5,regular,muted);y-=14;}y-=10;return;}
  const paragraphs=value.trim().split('\n'),height=wrap(label,bold,10.5,W-20).length*14+23+paragraphs.reduce((n,t)=>n+wrap(t,regular,9.5,W-28).length*14+5,0)+10;
  if(height<500)ensure(height);
  heading(label);body(value,label);
 }
 function table(title:string,columns:{label:string;weight?:number}[],rows:string[][]){
  const weight=columns.reduce((n,c)=>n+(c.weight||1),0),widths=columns.map(c=>W*(c.weight||1)/weight),headers=columns.map((c,i)=>wrap(c.label,bold,8.7,widths[i]-14)),hh=Math.max(...headers.map(c=>c.length))*12+16;
  function tableHeader(continued=false){heading(title,continued,hh+32);p.drawRectangle({x:L,y:y-hh+8,width:W,height:hh,color:green});let x=L;headers.forEach((cell,i)=>{cell.forEach((row,n)=>text(row,x+7,y-5-n*12,8.7,bold,rgb(1,1,1)));x+=widths[i];});y-=hh;}
  function next(){start(true);tableHeader(true);}
  tableHeader();
  if(!rows.length)rows=[columns.map((_,i)=>i?'':'No entries')];
  rows.forEach((row,index)=>{
   const cells=columns.map((_,i)=>wrap(row[i]?.trim()||'-',regular,9,widths[i]-14)),count=Math.max(...cells.map(c=>c.length));let offset=0;
   if(count*12+16<=440&&count*12+16>y-B)next();
   while(offset<count){let available=Math.floor((y-B-16)/12);if(available<1){next();available=Math.floor((y-B-16)/12);}const take=Math.min(count-offset,available),h=take*12+16;let x=L;
    cells.forEach((cell,i)=>{p.drawRectangle({x,y:y-h+8,width:widths[i],height:h,color:index%2?pale:rgb(1,1,1),borderColor:line,borderWidth:.55});cell.slice(offset,offset+take).forEach((row,n)=>text(row,x+7,y-5-n*12,9));x+=widths[i];});y-=h;offset+=take;if(offset<count)next();
   }
  });y-=20;
 }
 start();
 // Emergency numbers and hospital details belong at the start, before procedures.
 const emergency=(section.layoutKey||section.id)==='emergency';
 const urgent=emergency?section.fields.filter(f=>['emergency-0','emergency-1','hospital-phone','emergency-5','medical-arrangements'].includes(f.id)):[];
 if(urgent.length)table('Emergency contacts and medical arrangements',[{label:'Detail',weight:1.3},{label:'Site information',weight:3}],urgent.map(f=>[f.label,f.value||'Not entered']));
 for(const block of section.blocks||[]){
  if(block.type==='table')table(block.title,block.columns,block.rows.map(r=>block.columns.map(c=>r.cells[c.id]||'')));
  if(block.type==='questions'){
   table(block.title,[{label:'Requirement',weight:2},{label:'Assessment',weight:1},{label:'Site notes',weight:2}],block.rows.map(r=>[r.label,r.value||'Not assessed',r.notes]));
  }
  if(block.type==='steps'){
   heading(block.title,false,70);if(!block.rows.length)body('No procedure steps entered.');
   block.rows.forEach((row,index)=>{narrative(`Step ${index+1}: ${row.title||'Untitled step'}`,row.body);});
  }
  if(block.type==='checklist'){
   heading(block.title);const gap=8,w=(W-gap*2)/3;
   for(let i=0;i<block.rows.length;i+=3){
    const group=block.rows.slice(i,i+3).map(r=>[
     ...wrap(r.label||'Unnamed item',bold,9,w-18).map(value=>({value,bold:true,status:false})),
     {value:r.value||'Not assessed',bold:true,status:true},
     ...wrap(r.notes||'Details not entered',regular,8.5,w-18).map(value=>({value,bold:false,status:false})),
    ]);const count=Math.max(...group.map(g=>g.length));let offset=0;
    if(count*12+20<=480&&y-count*12-20<B){start(true);heading(block.title,true);}
    while(offset<count){let available=Math.floor((y-B-20)/12);if(available<2){start(true);heading(block.title,true);available=Math.floor((y-B-20)/12);}const take=Math.min(count-offset,available),h=take*12+20;
     group.forEach((cell,index)=>{const x=L+index*(w+gap);p.drawRectangle({x,y:y-h+8,width:w,height:h,color:pale,borderColor:line,borderWidth:.6});cell.slice(offset,offset+take).forEach((r,n)=>{const baseline=y-7-n*12;if(r.status){p.drawRectangle({x:x+9,y:baseline-1,width:7,height:7,borderColor:green,borderWidth:.8});if(['Required','Task specific'].includes(r.value)){p.drawLine({start:{x:x+10,y:baseline+2},end:{x:x+12,y:baseline},color:green,thickness:1});p.drawLine({start:{x:x+12,y:baseline},end:{x:x+16,y:baseline+5},color:green,thickness:1});}}text(r.value,x+(r.status?22:9),baseline,r.bold?9:8.5,r.bold?bold:regular,r.bold?green:ink);});});y-=h+8;offset+=take;if(offset<count){start(true);heading(block.title,true);}
    }
   }y-=8;
  }
 }
 for(const field of section.fields.filter(f=>!urgent.includes(f)))narrative(field.label,field.value);
 for(const illustration of illustrations){
  start(true);heading(illustration.title);if(illustration.caption?.trim())body(illustration.caption,illustration.title);
  // Keep the complete image at its original aspect ratio; never crop a map.
  if(y-B<280){start(true);heading(illustration.title,true);}
  const factor=Math.min(W/illustration.image.width,(y-B-12)/illustration.image.height),width=illustration.image.width*factor,height=illustration.image.height*factor;
  p.drawImage(illustration.image,{x:L+(W-width)/2,y:y-height,width,height});y-=height+12;
 }
}
