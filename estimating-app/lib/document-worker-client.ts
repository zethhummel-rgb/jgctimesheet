import type {SiteSpecificPlan,SafetyAttachment} from './site-specific';
import type {MaterialWorkbookParseSummary} from './material-price-workbook';
import type {Segment} from './drawing-snap';
import {DOCUMENT_LIMITS} from './document-budget';
let active=0;
const waiting:(()=>void)[]=[];
async function slot(){if(waiting.length>=8)throw new Error('Documents are still processing. Wait a moment and try again.');if(active>=2)await new Promise<void>(resolve=>waiting.push(resolve));else active++;}
function release(){const next=waiting.shift();if(next)next();else active--;}
async function run<T>(operation:string,payload:object,milliseconds:number,progress?:(message:string)=>void,read?:(item:SafetyAttachment)=>Promise<Blob>):Promise<T>{
  await slot();
  let worker:Worker|undefined;
  try{
    return await new Promise<T>((resolve,reject)=>{
      worker=new Worker(new URL('./document-worker.ts',import.meta.url),{type:'module'});
      let complete=false,inputBytes=0,attachmentRequests=0;
      const finish=(error:unknown,value?:T)=>{if(complete)return;complete=true;clearTimeout(timer);worker?.terminate();if(error)reject(error);else resolve(value!);};
      const timer=setTimeout(()=>finish(new Error('This document took too long to process. Save a simpler copy and try again. No incomplete document was exported.')),milliseconds);
      worker.onerror=()=>finish(new Error('The document could not be processed. Save a simpler copy and try again.'));
      worker.onmessage=event=>{
        const data=event.data;
        if(data.kind==='progress'){progress?.(String(data.message).slice(0,300));return;}
        if(data.kind==='attachment'){
          if(!read||++attachmentRequests>DOCUMENT_LIMITS.attachments){finish(new Error('Too many supporting documents.'));return;}
          void read(data.item).then(async blob=>{
            if(complete)return;inputBytes+=blob.size;
            if(blob.size>20*1024*1024||inputBytes>DOCUMENT_LIMITS.inputBytes)throw new Error('Supporting documents exceed the 80 MB combined limit or 20 MB per-file limit.');
            const buffer=await blob.arrayBuffer();if(!complete)worker!.postMessage({kind:'attachment',id:data.id,buffer,type:blob.type},[buffer]);
          }).catch(error=>finish(error));return;
        }
        if(data.kind==='error')finish(new Error(String(data.message).slice(0,500)));
        if(data.kind==='result')finish(null,data.value as T);
      };
      worker.postMessage({kind:'run',operation,payload});
    });
  }finally{worker?.terminate();release();}
}
export async function buildSiteSpecificPdf(options:{plan:SiteSpecificPlan;logoBytes:Uint8Array;readAttachment:(item:SafetyAttachment)=>Promise<Blob>;progress?:(message:string)=>void}){
  if(JSON.stringify(options.plan).length>2_000_000)throw new Error('The plan contains too much content. Split it into separate plans.');
  return run<{blob:Blob;pages:number}>('site-specific',{plan:options.plan,logoBytes:options.logoBytes},90_000,options.progress,options.readAttachment);
}
export async function parseMaterialWorkbookIsolated(bytes:Uint8Array){if(bytes.length>20*1024*1024)throw new Error('The workbook exceeds 20 MB.');return run<MaterialWorkbookParseSummary>('workbook',{bytes},20_000);}
export async function validatePdfIsolated(bytes:Uint8Array){return run('validate-pdf',{bytes},20_000);}
export async function drawingSegmentsIsolated(bytes:Uint8Array,pageNumber:number){if(bytes.length>DOCUMENT_LIMITS.inputBytes)throw new Error('This drawing is too large for line snapping.');return run<Segment[]>('drawing-lines',{bytes,pageNumber},20_000);}
