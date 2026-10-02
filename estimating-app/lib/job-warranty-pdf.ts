import { PDFDocument, StandardFonts, rgb, type PDFPage, type PDFFont } from 'pdf-lib';
import { warrantyDate, warrantyFieldErrors, warrantyTemplateV1, type JobWarranty, type WarrantyRevision } from './job-warranty';

type WarrantyDocument=Pick<JobWarranty,'fields'|'templateVersion'> & {revision:number};
const green=rgb(.065,.25,.19),gold=rgb(.70,.54,.17),ink=rgb(.14,.17,.16),muted=rgb(.36,.40,.38),line=rgb(.79,.83,.81),pale=rgb(.92,.95,.93);
const printable=(v:string)=>v.normalize('NFC').replace(/[\u2010-\u2015]/g,'-').replace(/[\u2018\u2019]/g,"'").replace(/[\u201c\u201d]/g,'"').replace(/\u00a0/g,' ');
function safeText(v:string,font:PDFFont) {
  return [...printable(v)].map(c=>{try{font.encodeText(c);return c;}catch{return '?';}}).join('');
}
function wrap(value:string,font:PDFFont,size:number,width:number) {
  const lines:string[]=[];
  for(const paragraph of safeText(value,font).split(/\r?\n/)) {
    let row='';
    for(const word of paragraph.split(/\s+/).filter(Boolean)) {
      if(row&&font.widthOfTextAtSize(row+' '+word,size)>width){lines.push(row);row='';}
      let remaining=word;
      while(font.widthOfTextAtSize(remaining,size)>width) {
        let end=1;while(end<remaining.length&&font.widthOfTextAtSize(remaining.slice(0,end+1),size)<=width)end++;
        if(row){lines.push(row);row='';}
        lines.push(remaining.slice(0,end));remaining=remaining.slice(end);
      }
      row+=(row?' ':'')+remaining;
    }
    lines.push(row);
  }
  return lines;
}
export async function buildWarrantyPdf(options:{warranty:WarrantyDocument;logoBytes:Uint8Array;signatureBytes:Uint8Array}) {
  const {warranty}=options,fields=warranty.fields,terms=warrantyTemplateV1;
  if(warranty.templateVersion!==1)throw new Error('This warranty template is not supported.');
  if(Object.keys(warrantyFieldErrors(fields)).length)throw new Error('Complete the warranty information before downloading.');
  const doc=await PDFDocument.create(),regular=await doc.embedFont(StandardFonts.Helvetica),bold=await doc.embedFont(StandardFonts.HelveticaBold);
  const logo=await doc.embedPng(options.logoBytes),signature=await doc.embedPng(options.signatureBytes),pages:PDFPage[]=[];
  doc.setTitle(`${fields.owner} - ${fields.project} - JGC Warranty`);doc.setAuthor('John Gordon Construction Inc.');doc.setSubject(`Field Warranty - Revision ${warranty.revision}`);
  const text=(p:PDFPage,value:string,x:number,y:number,size=9.5,font=regular,color=ink)=>p.drawText(safeText(value,font),{x,y,size,font,color});
  const rule=(p:PDFPage,y:number,color=line,thickness=.6)=>p.drawLine({start:{x:54,y},end:{x:558,y},color,thickness});
  const paragraph=(p:PDFPage,value:string,x:number,y:number,width=504,size=9.5,font=regular)=>{const rows=wrap(value,font,size,width);rows.forEach((row,i)=>text(p,row,x,y-i*(size*1.4),size,font));return y-rows.length*(size*1.4);};
  const heading=(p:PDFPage,value:string,y:number)=>{text(p,value,54,y,12.3,bold,green);rule(p,y-7,gold,.8);return y-23;};
  const makePage=()=>{
    const p=doc.addPage([612,792]);pages.push(p);
    p.drawImage(logo,{x:54,y:706,width:204,height:204*logo.height/logo.width});
    text(p,'GENERAL CONTRACTORS',54,693,7.7,bold,green);
    const contacts=['613-932-1293','info@johngordonconstruction.com','www.johngordonconstruction.com','830 Campbell Street, Unit #3','Cornwall, Ontario  K6H 6L7'];
    contacts.forEach((v,i)=>{const font=i===0?bold:regular;text(p,v,558-font.widthOfTextAtSize(v,7.5),754-i*11,7.5,font,i===0?ink:muted);});
    rule(p,671,green,3);return p;
  };
  let p=makePage();rule(p,653,gold,1);
  const title='FIELD WARRANTY';text(p,title,(612-bold.widthOfTextAtSize(title,22))/2,627,22,bold,green);
  const subtitle='CONTRACTORS GUARANTEE';text(p,subtitle,(612-bold.widthOfTextAtSize(subtitle,8.8))/2,608,8.8,bold,gold);
  let y=591;
  const rows:[string,string][]=[['Owner',fields.owner],['Building',fields.building],['Location',fields.location],['Project Title',fields.project],['Date of completion',warrantyDate(fields.completionDate)]];
  for(const [label,value] of rows) {
    const lines=wrap(value, label==='Project Title'?bold:regular,8.5,390),height=Math.max(22,lines.length*11.7+10);
    p.drawRectangle({x:54,y:y-height,width:504,height,color:rgb(.965,.975,.97),borderColor:line,borderWidth:.5});
    p.drawRectangle({x:54,y:y-height,width:101,height,color:pale,borderColor:line,borderWidth:.5});
    text(p,label,60,y-14,8.3,bold,green);lines.forEach((v,i)=>text(p,v,161,y-14-i*11.7,8.5,label==='Project Title'?bold:regular));y-=height;
  }
  y=heading(p,'Warranty Coverage',y-35);
  y=paragraph(p,terms.coverage,54,y);y-=9;
  y=paragraph(p,terms.introduction,54,y,504,9.5,bold);y-=8;
  function continued(){p=makePage();y=heading(p,'Warranty Conditions - Continued',645);}
  function condition(index:number) {
    const rows=wrap(terms.conditions[index],regular,9.5,467),height=rows.length*13.3+8;
    if(y-height<68)continued();
    text(p,`${index+1}.`,72,y,9.5);rows.forEach((v,i)=>text(p,v,91,y-i*13.3,9.5));y-=height;
  }
  for(let i=0;i<3;i++)condition(i);
  continued();for(let i=3;i<7;i++)condition(i);
  if(y<306){p=makePage();y=645;}
  y=heading(p,'Warranty Authorization',y-11);text(p,'Issued by John Gordon Construction Inc.',54,y,8,bold,muted);
  p.drawImage(signature,{x:54,y:y-57,width:241,height:241*signature.height/signature.width});
  y-=57;p.drawLine({start:{x:54,y},end:{x:362,y},color:line,thickness:.6});
  text(p,'Jeff Vandrish',54,y-13,9.5,bold);text(p,'President',54,y-26,8.5,regular,muted);
  text(p,'Date- '+warrantyDate(fields.issueDate),366,y-24,8.5,bold,muted);p.drawLine({start:{x:366,y:y-29},end:{x:558,y:y-29},color:line,thickness:.6});
  y-=65;
  const acceptanceRows=wrap(terms.acceptance,regular,9.5,488),acceptanceHeight=acceptanceRows.length*13.3+35;
  p.drawRectangle({x:54,y:y-acceptanceHeight,width:504,height:acceptanceHeight,color:pale,borderColor:line,borderWidth:.6});
  text(p,'OWNER ACCEPTANCE',62,y-16,8.5,bold,green);paragraph(p,terms.acceptance,62,y-32,488);y-=acceptanceHeight+43;
  const officialRows=wrap(fields.ownerOfficial,regular,9,300);officialRows.forEach((v,i)=>text(p,v,54,y-i*12,9));
  const ownerDate=warrantyDate(fields.ownerDate);text(p,ownerDate,374,y,9);
  y-=Math.max(officialRows.length*12,12)+3;
  p.drawLine({start:{x:54,y},end:{x:370,y},color:line,thickness:.6});p.drawLine({start:{x:374,y},end:{x:554,y},color:line,thickness:.6});
  text(p,'Authorized Official',54,y-12,8.5,bold,muted);text(p,'Date',374,y-12,8.5,bold,muted);
  pages.forEach((page,i)=>{
    rule(page,35);
    const label=`FIELD WARRANTY | ${fields.project.toUpperCase()} | REV ${warranty.revision}`;
    let size=6.8;while(size>4&&bold.widthOfTextAtSize(safeText(label,bold),size)>422)size-=.2;
    text(page,label,54,25,size,regular,muted);text(page,`PAGE ${i+1} OF ${pages.length}`,512,25,6.5,regular,muted);
  });
  return doc.save();
}
export function warrantyRevisionDocument(record:WarrantyRevision):WarrantyDocument {return {fields:record.fields,templateVersion:record.templateVersion,revision:record.number};}
