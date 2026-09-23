import { PDFDocument, StandardFonts, rgb, type PDFPage } from 'pdf-lib';
import type { AppState, Job } from './estimator-data';
import { rfiOverdue, type Rfi, type RfiDetails } from './rfi-workflow';

export async function buildRfiPdf({job,state,records,register=false,logoBytes}:{job:Job;state:AppState;records:Rfi[];register?:boolean;logoBytes:Uint8Array}) {
  const doc=await PDFDocument.create(),font=await doc.embedFont(StandardFonts.Helvetica),bold=await doc.embedFont(StandardFonts.HelveticaBold),logo=await doc.embedPng(logoBytes);
  const green=rgb(.04,.25,.18),ink=rgb(.09,.16,.19),muted=rgb(.32,.39,.4),line=rgb(.72,.77,.76),pale=rgb(.94,.97,.95);
  const clean=(v:unknown)=>String(v??'').replace(/[\u2013\u2014]/g,'-').replace(/[\u2018\u2019]/g,"'").replace(/[\u201c\u201d]/g,'"').replace(/\u2026/g,'...').normalize('NFKD').replace(/[^\x20-\x7e\n]/g,'');
  const quote=state.quotes.find(q=>q.id===job.quoteId),client=job.portalCustomer||state.clients.find(c=>c.id===job.clientId)?.name||'',site=job.portalSiteName||quote?.site||'',address=job.portalAddress||quote?.address||'';
  let page!:PDFPage;let y=0;
  const text=(s:string,x:number,yy:number,size=10,strong=false,color=ink)=>page.drawText(clean(s),{x,y:yy,size,font:strong?bold:font,color});
  function newPage(){page=doc.addPage([612,792]);const dim=logo.scaleToFit(160,55);page.drawImage(logo,{x:40,y:716,width:dim.width,height:dim.height});text(register?'RFI REGISTER':'REQUEST FOR INFORMATION',265,750,14,true,green);text(`JOB ${job.jobNumber}`,265,731,10,true);page.drawLine({start:{x:40,y:704},end:{x:572,y:704},color:green,thickness:2});y=684;}
  const ensure=(height:number)=>{if(y-height<52)newPage();};
  function wrap(value:string,width=508,size=10){const result:string[]=[];for(const paragraph of clean(value).split('\n')){let current='';for(const ch of paragraph){if(font.widthOfTextAtSize(current+ch,size)>width){let cut=current.lastIndexOf(' ');if(cut>0){result.push(current.slice(0,cut));current=current.slice(cut+1)+ch;}else{result.push(current);current=ch;}}else current+=ch;}result.push(current);}return result;}
  function body(value:string,size=10){for(const l of wrap(value,508,size)){ensure(15);text(l,52,y,size);y-=15;}y-=8;}
  function section(title:string,value:string){ensure(48);page.drawRectangle({x:40,y:y-8,width:532,height:24,color:pale,borderColor:line,borderWidth:.6});text(title.toUpperCase(),50,y,9,true,green);y-=30;body(value||'Not recorded');}
  function details(d:RfiDetails){section('Question / clarification requested',d.question||'Question not yet completed.');section('Drawing / specification / detail references',d.references||'None recorded.');section('Attachments / supporting documents',d.attachments.length?d.attachments.map(a=>`${a.label}\n${a.url}`).join('\n\n'):'No attachment links.');section('Response',d.answer?`Responder: ${d.responder||'Not recorded'}    Response date: ${d.responseDate||'Not recorded'}\n\n${d.answer}`:'Awaiting response.');}
  newPage();body(`${client}${site?' - '+site:''}\n${address}\n${job.project}`,11);
  if(register){
    body(`${records.length} RFIs | ${records.filter(r=>r.status==='Open / Sent').length} outstanding | ${records.filter(r=>rfiOverdue(r)).length} overdue\nGenerated ${new Date().toLocaleDateString('en-CA')}`);
    const head=()=>{ensure(55);page.drawRectangle({x:40,y:y-9,width:532,height:25,color:green});[['RFI / SUBJECT',48],['SENT TO',288],['STATUS',390],['DUE',493]].forEach(([s,x])=>text(String(s),Number(x),y,8,true,rgb(1,1,1)));y-=29;};head();
    for(const r of records){const cols=[wrap(`${r.number} - ${r.subject}`,226,9),wrap(r.sentTo||'Not sent',90,9),wrap(r.status+(rfiOverdue(r)?' / OVERDUE':''),90,9),wrap(r.dueDate||'-',70,9)];const count=Math.max(...cols.map(c=>c.length));for(let i=0;i<count;i++){if(y<67){newPage();head();}cols.forEach((col,k)=>{if(col[i])text(col[i],[48,288,390,493][k],y,9);});y-=13;}page.drawLine({start:{x:40,y:y-3},end:{x:572,y:y-3},color:line,thickness:.5});y-=15;}
  }else for(const [index,r] of records.entries()){
    if(index)newPage();section(`${r.number} - ${r.status}`,r.subject);
    section('Request details',`Created: ${r.createdDate}    Sent: ${r.sentDate||'Not sent'}    Response due: ${r.dueDate||'Not set'}${rfiOverdue(r)?' - OVERDUE':''}\nRaised by: ${r.raisedBy}\nSent to: ${r.sentTo||'Not recorded'}\nFollow-up cycles: ${r.cycle}`);details(r);
    if(r.history.length>1){newPage();section(`${r.number} - correspondence history`,'Saved questions and answers in chronological order.');for(const h of r.history){section(`${h.action} | ${h.at.slice(0,10)}`,`${h.actor}\n${h.note||''}\nSubject: ${h.details.subject}\nStatus: ${h.details.status}\nCreated: ${h.details.createdDate} | Sent: ${h.details.sentDate||'-'} | Due: ${h.details.dueDate||'-'}\nRaised by: ${h.details.raisedBy} | Sent to: ${h.details.sentTo}`);details(h.details);}}
  }
  const pages=doc.getPages();pages.forEach((p,i)=>{p.drawLine({start:{x:40,y:39},end:{x:572,y:39},color:line,thickness:.5});p.drawText(`JOHN GORDON CONSTRUCTION | Job ${clean(job.jobNumber)} | ${register?'RFI Register':clean(records[0]?.number||'RFI')}`,{x:40,y:25,size:8,font,color:muted});p.drawText(`${i+1} / ${pages.length}`,{x:532,y:25,size:8,font,color:muted});});
  doc.setTitle(register?`Job ${job.jobNumber} RFI Register`:`${records[0]?.number} - ${records[0]?.subject}`);doc.setAuthor(state.settings.companyName||'John Gordon Construction');return doc.save();
}
