export const DOCUMENT_LIMITS = Object.freeze({ attachments: 60, inputBytes: 80 * 1024 * 1024, pdfPages: 400, imagePixels: 16_000_000, totalImagePixels: 60_000_000, imageSide: 8192, outputBytes: 50 * 1024 * 1024, textItems: 150_000, textCharacters: 4_000_000 });
export function imageBudget(width: number, height: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1 || width > DOCUMENT_LIMITS.imageSide || height > DOCUMENT_LIMITS.imageSide || width * height > DOCUMENT_LIMITS.imagePixels) throw new Error('This image is too large. Resize it to at most 16 megapixels and 8192 pixels per side.');
}
// Read dimensions before allocating decoded pixels. Unknown image encodings fail closed.
export function imageDimensions(bytes: Uint8Array, type: string): {width:number;height:number} {
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if (bytes.length>=24&&bytes[0]===0x89&&bytes[1]===0x50) return {width:view.getUint32(16),height:view.getUint32(20)};
  if(bytes[0]===0xff&&bytes[1]===0xd8){
    let n=2;
    while(n+4<=bytes.length){if(bytes[n++]!==0xff)throw new Error('Unreadable JPEG image.');while(bytes[n]===0xff)n++;const marker=bytes[n++];if(marker===0xd9||marker===0xda)break;if(marker===0x01||(marker>=0xd0&&marker<=0xd7))continue;const length=view.getUint16(n);if(length<2||n+length>bytes.length)break;if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)&&length>=7)return {width:view.getUint16(n+5),height:view.getUint16(n+3)};n+=length;}
  }
  if(type==='image/webp'&&bytes.length>=30&&new TextDecoder().decode(bytes.subarray(0,4))==='RIFF'&&new TextDecoder().decode(bytes.subarray(8,12))==='WEBP'){
    const kind=new TextDecoder().decode(bytes.subarray(12,16));
    if(kind==='VP8X')return {width:1+bytes[24]+(bytes[25]<<8)+(bytes[26]<<16),height:1+bytes[27]+(bytes[28]<<8)+(bytes[29]<<16)};
    if(kind==='VP8 '&&bytes[23]===0x9d&&bytes[24]===0x01&&bytes[25]===0x2a)return {width:view.getUint16(26,true)&0x3fff,height:view.getUint16(28,true)&0x3fff};
    if(kind==='VP8L'&&bytes[20]===0x2f){const bits=view.getUint32(21,true);return {width:(bits&0x3fff)+1,height:((bits>>>14)&0x3fff)+1};}
  }
  throw new Error('Image dimensions could not be verified. Save it as a standard JPG or PNG.');
}
export function documentDeadline<T>(promise: Promise<T>, milliseconds: number, cancel:()=>unknown):Promise<T>{
  return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{try{void Promise.resolve(cancel()).catch(()=>{});}catch{}reject(new Error('This document took too long to process. Save a simpler copy and try again.'));},milliseconds);promise.then(value=>{clearTimeout(timer);resolve(value);},error=>{clearTimeout(timer);reject(error);});});
}
