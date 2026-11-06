import { PDFDocument, StandardFonts, rgb, type PDFPage } from 'pdf-lib';
import type { AppState, Job } from './estimator-data';
import { safetyTextRuns, safetyTextDefault } from './site-specific-rich-text';
import { rfiOverdue, type Rfi } from './rfi-workflow';

export async function buildRfiPdf({job,state,records,register=false,logoBytes,photos=[]}:{job:Job;state:AppState;records:Rfi[];register?:boolean;logoBytes:Uint8Array;photos?:{name:string;jpeg:string}[]}) {
  const doc=await PDFDocument.create(),font=await doc.embedFont(StandardFonts.Helvetica),bold=await doc.embedFont(StandardFonts.HelveticaBold),logo=await doc.embedPng(logoBytes);
  const italic=await doc.embedFont(StandardFonts.HelveticaOblique), boldItalic=await doc.embedFont(StandardFonts.HelveticaBoldOblique);
  const green=rgb(.04,.25,.18),ink=rgb(.09,.16,.19),muted=rgb(.32,.39,.4),line=rgb(.72,.77,.76),pale=rgb(.94,.97,.95);
  const clean=(v:unknown)=>String(v??'').replace(/[\u2013\u2014]/g,'-').replace(/[\u2018\u2019]/g,"'").replace(/[\u201c\u201d]/g,'"').replace(/\u2026/g,'...').normalize('NFKD').replace(/[^\x20-\x7e\n\u2022]/g,'');
  const quote=state.quotes.find(q=>q.id===job.quoteId),client=job.portalCustomer||state.clients.find(c=>c.id===job.clientId)?.name||'',site=job.portalSiteName||quote?.site||'',address=job.portalAddress||quote?.address||'';
  let page!:PDFPage;let y=0;
  const text=(s:string,x:number,yy:number,size=10,strong=false,color=ink)=>page.drawText(clean(s),{x,y:yy,size,font:strong?bold:font,color});
  function newPage(){page=doc.addPage([612,792]);const dim=logo.scaleToFit(160,55);page.drawImage(logo,{x:40,y:716,width:dim.width,height:dim.height});text(register?'RFI REGISTER':'REQUEST FOR INFORMATION',265,750,14,true,green);text(`JOB ${job.jobNumber}`,265,731,10,true);page.drawLine({start:{x:40,y:704},end:{x:572,y:704},color:green,thickness:2});y=684;}
  const ensure=(height:number)=>{if(y-height<52)newPage();};
  function wrap(value:string,width=508,size=10){const result:string[]=[];for(const paragraph of clean(value).split('\n')){let current='';for(const ch of paragraph){if(font.widthOfTextAtSize(current+ch,size)>width){let cut=current.lastIndexOf(' ');if(cut>0){result.push(current.slice(0,cut));current=current.slice(cut+1)+ch;}else{result.push(current);current=ch;}}else current+=ch;}result.push(current);}return result;}
  function body(value:string,size=10){for(const l of wrap(value,508,size)){ensure(15);text(l,52,y,size);y-=15;}y-=8;}
  function section(title:string,value:string){ensure(48);page.drawRectangle({x:40,y:y-8,width:532,height:24,color:pale,borderColor:line,borderWidth:.6});text(title.toUpperCase(),50,y,9,true,green);y-=30;body(value||'Not recorded');}
  function caption(label:string) { ensure(42);text(label.toUpperCase(),40,y,9,true,green);y-=20; }
  function question(r:Rfi) {
    const runs=r.questionRich?safetyTextRuns(r.questionRich):[{text:r.question,style:safetyTextDefault}];
    type Word={value:string;face:typeof font;size:number;underline:boolean;highlight:boolean};
    let row:Word[]=[],width=0;
    const flush=()=>{
      const height=Math.max(11,...row.map(t=>t.size))+6;
      ensure(height);let x=40;
      for(const part of row) {
        const w=part.face.widthOfTextAtSize(part.value,part.size);
        if(part.highlight)page.drawRectangle({x,y:y-3,width:w,height:part.size+4,color:rgb(1,.94,.64)});
        page.drawText(part.value,{x,y,size:part.size,font:part.face,color:ink});
        if(part.underline)page.drawLine({start:{x,y:y-1.5},end:{x:x+w,y:y-1.5},thickness:.7,color:ink});
        x+=w;
      }
      y-=height;row=[];width=0;
    };
    for(const run of runs) {
      const size=run.style.points||11,face=run.style.bold?(run.style.italic?boldItalic:bold):(run.style.italic?italic:font);
      const put=(value:string)=>{row.push({value,face,size,underline:!!run.style.underline,highlight:!!run.style.highlight});width+=face.widthOfTextAtSize(value,size);};
      for(const part of clean(run.text).match(/\n|[^\S\n]+|[^\s]+/g)||[]) {
        if(part==='\n'){flush();continue;}
        const length=face.widthOfTextAtSize(part,size);
        if(width && width+length>532)flush();
        if(!width&&!part.trim())continue;
        if(length<=532){put(part);continue;}
        for(const ch of part){if(width+face.widthOfTextAtSize(ch,size)>532)flush();put(ch);}
      }
    }
    if(row.length)flush();y-=16;
  }
  newPage();
  if(register){
    body([job.project,client,site,address].filter(Boolean).join(' · '),11);
    body(`${records.length} RFIs | ${records.filter(r=>r.status==='Open / Sent').length} outstanding | ${records.filter(r=>rfiOverdue(r)).length} overdue\nGenerated ${new Date().toLocaleDateString('en-CA')}`);
    const head=()=>{ensure(55);page.drawRectangle({x:40,y:y-9,width:532,height:25,color:green});[['RFI / SUBJECT',48],['SENT TO',288],['STATUS',390],['DUE',493]].forEach(([s,x])=>text(String(s),Number(x),y,8,true,rgb(1,1,1)));y-=29;};head();
    for(const r of records){const cols=[wrap(`${r.number} - ${r.subject}`,226,9),wrap(r.sentTo||'Not sent',90,9),wrap(r.status+(rfiOverdue(r)?' / OVERDUE':''),90,9),wrap(r.dueDate||'-',70,9)];const count=Math.max(...cols.map(c=>c.length));for(let i=0;i<count;i++){if(y<67){newPage();head();}cols.forEach((col,k)=>{if(col[i])text(col[i],[48,288,390,493][k],y,9);});y-=13;}page.drawLine({start:{x:40,y:y-3},end:{x:572,y:y-3},color:line,thickness:.5});y-=15;}
  }else for(const [index,r] of records.entries()){
    if(index)newPage();
    text(r.number,40,y,12,true,green);y-=32;
    for(const title of wrap(r.subject,465,23)){ensure(32);text(title,40,y,23,true);y-=30;}
    y-=4;body([job.project,[client,site].filter(Boolean).join(' · '),address].filter(Boolean).join('\n'),11);
    const date=(v:string)=>v?new Date(v+'T12:00:00').toLocaleDateString('en-CA',{year:'numeric',month:'short',day:'numeric'}):'';
    const facts=[['Raised by',r.raisedBy],['Sent to',r.sentTo],[r.sentDate?'Date issued':'Date created',date(r.sentDate||r.createdDate)],['Reply requested by',date(r.dueDate)]].filter(([,v])=>v);
    for(let i=0;i<facts.length;i+=2) {
      const pair=facts.slice(i,i+2),lines=pair.map(([,v])=>wrap(v,245,11));
      const height=22+14*Math.max(...lines.map(l=>l.length));ensure(height);
      pair.forEach(([key],k)=>{const x=40+k*270;text(key.toUpperCase(),x,y,8,true,muted);lines[k].forEach((v,n)=>text(v,x,y-16-14*n,11));});y-=height;
    }
    y-=8;ensure(56);page.drawLine({start:{x:40,y},end:{x:572,y},color:line,thickness:.7});y-=22;
    caption('Clarification requested');question(r);
    if(r.references.trim()){caption('Drawing and specification references');body(r.references);}
    if(r.attachments.length){caption('Supporting links');body(r.attachments.map(a=>a.label+'\n'+a.url).join('\n\n'));}
  }
  for (const [index, photo] of photos.entries()) {
    newPage();
    section(`${records[0].number} - Photo ${index + 1} of ${photos.length}`, photo.name);
    const image = await doc.embedJpg(photo.jpeg);
    const available = y - 52;
    const size = image.scaleToFit(532, available);
    page.drawImage(image, { x: (612-size.width)/2, y: 52+(available-size.height)/2, ...size });
  }
  const pages=doc.getPages();pages.forEach((p,i)=>{p.drawLine({start:{x:40,y:39},end:{x:572,y:39},color:line,thickness:.5});p.drawText(`JOHN GORDON CONSTRUCTION | Job ${clean(job.jobNumber)} | ${register?'RFI Register':clean(records[0]?.number||'RFI')}`,{x:40,y:25,size:8,font,color:muted});p.drawText(`${i+1} / ${pages.length}`,{x:532,y:25,size:8,font,color:muted});});
  doc.setTitle(register?`Job ${job.jobNumber} RFI Register`:`${records[0]?.number} - ${records[0]?.subject}`);doc.setAuthor(state.settings.companyName||'John Gordon Construction');return doc.save();
}
