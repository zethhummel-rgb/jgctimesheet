import { PDFDocument, StandardFonts, rgb, degrees, type PDFFont, type PDFPage } from 'pdf-lib';
import { clean, wrap, renderSafetySection } from './site-specific-pdf-layout';
import { siteSpecificPdfPages } from './site-specific-pdf-content';
import { sitePlanErrors, type SiteSpecificPlan, type SafetyAttachment } from './site-specific';
import { DOCUMENT_LIMITS, imageBudget, imageDimensions } from './document-budget';
import {preflightPdf,type PdfInputBudget} from './pdf-input-budget';
const green=rgb(.07,.25,.19),gold=rgb(.68,.53,.18),ink=rgb(.10,.17,.14),muted=rgb(.34,.41,.38),line=rgb(.8,.85,.82),pale=rgb(.94,.96,.95);
export async function buildSiteSpecificPdf(options:{plan:SiteSpecificPlan;logoBytes:Uint8Array;readAttachment:(item:SafetyAttachment)=>Promise<Blob>;progress?:(message:string)=>void}) {
 const {plan}=options,errors=sitePlanErrors(plan);if(errors.length)throw new Error('Complete: '+errors.join(', ')+'.');
 const pages=siteSpecificPdfPages(plan);
 const mapItem=plan.hospitalMap?.included&&pages.some(p=>p.id==='emergency')?plan.hospitalMap:undefined;
 const inlineItems=[...pages.flatMap(p=>p.illustrations||[]),...(mapItem?[mapItem]:[])],inlineIds=new Set(inlineItems.map(i=>i.id));
 const selected=[...new Map([...plan.attachments.filter(a=>a.included&&!inlineIds.has(a.id)),...inlineItems].map(i=>[i.id,i])).values()],sources:{item:SafetyAttachment;bytes:Uint8Array;pdf?:PDFDocument;type:string}[]=[];
 if(selected.length>DOCUMENT_LIMITS.attachments)throw new Error('Select at most 60 supporting documents and images.');
 let inputBytes=0,sourcePages=0,imagePixels=0,sourceObjects=0;const pdfBudget:PdfInputBudget={decodedBytes:0,objects:0,imagePixels:0};
 for(const [i,item] of selected.entries()){options.progress?.(`Loading attachment ${i+1} of ${selected.length}: ${item.title}`);try{let blob=await options.readAttachment(item);inputBytes+=blob.size;if(blob.size>20*1024*1024||inputBytes>DOCUMENT_LIMITS.inputBytes)throw new Error('Supporting files exceed 20 MB per file or 80 MB combined.');let bytes=new Uint8Array(await blob.arrayBuffer());let type=String(blob.type||item.fileType||'').toLowerCase();if(new TextDecoder().decode(bytes.slice(0,5))==='%PDF-'){if(inlineIds.has(item.id))throw new Error('Use a JPG, PNG or WebP image for a section map or photo.');preflightPdf(bytes,pdfBudget);const pdf=await PDFDocument.load(bytes);if(pdf.isEncrypted)throw new Error('Password-protected PDF. Use an unlocked copy.');sourcePages+=pdf.getPageCount();sourceObjects+=pdf.context.enumerateIndirectObjects().length;if(sourcePages>DOCUMENT_LIMITS.pdfPages||sourceObjects>120000)throw new Error('Supporting PDFs exceed 400 pages or the document complexity limit.');for(const page of pdf.getPages()){const size=page.getSize();if(!Number.isFinite(size.width)||!Number.isFinite(size.height)||size.width<=0||size.height<=0||size.width>14400||size.height>14400)throw new Error('A PDF page is too large. Save it at its normal paper size.');}const form=pdf.getForm();if(form.getFields().length)form.flatten();sources.push({item,bytes,pdf,type:'application/pdf'});}else{const size=imageDimensions(bytes,type);imageBudget(size.width,size.height);imagePixels+=size.width*size.height;if(imagePixels>DOCUMENT_LIMITS.totalImagePixels)throw new Error('The selected images exceed 60 megapixels combined. Resize the photos first.');if(bytes[0]===0x89&&bytes[1]===0x50)type='image/png';else if(bytes[0]===0xff&&bytes[1]===0xd8)type='image/jpeg';else if(type==='image/webp'){const bitmap=await createImageBitmap(blob);imageBudget(bitmap.width,bitmap.height);const canvas=new OffscreenCanvas(bitmap.width,bitmap.height);canvas.getContext('2d')!.drawImage(bitmap,0,0);bitmap.close();blob=await canvas.convertToBlob({type:'image/png'});bytes=new Uint8Array(await blob.arrayBuffer());type='image/png';}else throw new Error('Choose a PDF, JPG, PNG or WebP file.');sources.push({item,bytes,type});}}catch(e){throw new Error(`${item.title}: ${e instanceof Error?e.message:'attachment could not be read'}. No incomplete PDF was exported.`);}}
 options.progress?.('Creating the combined PDF…');
 const doc=await PDFDocument.create(),regular=await doc.embedFont(StandardFonts.Helvetica),bold=await doc.embedFont(StandardFonts.HelveticaBold),logo=await doc.embedPng(options.logoBytes);
 const addPage=doc.addPage.bind(doc);doc.addPage=(...args:Parameters<typeof doc.addPage>)=>{if(doc.getPageCount()>=DOCUMENT_LIMITS.pdfPages+100)throw new Error('The combined plan exceeds 500 pages. Split it into separate plans.');return addPage(...args);};
 doc.setTitle(`${plan.project} - Site Specific Health and Safety Plan`);doc.setAuthor(plan.preparedBy);doc.setSubject(`John Gordon Construction · Job ${plan.jobNumber} · Revision ${plan.revision}`);
 const attachments=sources.filter(s=>!inlineIds.has(s.item.id));
 const illustrations=new Map<string,Awaited<ReturnType<typeof doc.embedPng>>>();
 for(const source of sources.filter(s=>inlineIds.has(s.item.id))){illustrations.set(source.item.id,source.type==='image/png'?await doc.embedPng(source.bytes):await doc.embedJpg(source.bytes));source.bytes=new Uint8Array();}
 const contentsTitles=[...pages.map((p,i)=>`${i+1}. ${p.title}`),...attachments.map((s,i)=>`Appendix ${i+1}: ${s.item.title}`)],tocGroups:{start:number;end:number}[]=[];
 let tocStart=0,tocHeight=0;contentsTitles.forEach((title,index)=>{const height=wrap(title,regular,10,456).length*14+12;if(tocHeight+height>508){tocGroups.push({start:tocStart,end:index});tocStart=index;tocHeight=0;}tocHeight+=height;});if(contentsTitles.length)tocGroups.push({start:tocStart,end:contentsTitles.length});const tocPages=tocGroups.length;
 const cover=doc.addPage([612,792]),contents=Array.from({length:tocPages},()=>doc.addPage([612,792]));
 const text=(page:PDFPage,value:string,x:number,y:number,size=10,font=regular,color=ink)=>page.drawText(clean(value,font),{x,y,size,font,color});
 const rule=(page:PDFPage,y:number,color=line,thickness=.6)=>page.drawLine({start:{x:48,y},end:{x:564,y},color,thickness});
 function header(page:PDFPage){page.drawImage(logo,{x:48,y:725,width:155,height:155*logo.height/logo.width});text(page,'JOHN GORDON CONSTRUCTION',48,710,8,bold,green);text(page,`Job ${plan.jobNumber} · Rev ${plan.revision}`,360,735,9,regular,muted);rule(page,694,green,2);}
 header(cover);text(cover,'SITE SPECIFIC',48,616,25,bold,green);text(cover,'HEALTH AND SAFETY PLAN',48,581,22,bold,green);rule(cover,560,gold,1.5);
 let y=515;for(const row of wrap(plan.project,bold,17,516)){text(cover,row,48,y,17,bold);y-=24;}
 const info=[['Job number',plan.jobNumber],['Site address',plan.address],['Client / owner',plan.client],['Prepared by',plan.preparedBy],['Plan date',plan.planDate],['Revision',plan.revision]].filter(([,value])=>value.trim());
 for(const [label,value] of info){y-=24;text(cover,label.toUpperCase(),48,y,8,bold,muted);y-=17;for(const row of wrap(value,regular,11,516)){if(y<80)throw new Error('The cover information is too long. Shorten the project name or address.');text(cover,row,48,y,11);y-=15;}}
 const entries:{title:string;page:number}[]=[];
 for(const [index,section] of pages.entries()){
  entries.push({title:contentsTitles[index],page:doc.getPageCount()+1});
  const sectionImages=(section.illustrations||[]).filter(i=>i.included).map(i=>({title:i.title,caption:i.caption,image:illustrations.get(i.id)!}));
  if(section.id==='emergency'&&mapItem){const hospital=section.fields.find(f=>f.id==='emergency-1')?.value||'',directions=section.fields.find(f=>f.id==='emergency-5')?.value||'';sectionImages.push({title:'Nearest hospital map',caption:[hospital,directions].filter(Boolean).join('\n'),image:illustrations.get(mapItem.id)!});}
  renderSafetySection({doc,section,number:index+1,regular,bold,header,illustrations:sectionImages});
 }
 for(const [attachmentIndex,source] of attachments.entries()){entries.push({title:contentsTitles[pages.length+attachmentIndex],page:doc.getPageCount()+1});if(source.pdf){
  const originals=source.pdf.getPages(),boxes=originals.map(original=>{const b=original.getCropBox();return {left:b.x,bottom:b.y,right:b.x+b.width,top:b.y+b.height};});
  const embedded=await doc.embedPages(originals,boxes);
  for(const [index,original] of originals.entries()){
   const rotation=((original.getRotation().angle%360)+360)%360,page=embedded[index];
   const sideways=rotation===90||rotation===270,out=doc.addPage([sideways?page.height:page.width,(sideways?page.width:page.height)+28]);
   const position=rotation===90?{x:0,y:28+page.width}:rotation===180?{x:page.width,y:28+page.height}:rotation===270?{x:page.height,y:28}:{x:0,y:28};
   out.drawPage(page,{...position,width:page.width,height:page.height,rotate:degrees(-rotation)});
  }
 }else{const image=source.type==='image/png'?await doc.embedPng(source.bytes):await doc.embedJpg(source.bytes);const p=doc.addPage([612,792]);header(p);text(p,source.item.title,48,666,11,bold,green);const factor=Math.min(516/image.width,560/image.height);p.drawImage(image,{x:(612-image.width*factor)/2,y:86+(560-image.height*factor)/2,width:image.width*factor,height:image.height*factor});}source.pdf=undefined;source.bytes=new Uint8Array();}
 contents.forEach((p,index)=>{header(p);text(p,'PLAN CONTENTS'+(index?' - continued':''),48,650,19,bold,green);text(p,'Numbered plan sections and complete supporting documents',48,624,9,regular,muted);let y=592;for(const entry of entries.slice(tocGroups[index].start,tocGroups[index].end)){const rows=wrap(entry.title,regular,10,456);text(p,String(entry.page),540,y,10,bold,green);for(const row of rows){text(p,row,48,y,10);y-=14;}rule(p,y+3);y-=12;}});
 const total=doc.getPageCount();for(const [index,p] of doc.getPages().entries()){const width=p.getWidth();const label=`JGC · Job ${plan.jobNumber} · Revision ${plan.revision}`;text(p,label,Math.min(48,width*.06),12,7,regular,muted);const count=`Page ${index+1} of ${total}`;text(p,count,width-regular.widthOfTextAtSize(count,7)-Math.min(48,width*.06),12,7,regular,muted);}
 if(total>DOCUMENT_LIMITS.pdfPages+100)throw new Error('The combined plan exceeds 500 pages. Split it into separate plans.');const bytes=await doc.save();if(bytes.length>DOCUMENT_LIMITS.outputBytes)throw new Error('The combined PDF exceeds 50 MB. Resize images or split the supporting documents.');return {blob:new Blob([bytes as Uint8Array<ArrayBuffer>],{type:'application/pdf'}),pages:total};
}
