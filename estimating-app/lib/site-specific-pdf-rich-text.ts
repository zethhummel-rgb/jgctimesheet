import {StandardFonts,rgb,type PDFDocument,type PDFFont,type PDFPage,type RGB} from 'pdf-lib';
import {safetyTextRuns,safetyRunValue,safetyPointSize,safetyHighlight,type SafetyTextRun,type SafetyTextStyle} from './site-specific-rich-text';
type Fonts=Record<string,PDFFont>;
const catalogs=new WeakMap<PDFFont,{fonts:Fonts;bold:boolean;italic:boolean}>();
export async function embedSafetyFonts(doc:PDFDocument){
 const fonts:Fonts={};
 const families={sans:[StandardFonts.Helvetica,StandardFonts.HelveticaBold,StandardFonts.HelveticaOblique,StandardFonts.HelveticaBoldOblique],serif:[StandardFonts.TimesRoman,StandardFonts.TimesRomanBold,StandardFonts.TimesRomanItalic,StandardFonts.TimesRomanBoldItalic],mono:[StandardFonts.Courier,StandardFonts.CourierBold,StandardFonts.CourierOblique,StandardFonts.CourierBoldOblique]};
 for(const [family,names] of Object.entries(families))for(const [i,name] of names.entries())fonts[family+i]=await doc.embedFont(name);
 for(const [key,font] of Object.entries(fonts))catalogs.set(font,{fonts,bold:key.endsWith('1')||key.endsWith('3'),italic:key.endsWith('2')||key.endsWith('3')});
 return {regular:fonts.sans0,bold:fonts.sans1};
}
function styledFont(base:PDFFont,style:SafetyTextStyle){const info=catalogs.get(base);return info?info.fonts[style.family+((style.bold||info.bold?1:0)+(style.italic||info.italic?2:0))]:base;}
export function clean(value:string,font:PDFFont){return [...String(value).normalize('NFC').replace(/[\u2010-\u2015]/g,'-').replace(/[\u2018\u2019]/g,"'").replace(/[\u201c\u201d]/g,'"').replace(/\r/g,'')].map(c=>{if(c==='\n')return c;try{font.encodeText(c);return c;}catch{return '?';}}).join('');}
export function wrap(value:string,font:PDFFont,size:number,width:number){
 const lines:SafetyTextRun[][]=[[]];let used=0;const available=(style:SafetyTextStyle)=>Math.max(20,width-(style.indent||0)*18);
 const append=(text:string,style:SafetyTextStyle)=>{if(!text)return;const row=lines.at(-1)!,last=row.at(-1);if(last&&JSON.stringify(last.style)===JSON.stringify(style))last.text+=text;else row.push({text,style});};
 const next=()=>{lines.push([]);used=0;};
 for(const run of safetyTextRuns(value)){
  const f=styledFont(font,run.style),n=safetyPointSize(run.style,size);
  for(const part of clean(run.text,f).split(/(\n|[^\S\n]+|[^\s]+)/).filter(Boolean)){
   if(part==='\n'){next();continue;}
   if(/^\s+$/.test(part)){if(used){const w=f.widthOfTextAtSize(' ',n);if(used+w<=available(run.style)){append(' ',run.style);used+=w;}}continue;}
   const w=f.widthOfTextAtSize(part,n);if(used&&used+w>available(run.style))next();
   if(w<=available(run.style)){append(part,run.style);used+=w;continue;}
   for(const c of part){const cw=f.widthOfTextAtSize(c,n);if(used&&used+cw>available(run.style))next();append(c,run.style);used+=cw;}
  }
 }
 return lines.map(row=>row.map(safetyRunValue).join(''));
}
export function drawSafetyText(page:PDFPage,value:string,x:number,y:number,size:number,font:PDFFont,color:RGB,widthLimit?:number){
 const runs=safetyTextRuns(value),first=runs[0]?.style,indent=(first?.indent||0)*18;
 if(widthLimit){const measured=runs.reduce((sum,r)=>sum+styledFont(font,r.style).widthOfTextAtSize(clean(r.text,styledFont(font,r.style)),safetyPointSize(r.style,size)),0),free=Math.max(0,widthLimit-indent-measured);x+=indent+(first?.align==='center'?free/2:first?.align==='right'?free:0);}
 for(const run of safetyTextRuns(value)){
  const f=styledFont(font,run.style),n=safetyPointSize(run.style,size),text=clean(run.text,f),width=f.widthOfTextAtSize(text,n);
  if(run.style.highlight)page.drawRectangle({x,y:y-2,width,height:n,color:hexColor(safetyHighlight(run.style.highlight))});
  const ink=run.style.color?hexColor(run.style.color):run.style.highlight?rgb(.06,.13,.09):color;page.drawText(text,{x,y,size:n,font:f,color:ink});
  if(run.style.underline)page.drawLine({start:{x,y:y-1.5},end:{x:x+width,y:y-1.5},color:ink,thickness:.6});if(run.style.strike)page.drawLine({start:{x,y:y+n*.3},end:{x:x+width,y:y+n*.3},color:ink,thickness:.6});x+=width;
 }
}

function hexColor(value:string){const hex=value.replace("#","");return rgb(parseInt(hex.slice(0,2),16)/255,parseInt(hex.slice(2,4),16)/255,parseInt(hex.slice(4,6),16)/255);}
export function safetyLineHeight(value:string,base:number,minimum:number){return Math.max(minimum,...safetyTextRuns(value).map(r=>Math.max(minimum,safetyPointSize(r.style,base)*1.4)*(r.style.spacing||1)));}
