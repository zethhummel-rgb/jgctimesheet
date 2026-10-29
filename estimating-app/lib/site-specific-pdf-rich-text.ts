import {StandardFonts,rgb,type PDFDocument,type PDFFont,type PDFPage,type RGB} from 'pdf-lib';
import {safetyTextRuns,safetyRunValue,safetySizeFactor,type SafetyTextRun,type SafetyTextStyle} from './site-specific-rich-text';
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
 const lines:SafetyTextRun[][]=[[]];let used=0;
 const append=(text:string,style:SafetyTextStyle)=>{if(!text)return;const row=lines.at(-1)!,last=row.at(-1);if(last&&JSON.stringify(last.style)===JSON.stringify(style))last.text+=text;else row.push({text,style});};
 const next=()=>{lines.push([]);used=0;};
 for(const run of safetyTextRuns(value)){
  const f=styledFont(font,run.style),n=size*safetySizeFactor(run.style);
  for(const part of clean(run.text,f).split(/(\n|[^\S\n]+|[^\s]+)/).filter(Boolean)){
   if(part==='\n'){next();continue;}
   if(/^\s+$/.test(part)){if(used){const w=f.widthOfTextAtSize(' ',n);if(used+w<=width){append(' ',run.style);used+=w;}}continue;}
   const w=f.widthOfTextAtSize(part,n);if(used&&used+w>width)next();
   if(w<=width){append(part,run.style);used+=w;continue;}
   for(const c of part){const cw=f.widthOfTextAtSize(c,n);if(used&&used+cw>width)next();append(c,run.style);used+=cw;}
  }
 }
 return lines.map(row=>row.map(safetyRunValue).join(''));
}
export function drawSafetyText(page:PDFPage,value:string,x:number,y:number,size:number,font:PDFFont,color:RGB){
 for(const run of safetyTextRuns(value)){
  const f=styledFont(font,run.style),n=size*safetySizeFactor(run.style),text=clean(run.text,f),width=f.widthOfTextAtSize(text,n);
  if(run.style.highlight)page.drawRectangle({x,y:y-2,width,height:n,color:run.style.highlight==='yellow'?rgb(1,.95,.66):rgb(.81,.93,.78)});
  const ink=run.style.highlight?rgb(.06,.13,.09):color;page.drawText(text,{x,y,size:n,font:f,color:ink});
  if(run.style.underline)page.drawLine({start:{x,y:y-1.5},end:{x:x+width,y:y-1.5},color:ink,thickness:.6});x+=width;
 }
}
