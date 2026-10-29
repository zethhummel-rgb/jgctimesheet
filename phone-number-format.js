(function(root){
 "use strict";
 function format(value,options){
  const original=String(value==null?'':value),raw=original.trim();if(!raw)return '';
  const match=raw.match(/\s*(?:ext(?:ension)?\.?|x|#)\s*\d*$/i),suffix=match?raw.slice(match.index):'',base=match?raw.slice(0,match.index).trim():raw;
  if(!/^\+?[\d\s().-]+$/.test(base)||(/^\+/.test(base)&&!/^\+1(?:\D|\d|$)/.test(base)))return original;
  let digits=base.replace(/\D/g,''),prefix='';
  if(base.startsWith('+1')){prefix='+1';digits=digits.slice(1);}else if(digits.length===11&&digits[0]==='1'){prefix='1';digits=digits.slice(1);}
  if(digits.length>10||(!prefix&&base.startsWith('+')))return original;
  const parts=options&&options.final&&digits.length===7?[digits.slice(0,3),digits.slice(3)]:[digits.slice(0,3),digits.slice(3,6),digits.slice(6,10)];
  const result=[prefix,...parts.filter(Boolean)].filter(Boolean).join('-');
  return result+(suffix?( /^\s/.test(suffix)?suffix:' '+suffix):'')+(!(options&&options.final)?original.match(/\s+$/)?.[0]||'':'');
 }
 function position(before,after,offset){
  if(offset>=before.length)return after.length;
  const count=(before.slice(0,offset).match(/[\dA-Za-z+]/g)||[]).length;if(!count)return 0;let found=0;
  for(let i=0;i<after.length;i++)if(/[\dA-Za-z+]/.test(after[i])&&++found===count)return i+1;
  return after.length;
 }
 function deletion(value,start,end,key){
  const base=value.replace(/\s*(?:ext(?:ension)?\.?|x|#)\s*\d*$/i,'').trim(),digits=base.replace(/\D/g,'');
  if(!/^\+?[\d\s().-]+$/.test(base)||/^\+(?!1)/.test(base)||digits.length>11||(digits.length===11&&digits[0]!=='1'))return {start,end};
  if(start!==end)return {start,end};
  if(key==='Backspace'&&start>1&&/[\s().-]/.test(value[start-1])&&/[\dA-Za-z]/.test(value[start-2]))return {start:start-2,end:start};
  if(key==='Delete'&&start<value.length-1&&/[\s().-]/.test(value[start])&&/[\dA-Za-z]/.test(value[start+1]))return {start,end:start+2};
  return {start,end};
 }
 const bound=new WeakSet();
 function bind(scope){
  if(bound.has(scope))return;bound.add(scope);
  const phone=e=>e.target instanceof HTMLInputElement&&e.target.matches('input[type="tel"],input[inputmode="tel"],input[data-phone-format]')&&!e.target.disabled&&!e.target.readOnly?e.target:null;
  const update=(e,final)=>{const input=phone(e);if(!input||e.isComposing)return;const before=input.value,after=format(before,{final});if(before===after)return;const start=input.selectionStart??before.length,end=input.selectionEnd??start;input.value=after;if(document.activeElement===input)input.setSelectionRange(position(before,after,start),position(before,after,end));};
  scope.addEventListener('input',e=>update(e,false),true);scope.addEventListener('blur',e=>update(e,true),true);
  scope.addEventListener('keydown',e=>{const input=phone(e);if(!input||!['Backspace','Delete'].includes(e.key))return;const r=deletion(input.value,input.selectionStart||0,input.selectionEnd||0,e.key);input.setSelectionRange(r.start,r.end);},true);
 }
 const api={format,position,deletion,bind};root.JgcPhoneNumbers=api;if(typeof module==='object'&&module.exports)module.exports=api;
})(globalThis);
