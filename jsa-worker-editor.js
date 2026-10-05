document.getElementById('jsaSaveWorkerDraft').onclick=()=>void runJsaWorkerAction(()=>saveJsaWorkerDraft());
document.getElementById('jsaWorkerPdf').onclick=()=>void runJsaWorkerAction(async()=>{const record=await saveJsaWorkerDraft();await JgcJsaPdf.download(record,{acknowledgements:record.safety_acknowledgements});});
document.getElementById('jsaCompleteWorkers').onclick=()=>void completeJsaWorkers();
document.getElementById('jsaField3').addEventListener('change',updateJsaWorkDate);
document.addEventListener('DOMContentLoaded',updateJsaWorkDate);
updateJsaWorkDate();
window.addEventListener('focus',updateJsaWorkDate);
window.addEventListener('pageshow',updateJsaWorkDate);
setInterval(()=>{if(!document.hidden)updateJsaWorkDate();},30000);
(async()=>{
  const id=new URLSearchParams(location.search).get('record');if(!id)return;
  await window.jsaCrewReady;
  jsaWorkerModel=await JGCJsaWorkers.load(inspectionSupabaseClient,id);
  const crew=jsaWorkerModel.acknowledgements.filter(a=>a.matched_employee_id).map(a=>({profile_id:a.matched_employee_id,display_name:a.attendee_name,worker_key:a.attendee_name.toLowerCase()}));
  const manual=jsaWorkerModel.acknowledgements.filter(a=>!a.matched_employee_id).map(a=>({name:a.attendee_name,company:a.attendee_company}));
  window.JgcPreparedJsa.restore({record:jsaWorkerModel.record,crew,manual});
  showJsaSafetyQrAfterSave(jsaWorkerModel.record,jsaWorkerModel.acknowledgements);
})().catch(error=>setInspectionSaveStatus(error.message || 'Could not open JSA.'));

