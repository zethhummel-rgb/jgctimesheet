import {Unzlib} from 'fflate';
import {DOCUMENT_LIMITS,imageBudget,imageDimensions} from './document-budget';

export type PdfInputBudget={decodedBytes:number;objects:number;imagePixels?:number;tokens?:number};
const tooComplex=()=>new Error('This PDF is too complex to process. Save a flattened copy or split it into smaller documents.');
const whitespace=/[\s\0]/;
function visibleDictionary(text:string){let result='',literal=0,hex=false,comment=false,escaped=false;for(let n=0;n<text.length;n++){const c=text[n];if(comment){if(c==='\r'||c==='\n'){comment=false;result+=' ';}continue;}if(literal){if(escaped){escaped=false;continue;}if(c==='\\'){escaped=true;continue;}if(c==='(')literal++;if(c===')')literal--;continue;}if(hex){if(c==='>')hex=false;continue;}if(c==='%'){comment=true;continue;}if(c==='('){literal=1;result+='()';continue;}if(c==='<'&&text[n+1]!=='<'&&text[n-1]!=='<'){hex=true;result+='<>';continue;}result+=c;}return result.replace(/#([0-9a-f]{2})/gi,(_,v:string)=>String.fromCharCode(parseInt(v,16)));}
// Inspect physical stream boundaries before a PDF parser can inflate object/content streams.
// Stream dictionaries and indirect lengths are read without decoding any PDF stream.
export function preflightPdf(bytes:Uint8Array,budget:PdfInputBudget={decodedBytes:0,objects:0},maxTokens?:number) {
 if(bytes.length>DOCUMENT_LIMITS.inputBytes)throw tooComplex();
 const text=new TextDecoder('latin1').decode(bytes),objects=/\b(\d+)\s+(\d+)\s+obj\b/g;
 const lengths=new Map<string,number>();
 for(const m of text.matchAll(/\b(\d+)\s+(\d+)\s+obj\s+(\d+)\s+endobj\b/g))lengths.set(m[1]+' '+m[2],Number(m[3]));
 let match:RegExpExecArray|null;
 while((match=objects.exec(text))){
  if(++budget.objects>120_000)throw tooComplex();
  let n=objects.lastIndex;while(whitespace.test(text[n]||'x'))n++;
  if(text.slice(n,n+2)!=='<<')continue;
  const start=n;let depth=0,literal=0,escaped=false,hex=false,comment=false;
  for(;n<text.length;n++){
   const c=text[n];
   if(comment){if(c==='\r'||c==='\n')comment=false;continue;}
   if(literal){if(escaped){escaped=false;continue;}if(c==='\\'){escaped=true;continue;}if(c==='(')literal++;if(c===')')literal--;continue;}
   if(hex){if(c==='>')hex=false;continue;}
   if(c==='%'){comment=true;continue;}if(c==='('){literal=1;continue;}
   if(c==='<'&&text[n+1]!=='<'){hex=true;continue;}
   if(text.slice(n,n+2)==='<<'){if(++depth>64)throw tooComplex();n++;}
   else if(text.slice(n,n+2)==='>>'){n++;if(--depth===0){n++;break;}}
   if(n-start>65_536)throw tooComplex();
  }
  if(depth!==0||literal||hex)throw tooComplex();
  const dictionary=visibleDictionary(text.slice(start,n));
  while(whitespace.test(text[n]||'x'))n++;
  if(text.slice(n,n+6)!=='stream'||!/[\r\n]/.test(text[n+6]||''))continue;
  n+=6;if(text[n]==='\r')n++;if(text[n]==='\n')n++;
  const lengthToken=dictionary.match(/\/Length\s+(\d+)(?:\s+(\d+)\s+R)?\b/);
  const length=lengthToken?.[2]?lengths.get(lengthToken[1]+' '+lengthToken[2]):Number(lengthToken?.[1]);
  if(!Number.isSafeInteger(length)||length!<0||n+length!>bytes.length)throw tooComplex();
  const end=n+length!;if(!/^\s*endstream\b/.test(text.slice(end,end+32)))throw tooComplex();
  // Unknown/chained filters fail closed; no decoder can allocate unbounded output first.
  const filters=[...dictionary.matchAll(/\/Filter\s*(\/\w+|\[[^\]]*\])/g)].map(m=>m[1]);
  if(filters.length>1)throw tooComplex();
  const filter=filters[0]?.replace(/[\[\]\s]/g,'')||'';
  if(!['','/FlateDecode','/Fl','/DCTDecode','/DCT'].includes(filter))throw tooComplex();
  if(/\/Subtype\s*\/Image\b/.test(dictionary)){
   const width=Number(dictionary.match(/\/Width\s+(\d+)/)?.[1]),height=Number(dictionary.match(/\/Height\s+(\d+)/)?.[1]);
   imageBudget(width,height);
   budget.imagePixels=(budget.imagePixels||0)+width*height;if(budget.imagePixels>DOCUMENT_LIMITS.totalImagePixels)throw tooComplex();
   if(filter==='/DCTDecode'||filter==='/DCT'){const size=imageDimensions(bytes.subarray(n,end),'image/jpeg');imageBudget(size.width,size.height);if(size.width!==width||size.height!==height)throw tooComplex();}
  }
  // Count lexical tokens while streaming, before PDF.js can allocate an operator list.
  // Conservative counting also includes strings/font data; over-budget snapping falls back to manual points.
  let inToken=false;
  const countTokens=(chunk:Uint8Array)=>{if(maxTokens===undefined)return;for(const byte of chunk){const boundary=byte===0||byte===9||byte===10||byte===12||byte===13||byte===32||byte===37||byte===40||byte===41||byte===47||byte===60||byte===62||byte===91||byte===93||byte===123||byte===125;if(boundary)inToken=false;else if(!inToken){inToken=true;budget.tokens=(budget.tokens||0)+1;if(budget.tokens>maxTokens)throw tooComplex();}}};
  if(filter==='/FlateDecode'||filter==='/Fl'){
   let streamBytes=0;
   const inflate=new Unzlib(chunk=>{streamBytes+=chunk.length;budget.decodedBytes+=chunk.length;if(streamBytes>16*1024*1024||budget.decodedBytes>80*1024*1024)throw tooComplex();countTokens(chunk);});
   for(let offset=n;offset<end;offset+=512)inflate.push(bytes.subarray(offset,Math.min(end,offset+512)),offset+512>=end);
  }else if(!filter){budget.decodedBytes+=length!;if(budget.decodedBytes>80*1024*1024)throw tooComplex();countTokens(bytes.subarray(n,end));}
  objects.lastIndex=end+9;
 }
 return budget;
}
