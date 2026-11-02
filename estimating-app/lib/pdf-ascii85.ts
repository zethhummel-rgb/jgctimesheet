// Decode incrementally so ASCII85 zero groups cannot allocate an unbounded buffer.
export function decodePdfAscii85(bytes:Uint8Array,emit:(chunk:Uint8Array)=>void){
 const fail=()=>{throw new Error('This PDF is too complex to process. Its ASCII85 stream is invalid or exceeds the processing limit.');};
 let value=0,digits=0,used=0,total=0,ended=false;const chunk=new Uint8Array(4096);
 const write=(word:number,count:number)=>{for(let n=0;n<count;n++){if(++total>16*1024*1024)fail();chunk[used++]=(word>>>((3-n)*8))&255;if(used===chunk.length){emit(chunk.slice());used=0;}}};
 const space=(byte:number)=>[0,9,10,12,13,32].includes(byte);
 for(let n=0;n<bytes.length;n++){
  const byte=bytes[n];if(space(byte))continue;
  if(byte===126){if(bytes[++n]!==62||digits===1)fail();if(digits){const count=digits-1;while(digits++<5)value=value*85+84;if(value>0xffffffff)fail();write(value,count);}for(n++;n<bytes.length;n++)if(!space(bytes[n]))fail();ended=true;break;}
  if(byte===122){if(digits)fail();write(0,4);continue;}
  if(byte<33||byte>117)fail();value=value*85+byte-33;
  if(++digits===5){if(value>0xffffffff)fail();write(value,4);value=0;digits=0;}
 }
 if(!ended)fail();if(used)emit(chunk.slice(0,used));
}
