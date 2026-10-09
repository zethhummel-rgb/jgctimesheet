/// <reference lib="webworker" />
import {buildSiteSpecificPdf} from './site-specific-pdf';
import {parseMaterialPriceWorkbook} from './material-price-workbook';
import {drawingSegments} from './drawing-snap';
import {preflightPdf} from './pdf-input-budget';
import type {SafetyAttachment} from './site-specific';
const scope=self as unknown as DedicatedWorkerGlobalScope;
const attachments=new Map<number,(blob:Blob)=>void>();let serial=0;
scope.onmessage=async event=>{
  const data=event.data;
  if(data.kind==='attachment'){attachments.get(data.id)?.(new Blob([data.buffer],{type:data.type}));attachments.delete(data.id);return;}
  if(data.kind!=='run')return;
  try{
    let value:unknown;
    if(data.operation==='site-specific')value=await buildSiteSpecificPdf({...data.payload,progress:(message:string)=>scope.postMessage({kind:'progress',message}),readAttachment:(item:SafetyAttachment)=>new Promise<Blob>(resolve=>{const id=++serial;attachments.set(id,resolve);scope.postMessage({kind:'attachment',id,item});})});
    else if(data.operation==='workbook')value=parseMaterialPriceWorkbook(data.payload.bytes);
    else if(data.operation==='validate-pdf')value=preflightPdf(data.payload.bytes);
    else if(data.operation==='drawing-lines'){
      preflightPdf(data.payload.bytes);
      const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');pdfjs.GlobalWorkerOptions.workerSrc=new URL('../supplier-import/pdf.worker.min.mjs',scope.location.href).href;
      const task=pdfjs.getDocument({data:data.payload.bytes,maxImageSize:16_000_000});
      try{const pdf=await task.promise;const page=await pdf.getPage(data.payload.pageNumber);value=await drawingSegments(page,pdfjs.OPS);page.cleanup();}finally{await task.destroy();}
    }else throw new Error('Unsupported document operation.');
    scope.postMessage({kind:'result',value});
  }catch(error){scope.postMessage({kind:'error',message:error instanceof Error?error.message:'Document processing failed.'});}
};
