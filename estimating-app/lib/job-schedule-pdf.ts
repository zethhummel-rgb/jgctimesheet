import { PDFDocument, StandardFonts, rgb, type PDFPage } from 'pdf-lib';
import type { AppState, Job } from './estimator-data';
import { dateNumber, dateString, duration, scheduleRange, scheduleRows, weekend, type JobSchedule } from './job-schedule';

// Tabloid landscape keeps the Gantt readable on paper. Long schedules tile by
// date and row, with the client, activity labels and dates repeated on each page.
export async function buildSchedulePdf({job,state,schedule,logoBytes}:{job:Job;state:AppState;schedule:JobSchedule;logoBytes:Uint8Array}) {
  const doc=await PDFDocument.create(),font=await doc.embedFont(StandardFonts.Helvetica),bold=await doc.embedFont(StandardFonts.HelveticaBold),logo=await doc.embedPng(logoBytes);
  const green=rgb(.045,.29,.20),ink=rgb(.09,.16,.18),muted=rgb(.33,.40,.43),line=rgb(.75,.80,.81),pale=rgb(.95,.97,.96);
  const colours=[rgb(.10,.45,.32),rgb(.16,.42,.62),rgb(.47,.34,.64),rgb(.63,.41,.09),rgb(.22,.49,.50),rgb(.65,.33,.33)];
  const clean=(s:unknown)=>String(s??'').replace(/[\u2013\u2014]/g,'-').replace(/[\u2018\u2019]/g,"'").replace(/[\u201c\u201d]/g,'"').replace(/\u2026/g,'...').normalize('NFKD').replace(/[^\x20-\x7e\n]/g,'');
  const wrap=(s:string,width:number,size:number,strong=false)=>{
    const f=strong?bold:font,out:string[]=[];
    for(const paragraph of clean(s).split('\n')){let current='';for(const ch of paragraph){if(f.widthOfTextAtSize(current+ch,size)>width){const cut=current.lastIndexOf(' ');if(cut>0){out.push(current.slice(0,cut));current=current.slice(cut+1)+ch;}else{out.push(current);current=ch;}}else current+=ch;}out.push(current);}return out;
  };
  const date=(n:number)=>new Date(n*86400000).toLocaleDateString('en-CA',{month:'short',day:'numeric',timeZone:'UTC'});
  const quote=state.quotes.find(q=>q.id===job.quoteId),client=job.portalCustomer||state.clients.find(c=>c.id===job.clientId)?.name||'Client not recorded',site=job.portalSiteName||quote?.site||'',address=job.portalAddress||quote?.address||'';
  const range=scheduleRange(schedule.tasks),rows=scheduleRows(schedule.tasks),latest=schedule.revisions.at(-1);
  let first=range.start;while(new Date(first*86400000).getUTCDay()!==1)first--;
  let last=range.finish;while(new Date(last*86400000).getUTCDay()!==0)last++;
  const windows:Array<{start:number;finish:number}>=[];for(let start=first;start<=last;start+=70)windows.push({start,finish:Math.min(last,start+69)});
  let page!:PDFPage;
  const text=(s:string,x:number,y:number,size=10,strong=false,color=ink)=>page.drawText(clean(s),{x,y,size,font:strong?bold:font,color});
  const left=36,right=1188,labelWidth=426,timeLeft=left+labelWidth,timeWidth=right-timeLeft;
  function header(subtitle:string) {
    page=doc.addPage([1224,792]);
    const dim=logo.scaleToFit(196,70);page.drawImage(logo,{x:right-dim.width,y:699,width:dim.width,height:dim.height});
    text('JOHN GORDON CONSTRUCTION',left,751,10,true,green);text('PROJECT SCHEDULE',left,723,24,true);
    text(`JOB ${job.jobNumber}  |  REVISION ${schedule.revision}`,left+290,725,11,true,green);
    page.drawLine({start:{x:left,y:689},end:{x:right,y:689},color:green,thickness:2});
    const clients=wrap([client,site,address].filter(Boolean).join('\n'),440,11);
    clients.forEach((s,i)=>text(s,left,669-i*14,i===0?14:11,i===0));
    const projects=wrap(job.project,664,18,true);
    projects.forEach((s,i)=>text(s,left+488,669-i*21,18,true));
    const after=Math.min(669-clients.length*14,669-projects.length*21)-13;
    text(`Planned: ${dateString(range.start)} to ${dateString(range.finish)}  |  ${schedule.tasks.length} activities  |  ${subtitle}`,left,after,10,true,green);
    if(latest?.note)text(wrap(`Revision note: ${latest.note}`,1152,9)[0],left,after-17,9,false,muted);
    return after-(latest?.note?35:20);
  }
  for(const window of windows) {
    const days=window.finish-window.start+1,dw=timeWidth/days;
    let y=0,top=0;
    function newTable() {
      top=header(`Timeline ${dateString(window.start)} to ${dateString(window.finish)}`);
      page.drawRectangle({x:left,y:top-42,width:right-left,height:42,color:green});
      [['ACTIVITY / RESPONSIBILITY',left+10],['START',left+260],['FINISH',left+308],['DAYS',left+360],['%',left+402]].forEach(([s,x])=>text(String(s),Number(x),top-24,8,true,rgb(1,1,1)));
      for(let i=0;i<days;i+=7){const count=Math.min(7,days-i),x=timeLeft+i*dw;text(date(window.start+i),x+4,top-15,9,true,rgb(1,1,1));page.drawLine({start:{x,y:top},end:{x,y:top-42},color:rgb(.38,.61,.52),thickness:.5});for(let j=0;j<count;j++)if(dw>=9)text(String(new Date((window.start+i+j)*86400000).getUTCDate()),x+j*dw+2,top-33,7,false,rgb(1,1,1));}
      y=top-42;
    }
    newTable();
    for(const row of rows) {
      const isPhase=row.kind==='phase',task=row.kind==='task'?row.task:null;
      const title=isPhase?`${row.index+1}. ${row.phase}`:`${row.number}  ${task!.name}`,nameLines=wrap(title,240,isPhase?10:9.5,true),ownerLines=task?.owner?wrap(task.owner,240,8.5):[];
      const height=Math.max(isPhase?28:34,nameLines.length*12+ownerLines.length*11+10);
      if(y-height<60)newTable();
      const bottom=y-height,tone=colours[row.index%colours.length];
      page.drawRectangle({x:left,y:bottom,width:right-left,height,color:isPhase?pale:rgb(1,1,1),borderColor:line,borderWidth:.4});
      for(let i=0;i<days;i++) {
        const x=timeLeft+i*dw;
        if(weekend(window.start+i)&&!isPhase)page.drawRectangle({x,y:bottom,width:dw,height,color:rgb(.94,.95,.96)});
        if(i%7===0)page.drawLine({start:{x,y:bottom},end:{x,y},color:line,thickness:.5});
      }
      nameLines.forEach((s,i)=>text(s,left+10,y-14-i*12,isPhase?10:9.5,true,isPhase?tone:ink));
      ownerLines.forEach((s,i)=>text(s,left+10,y-14-nameLines.length*12-i*11,8.5,false,muted));
      const start=dateNumber(task?task.start:row.kind==='phase'?row.start:''),finish=dateNumber(task?task.finish:row.kind==='phase'?row.finish:'');
      if(task){text(date(start),left+260,y-18,8.5);text(date(finish),left+308,y-18,8.5);text(String(duration(task))+(task.calendar==='weekdays'?'w':'c'),left+364,y-18,8.5);text(task.progress===null?'-':String(task.progress),left+402,y-18,8.5);}
      const a=Math.max(start,window.start),b=Math.min(finish,window.finish);
      if(a<=b){const x=timeLeft+(a-window.start)*dw+1,w=(b-a+1)*dw-2,barY=bottom+height/2-5;
        if(isPhase){page.drawRectangle({x,y:barY+4,width:Math.max(1,w),height:3,color:tone});[x,x+Math.max(1,w)-2].forEach(xx=>page.drawRectangle({x:xx,y:barY,width:2,height:7,color:tone}));}
        else {page.drawRectangle({x,y:barY,width:Math.max(1,w),height:11,color:tone,borderColor:tone,borderWidth:.6});if(task!.progress!==null&&task!.progress>0){const done=start+(finish-start+1)*task!.progress/100,visible=Math.max(0,Math.min(done,b+1)-a);if(visible)page.drawRectangle({x,y:barY,width:Math.max(1,visible*dw-2),height:11,color:rgb(tone.red*.55,tone.green*.55,tone.blue*.55)});}}
      }
      page.drawLine({start:{x:timeLeft,y:bottom},end:{x:timeLeft,y},color:line,thickness:.7});y=bottom;
    }
    text('w = working days (Mon-Fri, holidays not excluded)   c = calendar days   - = progress not entered',left,44,8,false,muted);
  }
  const noted=schedule.tasks.filter(t=>t.notes||t.predecessorId);
  if(noted.length){let y=header('Activity notes and links');for(const task of noted){const prior=schedule.tasks.find(t=>t.id===task.predecessorId),lines=wrap(`${task.phase} / ${task.name}\n${prior?`Starts after: ${prior.name} | Waiting time: ${task.lag} calendar days\n`:''}${task.notes}`,1140,10);for(const s of lines){if(y<66)y=header('Activity notes and links (continued)');text(s,left+6,y,10);y-=15;}y-=18;}}
  const pages=doc.getPages();pages.forEach((p,i)=>{p.drawLine({start:{x:left,y:33},end:{x:right,y:33},color:line,thickness:.5});p.drawText(`JGC | Job ${clean(job.jobNumber)} | Schedule Rev ${schedule.revision} | Generated ${new Date().toLocaleDateString('en-CA')}`,{x:left,y:20,size:8,font,color:muted});p.drawText(`${i+1} / ${pages.length}`,{x:right-42,y:20,size:8,font,color:muted});});
  doc.setTitle(`${job.jobNumber} - Job Schedule - Revision ${schedule.revision}`);doc.setAuthor('John Gordon Construction Inc.');
  return doc.save();
}
