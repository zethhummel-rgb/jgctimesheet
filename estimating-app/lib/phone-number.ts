import '../../phone-number-format.js';
import {safetyTextRuns,safetyRunValue,type SafetyTextRun} from './site-specific-rich-text';
declare global {var JgcPhoneNumbers:{format:(value:string,options?:{final?:boolean})=>string;position:(before:string,after:string,offset:number)=>number;deletion:(value:string,start:number,end:number,key:string)=>{start:number;end:number}};}
export function formatPhoneRichText(value:string,final=false){
 const runs=safetyTextRuns(value),plain=runs.map(r=>r.text).join(''),formatted=globalThis.JgcPhoneNumbers.format(plain,{final});if(plain===formatted)return value;
 const source=runs.flatMap(run=>[...run.text].map(text=>({text,style:run.style}))).filter(c=>/[\dA-Za-z+]/.test(c.text));let index=0;const result:SafetyTextRun[]=[];
 for(const text of formatted){const significant=/[\dA-Za-z+]/.test(text),style=(source[Math.min(index,source.length-1)]||runs[0])?.style;if(!style)return formatted;const last=result.at(-1);if(last&&JSON.stringify(last.style)===JSON.stringify(style))last.text+=text;else result.push({text,style});if(significant)index++;}
 return result.map(safetyRunValue).join('');
}
export const phonePosition=(before:string,after:string,offset:number)=>globalThis.JgcPhoneNumbers.position(before,after,offset);
export const phoneDeletion=(value:string,start:number,end:number,key:string)=>globalThis.JgcPhoneNumbers.deletion(value,start,end,key);
