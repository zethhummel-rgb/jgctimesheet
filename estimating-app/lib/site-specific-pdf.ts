import { PDFDocument, StandardFonts, rgb, degrees, type PDFFont, type PDFPage } from 'pdf-lib';
import { sitePlanErrors, type SiteSpecificPlan, type SafetyAttachment } from './site-specific';
const green=rgb(.07,.25,.19),gold=rgb(.68,.53,.18),ink=rgb(.10,.17,.14),muted=rgb(.34,.41,.38),line=rgb(.8,.85,.82),pale=rgb(.94,.96,.95);
function clean(value:string,font:PDFFont) {return [...String(value).normalize('NFC').replace(/[\u2010-\u2015]/g,'-').replace(/[\u2018\u2019]/g,"'").replace(/[\u201c\u201d]/g,'"').replace(/\r/g,'')].map(c=>{if(c==='\n')return c;try{font.encodeText(c);return c;}catch{return '?';}}).join('');}
function wrap(value:string,font:PDFFont,size:number,width:number) {const lines:string[]=[];for(const paragraph of clean(value,font).split('\n')){let row='';for(let word of paragraph.split(/\s+/).filter(Boolean)){if(row&&font.widthOfTextAtSize(row+' '+word,size)>width){lines.push(row);row='';}while(font.widthOfTextAtSize(word,size)>width){let n=1;while(n<word.length&&font.widthOfTextAtSize(word.slice(0,n+1),size)<=width)n++;if(row){lines.push(row);row='';}lines.push(word.slice(0,n));word=word.slice(n);}row+=(row?' ':'')+word;}lines.push(row);}return lines;}
export async function buildSiteSpecificPdf(options:{plan:SiteSpecificPlan;logoBytes:Uint8Array;readAttachment:(item:SafetyAttachment)=>Promise<Blob>;progress?:(message:string)=>void}) {
 const {plan}=options,errors=sitePlanErrors(plan);if(errors.length)throw new Error('Complete: '+errors.join(', ')+'.');
 const mapItem=plan.hospitalMap?.included&&plan.pages.some(p=>p.id==='emergency'&&p.included)?plan.hospitalMap:undefined;
 const selected=[...plan.attachments.filter(a=>a.included&&a.id!==mapItem?.id),...(mapItem?[mapItem]:[])],sources:{item:SafetyAttachment;bytes:Uint8Array;pdf?:PDFDocument;type:string}[]=[];
 for(const [i,item] of selected.entries()){options.progress?.(`Loading attachment ${i+1} of ${selected.length}: ${item.title}`);try{let blob=await options.readAttachment(item);if(blob.size>20*1024*1024)throw new Error('Attachment exceeds 20 MB.');let bytes=new Uint8Array(await blob.arrayBuffer());let type=String(blob.type||item.fileType||'').toLowerCase();if(new TextDecoder().decode(bytes.slice(0,5))==='%PDF-'){if(item===mapItem)throw new Error('Use a JPG, PNG or WebP image for the hospital map.');const pdf=await PDFDocument.load(bytes);if(pdf.isEncrypted)throw new Error('Password-protected PDF. Use an unlocked copy.');const form=pdf.getForm();if(form.getFields().length)form.flatten();sources.push({item,bytes,pdf,type:'application/pdf'});}else{if(bytes[0]===0x89&&bytes[1]===0x50)type='image/png';else if(bytes[0]===0xff&&bytes[1]===0xd8)type='image/jpeg';else if(type==='image/webp'){const bitmap=await createImageBitmap(blob),canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;canvas.getContext('2d')!.drawImage(bitmap,0,0);bitmap.close();blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(v=>v?resolve(v):reject(new Error('Image conversion failed.')),'image/png'));bytes=new Uint8Array(await blob.arrayBuffer());type='image/png';}else throw new Error('Choose a PDF, JPG, PNG or WebP file.');sources.push({item,bytes,type});}}catch(e){throw new Error(`${item.title}: ${e instanceof Error?e.message:'attachment could not be read'}. No incomplete PDF was exported.`);}}
 options.progress?.('Creating the combined PDF…');
 const doc=await PDFDocument.create(),regular=await doc.embedFont(StandardFonts.Helvetica),bold=await doc.embedFont(StandardFonts.HelveticaBold),logo=await doc.embedPng(options.logoBytes);
 doc.setTitle(`${plan.project} - Site Specific Health and Safety Plan`);doc.setAuthor(plan.preparedBy);doc.setSubject(`John Gordon Construction · Job ${plan.jobNumber} · Revision ${plan.revision}`);
 const pages=plan.pages.filter(p=>p.included),attachments=sources.filter(s=>s.item!==mapItem),mapSource=sources.find(s=>s.item===mapItem),tocPages=Math.max(1,Math.ceil((pages.length+attachments.length)/32));
 const mapImage=mapSource?(mapSource.type==='image/png'?await doc.embedPng(mapSource.bytes):await doc.embedJpg(mapSource.bytes)):undefined;
 const cover=doc.addPage([612,792]),contents=Array.from({length:tocPages},()=>doc.addPage([612,792]));
 const text=(page:PDFPage,value:string,x:number,y:number,size=10,font=regular,color=ink)=>page.drawText(clean(value,font),{x,y,size,font,color});
 const rule=(page:PDFPage,y:number,color=line,thickness=.6)=>page.drawLine({start:{x:48,y},end:{x:564,y},color,thickness});
 function header(page:PDFPage){page.drawImage(logo,{x:48,y:725,width:155,height:155*logo.height/logo.width});text(page,'JOHN GORDON CONSTRUCTION',48,710,8,bold,green);text(page,`Job ${plan.jobNumber} · Rev ${plan.revision}`,360,735,9,regular,muted);rule(page,694,green,2);}
 header(cover);text(cover,'SITE SPECIFIC',48,616,25,bold,green);text(cover,'HEALTH AND SAFETY PLAN',48,581,22,bold,green);rule(cover,560,gold,1.5);
 let y=515;for(const row of wrap(plan.project,bold,17,516)){text(cover,row,48,y,17,bold);y-=24;}
 const info=[['Job number',plan.jobNumber],['Site address',plan.address],['Client / owner',plan.client||'Not entered'],['Prepared by',plan.preparedBy],['Plan date',plan.planDate],['Revision',plan.revision]];
 for(const [label,value] of info){y-=24;text(cover,label.toUpperCase(),48,y,8,bold,muted);y-=17;for(const row of wrap(value,regular,11,516)){if(y<80)throw new Error('The cover information is too long. Shorten the project name or address.');text(cover,row,48,y,11);y-=15;}}
 const entries:{title:string;page:number}[]=[];
 for(const section of pages){entries.push({title:section.title,page:doc.getPageCount()+1});let p=doc.addPage([612,792]);header(p);let y=664;
 function start(continued=false){if(continued){p=doc.addPage([612,792]);header(p);y=664;}for(const row of wrap(section.title+(continued?' - continued':''),bold,15,516)){text(p,row,48,y,15,bold,green);y-=20;}rule(p,y-3,gold,.7);y-=27;}
 start();
 function hospitalMap(){
  if(section.id!=='emergency'||!mapImage)return;
  const scale=Math.min(500/mapImage.width,300/mapImage.height),height=mapImage.height*scale,width=mapImage.width*scale;
  if(y-height-36<76)start(true);
  text(p,'Nearest hospital map',48,y,10.5,bold,green);y-=18;
  p.drawImage(mapImage,{x:48+(500-width)/2,y:y-height,width,height});y-=height+24;
 }
 let mapDrawn=false;
 for(const field of section.fields){
  const labelRows=wrap(field.label,bold,10.5,500);if(y-labelRows.length*15<105)start(true);
  for(const row of labelRows){text(p,row,48,y,10.5,bold,green);y-=15;}y-=2;
  const value=field.value.trim()||'Not entered';
  for(const row of wrap(value,regular,10,500)){if(y<76){start(true);text(p,`${field.label} - continued`,48,y,9,bold,muted);y-=18;}text(p,row,56,y,10);y-=14;}y-=18;
  if(field.id==='emergency-1'){hospitalMap();mapDrawn=true;}
 }
 if(!mapDrawn)hospitalMap();
 }
 for(const source of attachments){entries.push({title:source.item.title,page:doc.getPageCount()+1});if(source.pdf){
  const originals=source.pdf.getPages(),boxes=originals.map(original=>{const b=original.getCropBox();return {left:b.x,bottom:b.y,right:b.x+b.width,top:b.y+b.height};});
  const embedded=await doc.embedPages(originals,boxes);
  for(const [index,original] of originals.entries()){
   const rotation=((original.getRotation().angle%360)+360)%360,page=embedded[index];
   const sideways=rotation===90||rotation===270,out=doc.addPage([sideways?page.height:page.width,(sideways?page.width:page.height)+28]);
   const position=rotation===90?{x:0,y:28+page.width}:rotation===180?{x:page.width,y:28+page.height}:rotation===270?{x:page.height,y:28}:{x:0,y:28};
   out.drawPage(page,{...position,width:page.width,height:page.height,rotate:degrees(-rotation)});
  }
 }else{const image=source.type==='image/png'?await doc.embedPng(source.bytes):await doc.embedJpg(source.bytes);const p=doc.addPage([612,792]);header(p);text(p,source.item.title,48,666,11,bold,green);const factor=Math.min(516/image.width,560/image.height);p.drawImage(image,{x:(612-image.width*factor)/2,y:86+(560-image.height*factor)/2,width:image.width*factor,height:image.height*factor});}}
 contents.forEach((p,index)=>{header(p);text(p,'PLAN CONTENTS'+(index?' - continued':''),48,650,19,bold,green);text(p,'Included sections and complete supporting documents',48,624,9,regular,muted);let y=592;for(const entry of entries.slice(index*32,(index+1)*32)){const rows=wrap(entry.title,regular,10,440);const title=rows.length>1?rows[0]+'…':rows[0];text(p,title,48,y,10);text(p,String(entry.page),540,y,10,bold,green);rule(p,y-9);y-=16;}});
 const total=doc.getPageCount();for(const [index,p] of doc.getPages().entries()){const width=p.getWidth();const label=`JGC · Job ${plan.jobNumber} · Revision ${plan.revision}`;text(p,label,Math.min(48,width*.06),12,7,regular,muted);const count=`Page ${index+1} of ${total}`;text(p,count,width-regular.widthOfTextAtSize(count,7)-Math.min(48,width*.06),12,7,regular,muted);}
 const bytes=await doc.save();return {blob:new Blob([bytes as Uint8Array<ArrayBuffer>],{type:'application/pdf'}),pages:total};
}
