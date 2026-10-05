(function () {
  'use strict';
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const today = () => new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const isNew = record => Number(record?.form_data?.jsa_worker_workflow_version) === 2 || record?.jsa_workflow?.version === 2;
  function state(record, rows) {
    if (!isNew(record)) return null;
    if (record.jsa_workflow?.today === today()) return record.jsa_workflow;
    const activeRows=(rows || record.safety_acknowledgements || []).filter(a=>!a.removed_at);
    const signed=activeRows.filter(a=>a.signature_signed_at && a.signature_strokes).length;
    const date=record.inspection_date, active=date===today();
    return {version:2,revision:record.jsa_workflow?.revision || 1,valid_date:date,active,required:activeRows.length,signed,outstanding:activeRows.length-signed,
      status:date>today()?'Prepared':signed && signed===activeRows.length?'Completed':date<today()?'Draft — Work Date Passed':activeRows.length?'Draft — Awaiting Worker Sign-Offs':'Draft — Workers Onsite Required'};
  }
  function roster(rows, future=false, collect=false) {
    const list=(rows||[]).filter(a=>!a.removed_at);
    if (!list.length) return '<p class="jgc-empty-state">No Workers Onsite selected.</p>';
    return '<div class="jgc-jsa-workers-roster">'+list.map(a=>`<div class="jgc-record-row"><div><strong>${escape(a.attendee_name)}</strong><div>${escape(a.attendee_company || '')}</div></div><span class="jgc-badge ${a.signature_signed_at?'jgc-badge--success':'jgc-badge--warning'}">${a.signature_signed_at?'Signed · '+escape(new Date(a.signature_signed_at).toLocaleString()):future?'Planned — sign on work date':'Outstanding'}</span>${collect && !a.signature_signed_at?'<button type="button" class="jgc-button" data-jsa-worker-sign="'+escape(a.id)+'">Acknowledge and sign</button>':''}</div>`).join('')+'</div>';
  }
  async function rpc(client,name,args) {const result=await client.rpc(name,args);if(result.error)throw result.error;if(!result.data?.record)throw new Error('The JSA workflow could not be verified. Refresh and try again.');return result.data;}
  function attach(model) {model.record.safety_acknowledgements=model.acknowledgements || [];model.record.jsa_workflow=model.workflow || null;return model.record;}
  async function load(client,id) {const model=await rpc(client,'get_jsa_worker_workflow',{p_id:id});attach(model);return model;}
  async function request(client,id) {const model=await rpc(client,'request_jsa_worker_signoff',{p_id:id});attach(model);return model;}
  async function sign(client,model,workerId) {
    const worker=model.acknowledgements.find(a=>a.id===workerId);
    if(!worker || worker.signature_signed_at)throw new Error('Select an outstanding worker.');
    if(!model.workflow?.active || !model.can_collect)throw new Error('Worker signatures are collected on the JSA creator phone on the work date.');
    return new Promise(resolve=>window.JGCSafetySignature.open({attendeeName:worker.attendee_name,company:worker.attendee_company,readOnlyName:true,requireReadConfirmation:true,recordLabel:model.record.title || 'JSA',onSubmit:async signature=>{
      const next=await rpc(client,'sign_jsa_worker',{p_id:model.record.id,p_revision:model.workflow.revision,p_confirm_read:signature.confirmedRead,p_strokes:signature.strokes,p_width:signature.width,p_height:signature.height,p_acknowledgement_id:workerId});attach(next);resolve(next);return {ok:true,message:'Worker signature saved.'};
    },onClose:()=>resolve(null)}));
  }
  let reviewGeneration=0;
  async function openReview(client,id,panel,options={}) {
    const generation=++reviewGeneration;
    panel.hidden=false;panel.innerHTML='<p role="status">Loading JSA…</p>';panel.scrollIntoView({block:'start'});
    try {
      const model=await load(client,id);if(generation!==reviewGeneration)return;
      const record=model.record, status=model.workflow || state(record,model.acknowledgements);
      if (!status) throw new Error('This historical JSA keeps its existing signatures and workflow.');
      panel.innerHTML=`<h2>${escape(record.title || 'JSA')}</h2><p class="jgc-notice" role="status">${escape(status.status)} · ${status.signed}/${status.required} workers signed${status.outstanding?' · '+status.outstanding+' outstanding':''}</p><div class="jgc-jsa-worker-preview"></div><h3>Workers Onsite</h3>${roster(model.acknowledgements,!status.active && status.status==='Prepared',!!model.can_collect && status.active && !!status.requested_at)}<div class="jgc-actions">${model.can_collect && status.active?'<button type="button" class="jgc-button" data-jsa-request>Complete and Worker Sign Off</button>':''}<button type="button" class="jgc-button jgc-button--secondary" data-jsa-refresh>Refresh sign-offs</button><button type="button" class="jgc-button jgc-button--secondary" data-jsa-close>Close</button></div><p data-jsa-status role="status">${status.active?'Every worker, including manual entries, must acknowledge and sign their name on the creator phone.':status.status==='Prepared'?'Prepared for '+escape(status.valid_date)+'. No worker signatures are required yet.':'Signing is available only on the work date.'}</p>`;
      const message=panel.querySelector('[data-jsa-status]');
      const action=async fn=>{try{await fn();}catch(error){message.textContent=error.message || 'Could not save. The signature has not been submitted.';}};
      panel.querySelectorAll('[data-jsa-worker-sign]').forEach(button=>button.onclick=()=>action(async()=>{const next=await sign(client,model,button.dataset.jsaWorkerSign);if(next){await options.onSaved?.(next);await openReview(client,id,panel,options);}}));
      panel.querySelector('[data-jsa-request]')?.addEventListener('click',()=>action(async()=>{message.textContent='All workers need to sign off report before JSA is completed.';const next=await request(client,id);await options.onSaved?.(next);await openReview(client,id,panel,options);panel.querySelector('[data-jsa-status]').textContent='All workers need to sign off report before JSA is completed.';}));
      panel.querySelector('[data-jsa-refresh]').onclick=()=>void openReview(client,id,panel,options);
      panel.querySelector('[data-jsa-close]').onclick=()=>{reviewGeneration++;panel.hidden=true;panel.replaceChildren();};
      if (!window.JGCJsaPreview) await loadJgcScriptOnce('job-board-jsa-preview.js?v=2');
      const pdf=await window.JgcJsaPdf.create(record,{acknowledgements:model.acknowledgements});
      if(generation!==reviewGeneration)return;
      await window.JGCJsaPreview.render(panel.querySelector('.jgc-jsa-worker-preview'),{blob:pdf.output('blob'),mimeType:'application/pdf'},()=>generation===reviewGeneration);
    } catch(error) {if(generation===reviewGeneration)panel.innerHTML='<p role="status" class="jgc-notice">'+escape(error.message || 'Could not open the JSA.')+'</p>';}
  }
  window.JGCJsaWorkers={today,isNew,state,roster,load,request,sign,attach,openReview};
}());
