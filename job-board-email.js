(function () {
  'use strict';
  function base64(bytes) { let raw = ''; for(let i=0;i<bytes.length;i+=16384) raw += String.fromCharCode(...bytes.subarray(i,i+16384)); return btoa(raw); }
  const folded = value => value.match(/.{1,76}/g)?.join('\r\n') || '';
  async function pdf(blob,name,type) {
    const fileName = String(name || 'document').replace(/[\r\n\\/]/g,'_').replace(/\.[^.]+$/,'') + '.pdf';
    if (type === 'application/pdf' || blob.type === 'application/pdf') {
      if (!(await blob.slice(0,5).text()).startsWith('%PDF-')) throw new Error('The downloaded file is not a valid PDF. Please retry.');
      return new File([blob],fileName,{type:'application/pdf'});
    }
    if (!/^image\/(jpeg|png|webp)$/.test(type || blob.type)) throw new Error('This file cannot be attached as a PDF.');
    await loadJgcScriptOnce('vendor/jspdf.umd.min.js','jspdf');
    const url = URL.createObjectURL(blob);
    try {
      const image = new Image(); image.src = url; await image.decode();
      const scale = Math.min(1,2400/Math.max(image.naturalWidth,image.naturalHeight));
      const canvas = document.createElement('canvas'); canvas.width = Math.max(1,Math.round(image.naturalWidth*scale)); canvas.height = Math.max(1,Math.round(image.naturalHeight*scale));
      const context = canvas.getContext('2d'); context.fillStyle = '#fff'; context.fillRect(0,0,canvas.width,canvas.height); context.drawImage(image,0,0,canvas.width,canvas.height);
      const doc = new jspdf.jsPDF({unit:'pt',format:'letter',orientation:canvas.width > canvas.height ? 'landscape' : 'portrait',compress:true});
      const w=doc.internal.pageSize.getWidth(),h=doc.internal.pageSize.getHeight(),fit=Math.min((w-48)/canvas.width,(h-48)/canvas.height);
      doc.addImage(canvas.toDataURL('image/jpeg',.9),'JPEG',(w-canvas.width*fit)/2,(h-canvas.height*fit)/2,canvas.width*fit,canvas.height*fit);
      return new File([doc.output('blob')],fileName,{type:'application/pdf'});
    } finally { URL.revokeObjectURL(url); }
  }
  async function draft(file,subject) {
    const boundary='jgc-'+crypto.randomUUID();
    const ascii=file.name.replace(/[^A-Za-z0-9_. -]/g,'_');
    const subject64=base64(new TextEncoder().encode(String(subject).replace(/[\r\n]/g,' ')));
    const content=base64(new Uint8Array(await file.arrayBuffer()));
    const body=base64(new TextEncoder().encode('Please find the attached Job Board PDF.'));
    const lines=['X-Unsent: 1','Date: '+new Date().toUTCString(),'Subject: =?UTF-8?B?'+subject64+'?=','MIME-Version: 1.0','Content-Type: multipart/mixed; boundary="'+boundary+'"','','--'+boundary,'Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: base64','',folded(body),'--'+boundary,'Content-Type: application/pdf','Content-Transfer-Encoding: base64','Content-Disposition: attachment; filename="'+ascii+'"; filename*=UTF-8\'\''+encodeURIComponent(file.name),'',folded(content),'--'+boundary+'--',''];
    return new Blob([lines.join('\r\n')],{type:'message/rfc822'});
  }
  window.JGCJobBoardEmail={pdf,draft};
})();
