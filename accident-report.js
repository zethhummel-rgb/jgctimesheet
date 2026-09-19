const REPORT_EMAIL_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzPILTnOSzQcCkA6y5vSLxCH6i05Y2-ZHZAk09Und0YKiXZOYMppV4fvW3G6EgqOIZi/exec";
const supabaseClient = createJgcSupabaseClient();
const worker = requireJgcWorker();
const currentWorker = normalizeWorkerName(worker.key);
const currentWorkerDisplay = worker.display || worker.key;
let employees = [];
document.getElementById("currentUser").textContent = "Signed in as: " + currentWorkerDisplay;
document.getElementById("accidentDate").value = JGCSafetyReport.today();
function getValue(id){return document.getElementById(id).value.trim();}
function setStatus(message){document.getElementById("saveStatus").textContent=message||"";}
function makeSafeFileName(name){return String(name||"accident-report").trim().replace(/[^a-z0-9.\-_]+/gi,"-").replace(/-+/g,"-").toLowerCase();}
function createPublicReportId(){if(window.crypto&&typeof window.crypto.randomUUID==="function"){return window.crypto.randomUUID();}return"xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g,(c)=>{const r=Math.random()*16|0;return(c==="x"?r:(r&3|8)).toString(16);});}
async function loadEmployees(){
  let result;
  try { result=await supabaseClient.from("profiles").select("display_name,worker_key,email,account_status").eq("account_status","approved").order("display_name",{ascending:true}); }
  catch (_) { result={data:[],error:true}; }
  employees=(result.data||[]).map(p=>({workerName:normalizeWorkerName(p.worker_key||p.display_name||p.email),displayName:p.display_name||p.worker_key||p.email||""})).filter(p=>p.workerName);
  JGCSafetyReport.personPicker("injuredEmployee",employees,"");
  JGCSafetyReport.personPicker("reportMaker",employees,currentWorker);
  JGCSafetyReport.signatureBox("supervisorSignatureBox","Supervisor",()=>getValue("supervisorName"));
  if(result.error)setStatus("Employee list unavailable. You can still enter names manually.");
}
function selectedEmployee(id){return JGCSafetyReport.person(id)||{};}
function selectedFactors(){const factors=Array.from(document.querySelectorAll(".factor:checked")).map((box)=>box.value);const other=getValue("otherFactor");if(other){factors.push("Other: "+other);}return factors;}
function buildBody(r){return ["Supervisor's Accident Investigation","","Date: "+r.accident_date,"Time: "+r.accident_time,"Location: "+r.site_location,"Injured Employee: "+r.injured_worker_display,"Report Maker: "+r.report_maker_display,"","How it occurred:",r.incident_description,"","Nature / Extent:",r.nature_extent,"","Corrective Action:",r.corrective_action_prevent].join("\n");}
function row(label,value){return `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value||"")}</td></tr>`;}
let savedAccidentReport=null;
let savingAccidentReport=false;
const accidentReportId=createPublicReportId();
async function downloadAccidentPdf(){
  if(!savedAccidentReport){setStatus("Save the report first, then download its PDF.");return;}
  try{await JGCSafetyReport.download(savedAccidentReport,"accident");}catch(error){setStatus(error.message);}
}
async function submitAccidentReport(){
  if(savingAccidentReport||savedAccidentReport)return;
  const injured=selectedEmployee("injuredEmployee");const maker=selectedEmployee("reportMaker");
  if(!getValue("siteLocation")||!getValue("accidentDate")||!injured.workerName||!injured.displayName||!maker.workerName||!maker.displayName||!getValue("incidentDescription")){alert("Add the location, date, injured employee, report maker, and how the accident happened.");return;}
  const record={id:accidentReportId,accident_date:getValue("accidentDate"),accident_time:getValue("accidentTime"),site_location:getValue("siteLocation"),injured_worker:injured.workerName,injured_worker_display:injured.displayName,report_maker_worker:maker.workerName,report_maker_display:maker.displayName,job_title:getValue("jobTitle"),time_on_job:getValue("timeOnJob"),injury_location:getValue("injuryLocation"),property_damaged:getValue("propertyDamaged"),property_owner:getValue("propertyOwner"),activity_before_incident:getValue("activityBeforeIncident"),machine_or_tool:getValue("machineOrTool"),operation:getValue("operation"),incident_description:getValue("incidentDescription"),objects_substances:getValue("objectsSubstances"),body_part_affected:getValue("bodyPartAffected"),prior_physical_defects:getValue("priorPhysicalDefects"),prior_physical_defects_details:getValue("priorPhysicalDefectsDetails"),nature_extent:getValue("natureExtent"),contributing_factors:selectedFactors(),corrective_action_prevent:getValue("correctiveActionPrevent"),trained_ppe:getValue("trainedPpe"),cautioned_ppe:getValue("cautionedPpe"),promptly_reported:getValue("promptlyReported"),modified_duty_available:getValue("modifiedDutyAvailable"),corrective_action_taken:getValue("correctiveActionTaken"),corrective_action_taken_by:getValue("correctiveActionTakenBy"),corrective_action_date:getValue("correctiveActionDate")||null,supervisor_name:getValue("supervisorName"),supervisor_signature:JGCSafetyReport.signature("supervisorSignatureBox")?.printedName||"",created_by_worker:currentWorker,created_by_name:currentWorkerDisplay,report_details:{version:1,injuredPerson:injured,reportMaker:maker,signatures:[JGCSafetyReport.signature("supervisorSignatureBox")].filter(Boolean)}};
  savingAccidentReport=true;
  const button=document.getElementById("saveAccidentReport");button.disabled=true;
  let acknowledgementFailed=false;
  try {
    const pdfHtml=await JGCSafetyReport.html(record,"accident");
    setStatus("Saving accident report…");
    const {error}=await supabaseClient.from("accident_reports").insert(record);
    if(error)throw new Error("Accident report could not be saved. Your entries are still here. Please try again.");
    savedAccidentReport=record;
    document.querySelectorAll(".container input,.container select,.container textarea,.signature-box button").forEach(input=>input.disabled=true);
    button.textContent="Report saved";
    if(!injured.manual){
      try{const result=await supabaseClient.from("accident_report_acknowledgements").insert({accident_report_id:record.id,worker_name:injured.workerName,worker_display_name:injured.displayName});acknowledgementFailed=Boolean(result.error);}catch(_){acknowledgementFailed=true;}
    }
    const subject="Supervisor Accident Investigation - "+injured.displayName+" - "+record.accident_date;
    await fetch(REPORT_EMAIL_SCRIPT_URL,{method:"POST",mode:"no-cors",headers:{"Content-Type":"text/plain;charset=utf-8"},body:JSON.stringify(withJgcSubcontractorEmailCopy({subject,body:buildBody(record),text:buildBody(record),pdfHtml,pdfFileName:makeSafeFileName(subject)+".pdf",source:"accident_report"}))});
    setStatus("Report saved. Email request sent; delivery cannot be confirmed here."+(acknowledgementFailed?" Employee acknowledgement could not be created; contact an administrator.":""));
  }catch(error){setStatus(savedAccidentReport?"Report saved, but the email request failed. Download the PDF to send it manually."+(acknowledgementFailed?" Employee acknowledgement also needs administrator attention.":""):error.message);}
  finally{savingAccidentReport=false;button.disabled=Boolean(savedAccidentReport);}
}

async function signOut(){await signOutJgc(supabaseClient);}
const savedId=new URLSearchParams(location.search).get("reportId");
if(savedId){
  document.querySelector(".grid").hidden=true;document.querySelector(".actions").hidden=true;
  setStatus("Loading saved report…");
  (async()=>{try{const {data,error}=await supabaseClient.from("accident_reports").select("*").eq("id",savedId).single();if(error||!data)throw new Error("Report unavailable. Check that you are signed in with access to this report.");await JGCSafetyReport.view(data,"accident",document.querySelector(".container"));}catch(error){setStatus(error.message);}})();
}else{loadEmployees();}
