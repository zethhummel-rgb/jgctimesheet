(function(){
 'use strict';
 window.JGCSiteSigninsPdf={async create(board,events){
  await loadJgcScriptOnce('vendor/jspdf.umd.min.js','jspdf');const doc=new jspdf.jsPDF({unit:'pt',format:'letter',compress:true}),left=40,width=532,bottom=733,green=[20,65,49],ink=[27,43,37],columns=[116,116,126,174];let y=0;
  const toronto=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',year:'numeric',month:'short',day:'2-digit'}),clock=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',hour:'numeric',minute:'2-digit',second:'2-digit',timeZoneName:'short'});
  const safe=value=>String(value??'').trim()||'—';
  const rows=events.filter(e=>e.action==='site-signin').sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));
  function header(){
   doc.setFillColor(...green);doc.rect(0,0,612,92,'F');doc.setTextColor(255,255,255);doc.setFont('helvetica','bold');doc.setFontSize(10);doc.text('JOHN GORDON CONSTRUCTION',left,28);doc.setFontSize(20);doc.text('SITE SIGN-IN REGISTER',left,58);
   y=114;doc.setTextColor(...ink);doc.setFontSize(12);const job=doc.splitTextToSize('Job '+safe(board.job_number)+' · '+safe(board.job_name),width);doc.text(job,left,y);y+=job.length*15;doc.setFont('helvetica','normal');doc.setFontSize(9);const address=doc.splitTextToSize(safe(board.address),width);doc.text(address,left,y);y+=address.length*12+6;doc.text(rows.length+' site sign-ins · All recorded attendance · Toronto time',left,y);y+=20;
   doc.setFillColor(...green);doc.rect(left,y,width,25,'F');doc.setTextColor(255,255,255);doc.setFont('helvetica','bold');let x=left;['Name','Company','Date / time','Reason (optional)'].forEach((label,i)=>{doc.text(label,x+7,y+16);x+=columns[i];});y+=25;
  }
  header();doc.setFont('helvetica','normal');doc.setFontSize(9);
  if(!rows.length){doc.setTextColor(...ink);doc.text('No site sign-ins have been recorded for this job.',left+7,y+22);}
  rows.forEach((event,index)=>{
   const date=new Date(event.created_at),dateText=Number.isNaN(date.getTime())?'Not recorded':toronto.format(date)+'\n'+clock.format(date);
   const values=[safe(event.actor_name),safe(event.actor_company),dateText,safe(event.reason)],lines=values.map((v,i)=>doc.splitTextToSize(v,columns[i]-14)),height=Math.max(1,...lines.map(v=>v.length))*12+16;
   if(y+height>bottom){doc.addPage();header();doc.setFont('helvetica','normal');doc.setFontSize(9);}
   doc.setFillColor(...(index%2?[244,247,245]:[255,255,255]));doc.rect(left,y,width,height,'F');doc.setDrawColor(211,221,214);doc.setLineWidth(.4);doc.rect(left,y,width,height);doc.setTextColor(...ink);let x=left;lines.forEach((line,i)=>{if(i)doc.line(x,y,x,y+height);doc.text(line,x+7,y+14);x+=columns[i];});y+=height;
  });
  const count=doc.getNumberOfPages(),generated=toronto.format(new Date())+' '+clock.format(new Date());for(let page=1;page<=count;page++){doc.setPage(page);doc.setDrawColor(211,221,214);doc.line(left,751,left+width,751);doc.setFont('helvetica','normal');doc.setFontSize(8);doc.setTextColor(91,109,98);doc.text('Site attendance is self-reported · Generated '+generated,left,766);doc.text('Page '+page+' of '+count,left+width,780,{align:'right'});}
  return doc.output('blob');
 }};
})();
