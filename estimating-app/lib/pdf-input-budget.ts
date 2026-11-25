import { jbig2ImageBudget } from './pdf-jbig2';
import {decodePdfAscii85} from './pdf-ascii85';
import {Unzlib} from 'fflate';
import {DOCUMENT_LIMITS,imageBudget,imageDimensions} from './document-budget';

export type PdfInputBudget={decodedBytes:number;objects:number;imagePixels?:number;tokens?:number};
const maxDecodedStreamBytes = 16 * 1024 * 1024;
const maxDecodedPdfBytes = 80 * 1024 * 1024;
const tooComplex=()=>new Error('This PDF is too complex to process. Save a flattened copy or split it into smaller documents.');
const whitespace=/[\s\0]/;
function visibleDictionary(text:string){let result='',literal=0,hex=false,comment=false,escaped=false;for(let n=0;n<text.length;n++){const c=text[n];if(comment){if(c==='\r'||c==='\n'){comment=false;result+=' ';}continue;}if(literal){if(escaped){escaped=false;continue;}if(c==='\\'){escaped=true;continue;}if(c==='(')literal++;if(c===')')literal--;continue;}if(hex){if(c==='>')hex=false;continue;}if(c==='%'){comment=true;continue;}if(c==='('){literal=1;result+='()';continue;}if(c==='<'&&text[n+1]!=='<'&&text[n-1]!=='<'){hex=true;result+='<>';continue;}result+=c;}return result.replace(/#([0-9a-f]{2})/gi,(_,v:string)=>String.fromCharCode(parseInt(v,16)));}
const directInteger=(text:string,name:string,fallback?:number):number=>{
 const keys=[...text.matchAll(/\/([A-Za-z]+)(?=[\s<>\/\[\]])/g)].filter(m=>m[1]===name);
 if(!keys.length){if(fallback!==undefined)return fallback;throw tooComplex();}
 if(keys.length!==1)throw tooComplex();
 const rest=text.slice(keys[0].index!+keys[0][0].length);
 const value=rest.match(/^\s+([+-]?\d+)(?=\s|[<>\/\[\]]|$)/);
 if(!value||/^\s+\d+\s+R\b/.test(rest.slice(value[0].length)))throw tooComplex();
 const number=Number(value[1]);if(!Number.isSafeInteger(number))throw tooComplex();return number;
};

// CCITT is a one-bit scanned image, not an arbitrary content/object decoder.
// Bound its bitmap and decoder row/column parameters before handing it to PDF.js.
function ccittDecodedSize(dictionary:string,width:number,height:number) {
 if(directInteger(dictionary,'Width')!==width||directInteger(dictionary,'Height')!==height||directInteger(dictionary,'BitsPerComponent')!==1)throw tooComplex();
 const parameters=[...dictionary.matchAll(/\/(?:DecodeParms|DP)(?=[\s<>/\[\]])/g)];
 if(parameters.length>1)throw tooComplex();
 let params='';
 if(parameters.length){
  const tail=dictionary.slice(parameters[0].index!+parameters[0][0].length);
  const match=tail.match(/^\s*(?:<<([^<>]*)>>|\[\s*<<([^<>]*)>>\s*\])(?=\s|[/>]|$)/);
  if(!match)throw tooComplex();
  params=match[1]??match[2];
 }
 const columns=directInteger(params,'Columns',1728),rows=directInteger(params,'Rows',0),mode=directInteger(params,'K',0);
 if(columns!==width||(rows!==0&&rows!==height)||mode < -1||mode>height)throw tooComplex();
 return Math.ceil(width/8)*height;
}

function decodeAscii85PdfStream(bytes:Uint8Array, budget:PdfInputBudget, onChunk:(chunk:Uint8Array)=>void) {
 decodePdfAscii85(bytes, chunk => {
  budget.decodedBytes += chunk.length;
  if (budget.decodedBytes > maxDecodedPdfBytes) throw tooComplex();
  onChunk(chunk);
 });
}

function inflatePdfStream(bytes:Uint8Array, budget:PdfInputBudget, ascii85:boolean, onChunk:(chunk:Uint8Array)=>void) {
 let decoded = 0;
 const inflate = new Unzlib(chunk => {
  decoded += chunk.length;
  budget.decodedBytes += chunk.length;
  if (decoded > maxDecodedStreamBytes || budget.decodedBytes > maxDecodedPdfBytes) throw tooComplex();
  onChunk(chunk);
 });
 if (ascii85) {
  decodeAscii85PdfStream(bytes, budget, chunk => inflate.push(chunk, false));
  inflate.push(new Uint8Array(), true);
 } else {
  for (let offset=0; offset<bytes.length; offset+=512) {
   inflate.push(bytes.subarray(offset, offset+512), offset+512 >= bytes.length);
  }
 }
 return decoded;
}

// Adobe PDFs may put ASCII85 text or a JPEG inside a Flate stream. Unwrap only
// for validation within the same byte limits. The viewer opens the original.
function unwrapFlatePdfStream(bytes:Uint8Array, dictionary:string, budget:PdfInputBudget, inner:'jpeg'|'ascii85'):Uint8Array {
 const params = dictionary.split(/\/(?:DecodeParms|DP)(?=[\s<>/\[\]])/);
 // Accept identity Flate parameters. JPEG may also specify a colour transform.
 const supported = inner==='jpeg'
  ? /^\s*(?:null|\[\s*(?:null\b|<<\s*(?:\/Predictor\s+1\s*)?>>)\s*(?:null\b|<<\s*(?:\/ColorTransform\s+[01]\s*)?>>)\s*\])(?=[\s/<>\[\]]|$)/
  : /^\s*(?:null|\[\s*(?:null\b|<<\s*(?:\/Predictor\s+1\s*)?>>)\s*null\s*\])(?=[\s/<>\[\]]|$)/;
 if (params.length > 1 && (params.length !== 2 || !supported.test(params[1]))) throw tooComplex();
 const chunks:Uint8Array[] = [];
 const length = inflatePdfStream(bytes, budget, false, chunk => { if (chunk.length) chunks.push(chunk); });
 const result = new Uint8Array(length);
 let offset = 0;
 for (const chunk of chunks) {
  result.set(chunk, offset);
  offset += chunk.length;
 }
 return result;
}

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
  const end=n+length!;
  // The stream length ends at the payload. Some writers pad the delimiter
  // with multiple line breaks, so find the endstream token past that padding.
  let terminator=end;
  while(terminator<text.length&&whitespace.test(text[terminator]))terminator++;
  if(!/^endstream\b/.test(text.slice(terminator,terminator+10)))throw tooComplex();
  // Only explicitly bounded decoders are allowed; unknown chains still fail closed.
  const filters=[...dictionary.matchAll(/\/Filter\s*(\/\w+|\[[^\]]*\])/g)].map(m=>m[1]);
  if(filters.length>1)throw tooComplex();
  const filter=filters[0]?.replace(/[\[\]\s]/g,'')||'';
  const ccitt=filter==='/CCITTFaxDecode'||filter==='/CCF';
  const jbig2=filter==='/JBIG2Decode';
  const ascii85=filter==='/ASCII85Decode'||filter==='/A85';
  const ascii85Flate=/^\/(?:ASCII85Decode|A85)\/(?:FlateDecode|Fl)$/.test(filter);
  const flateAscii85=/^\[\s*\/(?:FlateDecode|Fl)\s*\/(?:ASCII85Decode|A85)\s*\]$/.test(filters[0]||'');
  const flateJpeg=/^\[\s*\/(?:FlateDecode|Fl)\s*\/(?:DCTDecode|DCT)\s*\]$/.test(filters[0]||'');
  if(!ascii85&&!ascii85Flate&&!flateAscii85&&!ccitt&&!jbig2&&!flateJpeg&&!['','/FlateDecode','/Fl','/DCTDecode','/DCT'].includes(filter))throw tooComplex();
  const isImage=/\/Subtype\s*\/Image\b/.test(dictionary);
  if((ccitt||jbig2||flateJpeg)&&!isImage)throw tooComplex();
  if(isImage){
   const width=flateJpeg?directInteger(dictionary,'Width'):Number(dictionary.match(/\/Width\s+(\d+)/)?.[1]);
   const height=flateJpeg?directInteger(dictionary,'Height'):Number(dictionary.match(/\/Height\s+(\d+)/)?.[1]);
   imageBudget(width,height);
   let pixels=width*height,decoded=0;
   if(ccitt) decoded=ccittDecodedSize(dictionary,width,height);
   if(jbig2){
    // Unvalidated JBIG2Globals could introduce dictionary streams and extra allocations.
    if(/\/(?:DecodeParms|DP)\b/.test(dictionary)||directInteger(dictionary,'Width')!==width||
      directInteger(dictionary,'Height')!==height||directInteger(dictionary,'BitsPerComponent')!==1)throw tooComplex();
    const scan=jbig2ImageBudget(bytes.subarray(n,end),width,height);
    pixels=scan.pixels;
    decoded=scan.decodedBytes;
   }
   budget.decodedBytes+=decoded;
   if(decoded>maxDecodedStreamBytes||budget.decodedBytes>maxDecodedPdfBytes)throw tooComplex();
   budget.imagePixels=(budget.imagePixels||0)+pixels;if(budget.imagePixels>DOCUMENT_LIMITS.totalImagePixels)throw tooComplex();
   if (flateJpeg || filter==='/DCTDecode' || filter==='/DCT') {
    const data=bytes.subarray(n,end);
    const jpeg=flateJpeg?unwrapFlatePdfStream(data,dictionary,budget,'jpeg'):data;
    if (jpeg[0]!==0xff || jpeg[1]!==0xd8) throw tooComplex();
    const size=imageDimensions(jpeg,'image/jpeg');
    imageBudget(size.width,size.height);
    if (size.width!==width || size.height!==height) throw tooComplex();
   }
  }
  // Count lexical tokens while streaming, before PDF.js can allocate an operator list.
  // Conservative counting also includes strings/font data; over-budget snapping falls back to manual points.
  let inToken=false;
  const countTokens=(chunk:Uint8Array)=>{if(maxTokens===undefined)return;for(const byte of chunk){const boundary=byte===0||byte===9||byte===10||byte===12||byte===13||byte===32||byte===37||byte===40||byte===41||byte===47||byte===60||byte===62||byte===91||byte===93||byte===123||byte===125;if(boundary)inToken=false;else if(!inToken){inToken=true;budget.tokens=(budget.tokens||0)+1;if(budget.tokens>maxTokens)throw tooComplex();}}};
  if(ascii85Flate||filter==='/FlateDecode'||filter==='/Fl'){
   inflatePdfStream(bytes.subarray(n,end),budget,ascii85Flate,countTokens);
  }else if(ascii85||flateAscii85){
   const data=bytes.subarray(n,end);
   const encoded=flateAscii85?unwrapFlatePdfStream(data,dictionary,budget,'ascii85'):data;
   decodeAscii85PdfStream(encoded,budget,countTokens);
  }else if(!filter){budget.decodedBytes+=length!;if(budget.decodedBytes>maxDecodedPdfBytes)throw tooComplex();countTokens(bytes.subarray(n,end));}
  objects.lastIndex=terminator+9;
 }
 return budget;
}
