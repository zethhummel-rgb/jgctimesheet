import { PDFDocument, PDFHexString, StandardFonts, degrees, rgb } from 'pdf-lib';
import { commentLines, dimensionGeometry, drawingPageOrder, DRAWING_MAX_BYTES, DRAWING_MAX_MB, isMeasurement, measurement, REVIEW_STATUSES, type DrawingContent, type ReviewStamp } from './drawing-model';

async function stampPdf(stamp: ReviewStamp): Promise<Uint8Array> {
  const pdf=await PDFDocument.create(),page=pdf.addPage([350,222]),font=await pdf.embedFont(StandardFonts.Helvetica),bold=await pdf.embedFont(StandardFonts.HelveticaBold),red=rgb(.7,.1,.12),white=rgb(1,1,1);
  page.drawRectangle({x:0,y:0,width:350,height:222,color:white,borderColor:red,borderWidth:1.5});
  page.drawRectangle({x:0,y:164,width:350,height:58,color:red});
  const centered=(text:string,y:number,size:number)=>page.drawText(text,{x:(350-bold.widthOfTextAtSize(text,size))/2,y,size,font:bold,color:white});
  centered('JOHN GORDON CONSTRUCTION',196,16);centered('SHOP DRAWING REVIEW',177,12);
  REVIEW_STATUSES.forEach((status,i)=>{const y=137-i*25;page.drawRectangle({x:18,y:y-1,width:14,height:14,borderColor:red,borderWidth:1});page.drawText(status.toUpperCase(),{x:44,y,size:14,font,color:red});if(stamp.status===status){page.drawLine({start:{x:20,y:y+5},end:{x:24,y:y+1},color:red,thickness:1.7});page.drawLine({start:{x:24,y:y+1},end:{x:30,y:y+11},color:red,thickness:1.7});}});
  page.drawLine({start:{x:0,y:53},end:{x:350,y:53},color:red,thickness:1});
  page.drawText('REVIEWED BY:',{x:16,y:35,size:10,font,color:red});
  const reviewer=stamp.reviewer||'Not entered',size=Math.min(11,230/Math.max(1,font.widthOfTextAtSize(reviewer,1)));
  page.drawText(reviewer,{x:106,y:35,size,font,color:red});page.drawText('DATE:',{x:16,y:15,size:10,font,color:red});page.drawText(stamp.date,{x:61,y:15,size:11,font,color:red});
  return pdf.save();
}

export async function markedDrawingPdf(source: Uint8Array, content: DrawingContent): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(source.slice()), font = await pdf.embedFont(StandardFonts.Helvetica),order=drawingPageOrder(content,pdf.getPageCount());
  const supported = (text: string) => { try { font.encodeText(text); return text; } catch { throw new Error('PDF export supports Latin text. Please replace unsupported characters in the markup text before exporting.'); } };
  for (const mark of content.marks) {
    const page = pdf.getPage(mark.page - 1), pts = mark.points, color = rgb(parseInt(mark.color.slice(1,3),16)/255,parseInt(mark.color.slice(3,5),16)/255,parseInt(mark.color.slice(5,7),16)/255),rotation=mark.rotation??page.getRotation().angle;
    if(mark.kind==='stamp'&&mark.stamp){
      const [embedded]=await pdf.embedPdf(await stampPdf({...mark.stamp,reviewer:supported(mark.stamp.reviewer)})),width=mark.stamp.width,height=width*222/350,angle=rotation*Math.PI/180;
      page.drawPage(embedded,{x:pts[0].x+Math.sin(angle)*height,y:pts[0].y-Math.cos(angle)*height,width,height,rotate:degrees(rotation)});
    } else if(mark.kind==='callout') {
      const [tip,anchor]=pts,angle=Math.atan2(anchor.y-tip.y,anchor.x-tip.x);
      page.drawLine({start:tip,end:anchor,color,thickness:1.5});
      for(const offset of [-.45,.45])page.drawLine({start:tip,end:{x:tip.x+9*Math.cos(angle+offset),y:tip.y+9*Math.sin(angle+offset)},color,thickness:1.5});
      const lines=commentLines(supported(mark.text)),height=lines.length*12+14,width=185,r=rotation*Math.PI/180;
      const local=(x:number,y:number)=>({x:anchor.x+Math.cos(r)*x-Math.sin(r)*y,y:anchor.y+Math.sin(r)*x+Math.cos(r)*y});
      page.drawRectangle({...local(0,-height),width,height,color:rgb(1,1,1),borderColor:color,borderWidth:1,rotate:degrees(rotation)});
      lines.forEach((line,i)=>page.drawText(line,{...local(7,-16-i*12),size:10,font,color,rotate:degrees(rotation)}));
    } else if(mark.kind==='distance'){
      const d=dimensionGeometry(mark);page.drawLine({start:d.a,end:d.start,color,thickness:.75});page.drawLine({start:d.b,end:d.end,color,thickness:.75});page.drawLine({start:d.start,end:d.end,color,thickness:1});
      for(const p of [d.start,d.end])page.drawLine({start:{x:p.x-d.normal.x*4,y:p.y-d.normal.y*4},end:{x:p.x+d.normal.x*4,y:p.y+d.normal.y*4},color,thickness:1});
      const text=supported(measurement(mark,content.scales[String(mark.page)]));let angle=Math.atan2(d.b.y-d.a.y,d.b.x-d.a.x),relative=((angle*180/Math.PI-rotation+540)%360)-180;if(Math.abs(relative)>90)angle+=Math.PI;
      const width=font.widthOfTextAtSize(text,10);page.drawText(text,{x:d.middle.x-Math.cos(angle)*width/2-Math.sin(angle)*4,y:d.middle.y-Math.sin(angle)*width/2+Math.cos(angle)*4,size:10,font,color,rotate:degrees(angle*180/Math.PI)});
    } else if (['rectangle','highlight'].includes(mark.kind) && pts.length > 1) page.drawRectangle({ x: Math.min(pts[0].x,pts[1].x), y: Math.min(pts[0].y,pts[1].y), width: Math.abs(pts[1].x-pts[0].x), height: Math.abs(pts[1].y-pts[0].y), borderColor: mark.kind==='highlight'?undefined:color, borderWidth: mark.kind==='highlight'?0:1.5, color: mark.kind==='highlight'?color:undefined, opacity: mark.kind==='highlight'?.25:1 });
    else if (mark.kind !== 'text') {
      const points = ['area','perimeter'].includes(mark.kind) ? [...pts,pts[0]] : pts;
      for(let i=1;i<points.length;i++) page.drawLine({ start: points[i-1], end: points[i], color, thickness: 1.5 });
    }
    const label = mark.kind === 'text' ? mark.text : isMeasurement(mark.kind) ? measurement(mark,content.scales[String(mark.page)]) : '';
    const comment=mark.kind==='stamp'&&mark.stamp?`Shop drawing review: ${mark.stamp.status}\nReviewed by: ${mark.stamp.reviewer}\nDate: ${mark.stamp.date}${mark.text?'\n'+mark.text:''}`:mark.text;
    if (comment.trim()) {
      const angle=rotation*Math.PI/180,anchor=mark.kind==='callout'?pts[1]:pts[0],outside=mark.kind==='stamp'?(mark.stamp?.width??0)+8:mark.kind==='callout'?193:0,position={x:anchor.x+Math.cos(angle)*outside,y:anchor.y+Math.sin(angle)*outside};
      const note=pdf.context.obj({Type:'Annot',Subtype:'Text',Rect:[position.x,position.y,position.x+16,position.y+16],Contents:PDFHexString.fromText(comment),T:PDFHexString.fromText(mark.author),Subj:PDFHexString.fromText('JGC '+mark.layer),NM:PDFHexString.fromText(mark.id),Name:'Comment',F:4,C:[parseInt(mark.color.slice(1,3),16)/255,parseInt(mark.color.slice(3,5),16)/255,parseInt(mark.color.slice(5,7),16)/255]});
      page.node.addAnnot(pdf.context.register(note));
    }
    if (label && mark.kind!=='distance') page.drawText(supported(label),{ x: pts[0].x, y: pts[0].y, size: 10, lineHeight: 12, font, color, rotate: degrees(rotation) });
  }
  const output=await PDFDocument.create();for(const p of await output.copyPages(pdf,order.map(n=>n-1)))output.addPage(p);
  output.setTitle(pdf.getTitle()??'JGC Drawing');output.setSubject('JGC drawing markups / as-built record');
  return output.save();
}

export async function combinedDrawingPdf(source:Uint8Array,content:DrawingContent,additional:Uint8Array[]):Promise<{bytes:Uint8Array;content:DrawingContent}> {
  const pdf=await PDFDocument.create(),original=await PDFDocument.load(source.slice()),order=drawingPageOrder(content,original.getPageCount());
  for(const page of await pdf.copyPages(original,order.map(n=>n-1)))pdf.addPage(page);
  for(const bytes of additional){const next=await PDFDocument.load(bytes);for(const page of await pdf.copyPages(next,next.getPageIndices()))pdf.addPage(page);}
  const bytes=await pdf.save();if(bytes.length>DRAWING_MAX_BYTES)throw new Error(`The combined PDF exceeds the ${DRAWING_MAX_MB} MB drawing limit. Combine fewer files.`);
  const remap=(n:number)=>order.indexOf(n)+1,scales:DrawingContent['scales']={};
  for(const [page,scale] of Object.entries(content.scales))scales[String(remap(Number(page)))]=scale;
  return {bytes,content:{version:1,marks:content.marks.map(mark=>({...mark,page:remap(mark.page)})),scales}};
}
