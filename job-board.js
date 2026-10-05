(function () {
  'use strict';
  const CATEGORIES = [
    ['hs-documents', 'H&S documentation'], ['site-specific', 'Site-specific safety'],
    ['jgc-policy', 'JGC policies'], ['jsa', 'Job safety analysis (JSA)'],
    ['toolbox-talk', 'Toolbox talks'], ['accident-incident', 'Accident / incident reports'],
    ['daily-report', 'Daily reports & photos'], ['permit', 'Permits'],
    ['inspection', 'Inspections'], ['other', 'Other reports']
  ];
  const FORMS = [
    ['jsa.html', 'JSA'], ['toolbox-talks.html', 'Toolbox talk'],
    ['daily-site-report.html', 'Daily site report'], ['incident-report.html', 'Incident report'],
    ['accident-report.html', 'Accident report'], ['employee-injury-report.html', 'Injury report'],
    ['hot-work-permit.html', 'Hot work permit'], ['excavation-permit.html', 'Excavation permit'],
    ['confined-space-permit.html', 'Confined space permit'], ['aerial-lifts.html', 'Aerial lift inspection'],
    ['forklift.html', 'Forklift inspection'], ['harness.html', 'Harness inspection'], ['tele-handler.html', 'Telehandler inspection']
  ];
  const TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
  const hash = new URLSearchParams(location.hash.slice(1));
  const params = new URLSearchParams(location.search);
  const state = {
    client: null, board: null, user: null, token: hash.get('board') || '',
    job: params.get('job') || '', manage: params.get('manage') === '1',
    visit: null, generation: 0, uploads: new Map(), uploadBusy: false,
    logs: {portal:{events:[],busy:false,loaded:false,before:null},site:{events:[],busy:false,loaded:false,before:null}}, sourcesLoaded: false,
    previewUrl: null, previewGeneration: 0, highlighted: hash.get('document') || '', loggedBoardVisit: ''
  };
  const $ = (id) => document.getElementById(id);
  const text = (tag, value, cls) => { const e = document.createElement(tag); e.textContent = value == null ? '' : String(value); if (cls) e.className = cls; return e; };
  const hosted = document.documentElement.dataset.jobBoardHost === 'job';
  if (hosted) {
    const toolbar = $('boardToolbar');
    toolbar.hidden = false;
    toolbar.append($('boardRefresh'));
    const parentTokens = {
      '--jgc-color-surface': '--jgc-estimator-surface',
      '--jgc-color-surface-raised': '--jgc-estimator-surface',
      '--jgc-color-surface-soft': '--jgc-estimator-slate-50',
      '--jgc-color-text': '--jgc-estimator-slate-900',
      '--jgc-color-text-muted': '--jgc-estimator-slate-600',
      '--jgc-color-text-dark': '--jgc-estimator-navy-950',
      '--jgc-color-border': '--jgc-estimator-slate-200',
      '--jgc-color-border-soft': '--jgc-estimator-slate-100',
      '--jgc-color-input': '--jgc-estimator-white',
      '--jgc-color-input-border': '--jgc-estimator-slate-300',
      '--jgc-color-notice': '--jgc-estimator-green-100',
      '--jgc-color-brand-400': '--jgc-estimator-green-600',
      '--jgc-color-brand-500': '--jgc-estimator-green-600',
      '--jgc-color-link-hover': '--jgc-estimator-navy-700',
      '--jgc-shadow-sm': '--jgc-estimator-shadow-sm',
      '--jgc-font-family': '--jgc-estimator-font-family',
      '--jgc-job-heading': '--jgc-estimator-navy-900'
    };
    function inheritTheme() {
      const theme = window.parent.document.documentElement.dataset.jgcTheme;
      const parentStyle = window.parent.getComputedStyle(window.parent.document.documentElement);
      Object.entries(parentTokens).forEach(([target, source]) => {
        const value = parentStyle.getPropertyValue(source).trim();
        if (value) document.documentElement.style.setProperty(target, value);
      });
      if ((theme === 'light' || theme === 'dark') && document.documentElement.dataset.jgcTheme !== theme) applyJgcTheme(theme);
    }
    const themeObserver = new MutationObserver(inheritTheme);
    themeObserver.observe(window.parent.document.documentElement, { attributes: true, attributeFilter: ['data-jgc-theme'] });
    window.parent.addEventListener('jgc-theme-change', inheritTheme);
    window.addEventListener('jgc-theme-change', inheritTheme);
    window.addEventListener('pagehide', (event) => {
      if (event.persisted) return;
      themeObserver.disconnect();
      window.parent.removeEventListener('jgc-theme-change', inheritTheme);
      window.removeEventListener('jgc-theme-change', inheritTheme);
    });
    inheritTheme();
  }
  function empty(parent, message) { parent.replaceChildren(text('p', message, 'jgc-empty-state')); }
  function categoryName(value) { return (CATEGORIES.find((item) => item[0] === value) || ['', 'Other reports'])[1]; }
  function categories(select, selected) { CATEGORIES.forEach(([value, label]) => { const o = text('option', label); o.value = value; select.append(o); }); if (selected) select.value = selected; }
  function status(id, message, kind) { const e = $(id); e.textContent = message || ''; e.dataset.state = kind || ''; }
  function notice(message, kind) { const e = $('boardNotice'); e.textContent = message || ''; e.hidden = !message; e.className = 'jgc-notice board-notice' + (kind === 'error' ? ' jgc-notice--danger' : kind === 'warning' ? ' jgc-notice--warning' : ''); }
  function errorMessage(error) { return error && error.message ? error.message : 'This action could not be completed. Please try again.'; }
  function busy(button, value, label) { button.disabled = value; if (label) button.textContent = label; }
  function dateToday() { const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()); return ['year', 'month', 'day'].map((key) => parts.find((p) => p.type === key).value).join('-'); }
  function dateLabel(value) { if (!value) return 'No report date'; const date = new Date(String(value).slice(0, 10) + 'T12:00:00Z'); return Number.isNaN(date.getTime()) ? String(value).slice(0, 10) : date.toLocaleDateString('en-CA', { timeZone: 'America/Toronto', month: 'short', day: 'numeric', year: 'numeric' }); }
  function timeLabel(value) { const d = new Date(value); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-CA', { timeZone: 'America/Toronto', dateStyle: 'medium', timeStyle: 'short' }); }
  function bytes(value) { const n = Number(value || 0); return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n ? Math.ceil(n / 1024) + ' KB' : ''; }
  async function rpc(name, args) { if (!state.client) throw new Error('The Portal connection is unavailable. Refresh and try again.'); const result = await state.client.rpc(name, args); if (result.error) throw result.error; const data = result.data; return Array.isArray(data) && data.length === 1 && name !== 'get_job_board_activity' && name !== 'list_job_board_sources' && name !== 'get_job_board_contacts' ? data[0] : data; }
  function storageKey() { return 'jgcJobBoardVisit:' + state.token; }
  function loadVisit() { try { const saved = JSON.parse(sessionStorage.getItem(storageKey()) || 'null'); return saved && saved.token && saved.userId === (state.user && state.user.id || '') ? saved : null; } catch (_) { return null; } }
  function saveVisit(data, label) { state.visit = { token: data.visit_token, userId: state.user && state.user.id || '', label: label || state.user && state.user.email || 'Visitor' }; try { sessionStorage.setItem(storageKey(), JSON.stringify(state.visit)); } catch (_) {} }
  function clearVisit() { state.visit = null; try { sessionStorage.removeItem(storageKey()); } catch (_) {} }
  async function registerVisit(details) { const data = await rpc('register_job_board_visit', Object.assign({ p_token: state.token, p_name: '', p_company: '', p_email: '' }, details)); if (!data || !data.visit_token) throw new Error('Your site sign-in could not be saved. Please try again.'); saveVisit(data, details && details.p_name); }
  function boardLink(documentId) { const u = new URL('job-board.html', location.href); u.search = '?embedded=1'; u.hash = new URLSearchParams(Object.assign({ board: state.token }, documentId ? { document: documentId } : {})).toString(); return u.href; }
  async function loadBoard() {
    jsaReviewGeneration++;jsaReview=null;$('jsaSignOnPanel').hidden=true;
    const generation = ++state.generation;
    ['loginOptions','siteGate','visitorGate','staffGate'].forEach(id => $(id).hidden = true); $('boardLoading').hidden = false; $('boardError').hidden = true; $('visitorGate').hidden = true; $('boardContent').hidden = true;
    try {
      if (!state.token && (!state.manage || !state.job)) throw new Error('This link is missing its Job Board code. Scan the posted QR code or open Job Board from the job.');
      if (!state.client) state.client = typeof createJgcSupabaseClient === 'function' ? createJgcSupabaseClient() : null;
      if (!state.client) throw new Error('The Portal could not connect. Check your connection and try again.');
      const auth = await state.client.auth.getUser();
      if (generation !== state.generation) return;
      state.user = !auth.error && auth.data && auth.data.user || null;
      if (state.user && window.JGCJobBoardContext?.retryAttachments) await window.JGCJobBoardContext.retryAttachments();
      if (generation !== state.generation) return;
      state.visit = loadVisit();
      let board;
      if (state.manage) {
        if (!state.user) { $('staffGate').hidden = false; throw new Error('Sign in to manage this job’s board.'); }
        board = await rpc('get_or_create_job_board', { p_job_id: state.job });
      } else {
        board = await rpc('get_job_board', { p_token: state.token, p_visit_token: state.visit && state.visit.token || null });
        if (state.user && board?.can_register_as_staff && (!state.visit || board.requires_visitor_signin)) {
          await registerVisit();
          board = await rpc('get_job_board', { p_token: state.token, p_visit_token: state.visit && state.visit.token || null });
        }
      }
      if (generation !== state.generation) return;
      if (!board || !board.id) throw new Error('This Job Board is unavailable or its QR link has been replaced. Ask the site supervisor for the current code.');
      state.board = board;
      if (board.token) state.token = board.token;
      if (state.manage && state.user && board.can_upload) { state.visit = loadVisit(); if (!state.visit) await registerVisit(); }
      if (generation !== state.generation) return;
      renderBoard();
    } catch (error) {
      if (generation !== state.generation) return;
      $('boardErrorMessage').textContent = errorMessage(error); $('boardError').hidden = false;
    } finally { if (generation === state.generation) $('boardLoading').hidden = true; }
  }
  function renderBoard() {
    const board = state.board;
    syncBoardTheme();
    const title = [board.job_number ? 'Job ' + board.job_number : '', board.job_name].filter(Boolean).join(' · ') || 'Job Board';
    $('boardTitle').textContent = title; $('boardAddress').textContent = board.address || '';
    document.title = title + ' · JGC Job Board';
    $('boardIdentity').textContent = state.user ? 'Signed in: ' + state.user.email : state.visit ? 'Site visitor: ' + state.visit.label : '';
    $('boardIdentity').hidden = !$('boardIdentity').textContent;
    $('boardLogout').hidden = !state.user && !state.visit;
    $('boardSignIn').hidden = !!state.user || !!board.requires_visitor_signin;
    const gated = !state.manage && !!board.requires_visitor_signin;
    $('boardSiteSignIn').hidden = state.manage || gated;
    $('boardContacts').hidden = gated;
    if (gated && $('contactsDialog').open) $('contactsDialog').close();
    $('loginOptions').hidden = !gated; $('visitorGate').hidden = true; $('boardContent').hidden = gated;
    if (gated) { clearVisit(); return; }
    const manager = state.manage && board.can_manage;
    $('boardManager').hidden = !manager; $('reviewTab').hidden = !manager;
    $('boardViewersPanel').hidden = !manager; $('boardActivityPanel').hidden = !manager; $('boardSiteActivityPanel').hidden = !manager;
    $('uploadForm').hidden = !board.can_upload; $('uploadSignIn').hidden = !!board.can_upload;
    $('createForms').hidden = !board.can_upload;
    $('uploadTab').textContent = state.manage ? 'Upload' : 'Create Todays Reports';
    $('uploadPanel').querySelector('h2').textContent = state.manage ? 'Upload a site document' : 'Create Todays Reports';
    const documents = Array.isArray(board.documents) ? board.documents : [];
    const published = documents.filter((d) => d.status === 'published');
    const pending = documents.filter((d) => d.status === 'pending');
    $('reviewCount').textContent = pending.length ? '(' + pending.length + ')' : '';
    renderDocuments($('reviewList'), pending, 'No uploads are waiting for review.', true);
    renderLibrary();
    if (manager) { renderManager(); renderViewers(); for(const kind of ['portal','site'])if($(kind==='portal'?'boardActivity':'boardSiteActivity').open && !state.logs[kind].loaded)void loadActivity(kind,false); }
    if (board.can_upload) renderCreateForms();
    if (state.highlighted) highlightDocument();
  }
  const SECTIONS = [
    ['siteSpecificList', 'Site Specific', ['site-specific','hs-documents'], 'Safety plans, site hazards, emergency procedures and requirements for this job.'],
    ['dailyReportsList', 'Daily Reports', ['daily-report','jsa','toolbox-talk','accident-incident','other'], 'Daily site updates, job safety analyses (JSAs), toolbox talks and report photos. Restricted reports require authorized staff or client access.'],
    ['inspectionList', 'Daily Inspections', ['inspection'], 'Equipment and safety inspections completed for this job, including inspections submitted through equipment QR codes.'],
    ['permitList', 'Daily Permits', ['permit'], 'Work permits for this job, such as hot work, excavation and confined-space entry.'],
    ['policyList', 'JGC Policy', ['jgc-policy'], 'John Gordon Construction’s current company health and safety policy.']
  ];
  function renderLibrary() {
    const all = (state.board?.documents || []).filter(d => d.status === 'published');
    all.sort((a,b) => String(b.created_at || b.report_date || '').localeCompare(String(a.created_at || a.report_date || '')) || String(b.id).localeCompare(String(a.id)));
    SECTIONS.forEach(([id,label,categories,description]) => {
      let list = $(id);
      if (!list) {
        const section = text('details','', 'jgc-panel board-category');
        const summary = text('summary', label); summary.append(text('span','', 'jgc-badge board-section-count'));
        list = text('div','', 'board-category-list'); list.id = id;
        summary.append(text('span',description,'board-help board-category-description')); section.append(summary,list); $('documentSections').append(section);
      }
      const docs = all.filter(d => categories.includes(d.category));
      list.parentElement.querySelector('.board-section-count').textContent = docs.length;
      if (['dailyReportsList','inspectionList','permitList'].includes(id)) {
        const headings = id === 'dailyReportsList' ? ['Todays Reports','Previous Reports'] : id === 'inspectionList' ? ['Todays Inspections','Previous Inspections'] : ['Todays Permits','Previous Permits'];
        const today=dateToday(), periods=[docs.filter(d=>String(d.report_date||'').slice(0,10)===today),docs.filter(d=>String(d.report_date||'').slice(0,10)<today)], future=docs.filter(d=>String(d.report_date||'').slice(0,10)>today);
        const expanded=new Map(Array.from(list.querySelectorAll('.board-report-period')).map(section=>[section.querySelector('[data-period]')?.dataset.period,section.open]));
        list.replaceChildren(); periods.forEach((items,index)=>{
          const section=text('details','','board-report-period');section.open=expanded.has(index===0?'today':'previous')?expanded.get(index===0?'today':'previous'):index===0;
          const summary=text('summary',headings[index]);summary.append(text('span',items.length,'jgc-badge board-section-count'));
          const records=text('div','','board-category-list');records.dataset.period=index===0?'today':'previous';renderDocuments(records,items,index===0?'No reports for today.':'No previous reports.');section.append(summary,records);list.append(section);
        });
        if(future.length){const section=text('details','','board-report-period'),summary=text('summary','Upcoming');summary.append(text('span',future.length,'jgc-badge board-section-count'));const records=text('div','','board-category-list');renderDocuments(records,future,'');section.append(summary,records);list.append(section);}
      } else renderDocuments(list,docs,id === 'policyList' ? 'The company safety policy is unavailable. Please contact the office.' : 'No published documents yet.');
    });
  }
  let jsaReview = null, jsaReviewGeneration = 0;
  async function openJsaSignOn(doc) {
    const generation=++jsaReviewGeneration; jsaReview=null; $('boardContent').hidden=true; $('jsaSignOnPanel').hidden=false;
    $('jsaSignOnTitle').textContent=doc.title || 'Sign on to JSA';$('jsaSignOnReport').replaceChildren();$('jsaSignOnRoster').replaceChildren();$('jsaSignOnRead').checked=false;$('jsaSignOnSign').disabled=true;$('jsaSignOnPdf').disabled=true;status('jsaSignOnStatus','Loading JSA…');
    $('jsaSignOnPanel').scrollIntoView({block:'start'});
    try {
      const model=await rpc('get_job_board_jsa',{p_token:state.token,p_visit_token:state.visit?.token||null,p_document_id:doc.id});
      if(generation!==jsaReviewGeneration)return;jsaReview={doc,model};$('jsaSignOnPdf').disabled=false;$('jsaSignOnPdf').textContent=String(doc.mime_type||'').startsWith('image/')?'Open JSA image':'Open JSA PDF';status('jsaSignOnStatus',model.signed?'You signed this JSA on '+timeLabel(model.signed_at):'Read the JSA below before signing.');
      $('jsaSignOnIdentity').textContent='Signing as '+model.identity.name+' · '+model.identity.company;
      const report=$('jsaSignOnReport');
      status('jsaSignOnStatus','Preparing JSA PDF…');
      const file = model.record ? {blob:await window.JGCJobBoardPdf.create({source_type:'inspection_records',record:model.record,acknowledgements:model.acknowledgements}),mimeType:'application/pdf'} : await documentFile(doc);
      if(generation!==jsaReviewGeneration)return;
      if(!window.JGCJsaPreview)await loadJgcScriptOnce('job-board-jsa-preview.js?v=2');
      await window.JGCJsaPreview.render(report,file,()=>generation===jsaReviewGeneration);
      if(generation!==jsaReviewGeneration)return;
      status('jsaSignOnStatus',model.signed?'You signed this JSA on '+timeLabel(model.signed_at):'Read the JSA below before signing.');
      const signed=(model.acknowledgements||[]).filter(a=>a.signature_signed_at);
      if(!signed.length)empty($('jsaSignOnRoster'),'No signatures recorded yet.');
      signed.forEach(ack=>{const row=text('div','','jgc-record-row');row.append(text('strong',ack.attendee_name),text('span',ack.attendee_company || ''),text('time',timeLabel(ack.signature_signed_at),'board-help'));$('jsaSignOnRoster').append(row);});
      $('jsaSignOnSign').disabled=!!model.signed;$('jsaSignOnRead').disabled=!!model.signed;$('jsaSignOnSign').textContent=model.signed?'Already signed':'Sign onto JSA';
    }catch(error){if(generation===jsaReviewGeneration){status('jsaSignOnStatus',errorMessage(error)+' Reopen this JSA to try again.','error');$('jsaSignOnReport').replaceChildren();}}
  }
  $('jsaSignOnBack').addEventListener('click',()=>{jsaReviewGeneration++;jsaReview=null;$('jsaSignOnPanel').hidden=true;$('boardContent').hidden=false;});
  $('jsaSignOnRead').addEventListener('change',()=>{$('jsaReadContinue').disabled=!jsaReview||jsaReview.model.signed||!$('jsaSignOnRead').checked;});
  $('jsaSignOnPdf').addEventListener('click',e=>{if(jsaReview)void viewDocument(jsaReview.doc,e.currentTarget);});
  $('jsaSignOnSign').addEventListener('click',()=>{if(!jsaReview||jsaReview.model.signed)return;$('jsaSignOnRead').checked=false;$('jsaReadContinue').disabled=true;$('jsaReadDialog').showModal();});
  $('jsaReadCancel').addEventListener('click',()=>$('jsaReadDialog').close());
  $('jsaReadContinue').addEventListener('click',()=>{
    if(!jsaReview||!$('jsaSignOnRead').checked||jsaReview.model.signed)return;
    $('jsaReadDialog').close();
    const review=jsaReview,generation=jsaReviewGeneration;
    JGCSafetySignature.open({attendeeName:review.model.identity.name,readOnlyName:true,recordLabel:review.doc.title+' · '+review.model.identity.company,onSubmit:async signature=>{
      if(generation!==jsaReviewGeneration)throw new Error('Open the JSA again before signing.');
      const result=await rpc('sign_job_board_jsa',{p_token:state.token,p_visit_token:state.visit?.token||null,p_document_id:review.doc.id,p_confirm_read:$('jsaSignOnRead').checked,p_reviewed_version:review.model.version,p_signature_strokes:signature.strokes,p_signature_width:signature.width,p_signature_height:signature.height});
      if(!result?.ok)throw new Error('Your signature could not be saved.');
      status('jsaSignOnStatus','Signature saved. Your name and company have been added to this JSA.','success');$('jsaSignOnSign').disabled=true;review.model.signed=true;
      void openJsaSignOn(review.doc);return {ok:true};
    }});
  });
  function button(label, action, secondary) { const b = text('button', label, 'jgc-button' + (secondary ? ' jgc-button--secondary' : '')); b.type = 'button'; b.addEventListener('click', action); return b; }
  function renderDocuments(parent, docs, message, review) { parent.replaceChildren(); if (!docs.length) return empty(parent, message); docs.forEach((doc) => parent.append(documentCard(doc, review))); if (window.lucide) window.lucide.createIcons(); }
  function documentCard(doc, review) {
    const card = document.createElement('article'); card.className = 'jgc-record-row board-document'; card.dataset.documentId = doc.id;
    const icon = text('span', '', 'board-document-icon'); icon.setAttribute('aria-hidden', 'true'); const i = document.createElement('i'); i.dataset.lucide = String(doc.mime_type || '').startsWith('image/') ? 'image' : 'file-text'; icon.append(i);
    const detail = document.createElement('div'); detail.append(text('h3', doc.title || doc.file_name || 'Document', 'board-document-title'));
    const meta = text('div', '', 'board-document-meta'); [categoryName(doc.category), dateLabel(doc.report_date), bytes(doc.file_size)].filter(Boolean).forEach((value) => meta.append(text('span', value)));
    if (doc.visibility === 'restricted' || doc.category === 'accident-incident') meta.append(text('span', 'Restricted', 'jgc-badge jgc-badge--warning'));
    if (review) meta.append(text('span', 'Pending review', 'jgc-badge jgc-badge--warning'));
    if (doc.source_type) meta.append(text('span', doc.source_type === 'policies' ? 'Company policy' : 'Portal form', 'jgc-badge jgc-badge--info'));
    detail.append(meta); if (doc.notes) detail.append(text('p', doc.notes, 'board-document-notes'));
    const actions = text('div', '', 'board-document-actions');
    actions.append(button('View', (event) => viewDocument(doc, event.currentTarget), true), button('Download', (event) => downloadDocument(doc, event.currentTarget), true));
    if (!review && doc.category === 'jsa') actions.append(button('Sign on to JSA',()=>openJsaSignOn(doc),true));
    if (!review) actions.append(button('Email PDF', (event) => emailDocument(doc, event.currentTarget), true));
    card.append(icon, detail, actions);
    if (state.manage && state.board.can_manage && !doc.automatic) card.append(reviewEditor(doc, review));
    return card;
  }
  function reviewEditor(doc, review) {
    const details = document.createElement('details'); details.className = 'board-document-edit'; if (review) details.open = true;
    details.append(text('summary', review ? 'Review & publish' : 'Edit document'));
    const form = document.createElement('form'); const grid = text('div', '', 'jgc-form-grid');
    const fields = {};
    function field(label, tag, type, value, full) { const wrap = text('div', '', 'jgc-field' + (full ? ' jgc-field--full' : '')); const input = document.createElement(tag); const id = 'edit-' + doc.id + '-' + type; input.id = id; if (tag === 'input') input.type = type; input.className = tag === 'select' ? 'jgc-select' : tag === 'textarea' ? 'jgc-textarea' : 'jgc-input'; const l = text('label', label, 'jgc-label'); l.htmlFor = id; input.value = value || ''; wrap.append(l, input); grid.append(wrap); return input; }
    fields.title = field('Title', 'input', 'text', doc.title, true); fields.title.maxLength = 200; fields.title.required = true;
    fields.category = field('Document type', 'select', 'category', ''); categories(fields.category, doc.category);
    fields.date = field('Report date', 'input', 'date', String(doc.report_date || '').slice(0, 10)); fields.date.required = true;
    fields.notes = field('Notes', 'textarea', 'notes', doc.notes, true); fields.notes.maxLength = 2000; fields.notes.rows = 2;
    fields.visibility = field('Published access', 'select', 'visibility', ''); [['public', 'Visitors signed in to this board'], ['restricted', 'Authorized Portal accounts only']].forEach(([value, label]) => { const o = text('option', label); o.value = value; fields.visibility.append(o); }); fields.visibility.value = doc.visibility || 'restricted';
    const enforce = () => { if (fields.category.value === 'accident-incident') { fields.visibility.value = 'restricted'; fields.visibility.disabled = true; } else fields.visibility.disabled = false; }; fields.category.addEventListener('change', enforce); enforce();
    const feedback = text('p', '', 'board-form-status'); feedback.setAttribute('role', 'status'); feedback.setAttribute('aria-live', 'polite');
    const controls = text('div', '', 'board-actions'); const save = button(review ? 'Save details' : 'Save changes', () => perform('save'), true); const publish = button(review ? 'Publish document' : 'Update published access', () => perform('published')); const archive = button('Archive', () => perform('archived'), true); controls.append(save, publish, archive);
    form.append(grid, feedback, controls); form.addEventListener('submit', (e) => { e.preventDefault(); perform('save'); }); details.append(form);
    let running = false;
    async function perform(action) {
      if (running || !form.reportValidity()) return;
      running = true; controls.querySelectorAll('button').forEach((b) => b.disabled = true); feedback.textContent = 'Saving…';
      try {
        await rpc('update_job_board_document', { p_document_id: doc.id, p_title: fields.title.value.trim(), p_report_date: fields.date.value, p_category: fields.category.value, p_notes: fields.notes.value.trim() });
        if (action !== 'save') await rpc('review_job_board_document', { p_document_id: doc.id, p_status: action, p_visibility: fields.category.value === 'accident-incident' ? 'restricted' : fields.visibility.value });
        notice(action === 'published' ? 'Document published.' : action === 'archived' ? 'Document archived.' : 'Document details saved.'); invalidateLogs(); await loadBoard();
      } catch (e) { feedback.textContent = errorMessage(e); feedback.dataset.state = 'error'; }
      finally { running = false; controls.querySelectorAll('button').forEach((b) => b.disabled = false); }
    }
    return details;
  }
  async function documentFile(doc) {
    const session = await state.client.auth.getSession(); const token = session.data && session.data.session && session.data.session.access_token;
    const base = typeof JGC_SUPABASE_URL !== 'undefined' ? JGC_SUPABASE_URL : state.client.supabaseUrl;
    const key = typeof JGC_SUPABASE_KEY !== 'undefined' ? JGC_SUPABASE_KEY : state.client.supabaseKey;
    if (!base || !key) throw new Error('The document service is unavailable.');
    const headers = { 'Content-Type': 'application/json', apikey: key }; if (token) headers.Authorization = 'Bearer ' + token;
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 45000);
    try {
      const response = await fetch(base.replace(/\/$/, '') + '/functions/v1/jgc-job-board-document', { method: 'POST', headers, body: JSON.stringify({ boardToken: state.token, visitToken: state.visit && state.visit.token || null, documentId: doc.id }), signal: controller.signal, referrerPolicy: 'no-referrer', cache: 'no-store' });
      const data = await response.json(); if (!response.ok || data.error) throw new Error(data.error || 'The document could not be opened. Sign in if it requires restricted access.');
      let blob;
      if (data.sourcePayload) { if (!window.JGCJobBoardPdf || !window.JGCJobBoardPdf.create) throw new Error('The report exporter is unavailable. Refresh and try again.'); if(doc.category==='jsa'){const model=await rpc('get_job_board_jsa',{p_token:state.token,p_visit_token:state.visit?.token||null,p_document_id:doc.id});data.sourcePayload.acknowledgements=model.acknowledgements;} blob = await window.JGCJobBoardPdf.create(data.sourcePayload); }
      else if (data.pdfBase64) { const raw = atob(data.pdfBase64); const bytes = Uint8Array.from(raw, (char) => char.charCodeAt(0)); blob = new Blob([bytes], { type: data.mimeType || 'application/pdf' }); }
      else {
        if (!data.url) throw new Error('The document service did not return a file.');
        const u = new URL(data.url); const allowed = new URL(base).hostname;
        if (u.protocol !== 'https:' || (u.hostname !== allowed && u.hostname !== allowed.replace('.supabase.co', '.storage.supabase.co'))) throw new Error('The file location could not be verified.');
        const file = await fetch(u.href, { signal: controller.signal, referrerPolicy: 'no-referrer', cache: 'no-store' }); if (!file.ok) throw new Error('The file download failed. Please try again.'); blob = await file.blob();
      }
      return { blob, fileName: data.fileName || doc.file_name || 'document.pdf', mimeType: data.mimeType || blob.type || doc.mime_type };
    } catch (e) { if (e.name === 'AbortError') throw new Error('This download is taking too long. Check your connection and try again.'); throw e; }
    finally { clearTimeout(timeout); }
  }
  async function logActivity(action, documentId) { return rpc('log_job_board_activity', { p_token: state.token, p_visit_token: state.visit && state.visit.token || null, p_action: action, p_document_id: documentId }); }
  function saveBlob(blob, name) { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; a.rel = 'noopener'; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000); }
  async function downloadDocument(doc, control) { busy(control, true); try { const file = await documentFile(doc); saveBlob(file.blob, file.fileName); notice('Download started: ' + file.fileName); } catch (e) { notice(errorMessage(e), 'error'); } finally { busy(control, false); } }
  function fitDesktopPreview(){
    if(!hosted||!window.frameElement)return;
    const bounds=window.frameElement.getBoundingClientRect();let safeTop=12;
    window.parent.document.querySelectorAll('.topbar,.job-tabs').forEach(element=>{const rect=element.getBoundingClientRect(),style=window.parent.getComputedStyle(element);if(['sticky','fixed'].includes(style.position)&&rect.bottom>0&&rect.top<=parseFloat(style.top||'0')+2)safeTop=Math.max(safeTop,rect.bottom+12);});
    const height=Math.max(180,Math.min(window.parent.innerHeight-safeTop-12,bounds.bottom-Math.max(safeTop,bounds.top)-12)),dialog=$('documentPreview');
    Object.assign(dialog.style,{position:'fixed',top:Math.max(12,safeTop-bounds.top)+'px',bottom:'auto',left:'0',right:'0',margin:'0 auto',maxHeight:height+'px'});$('previewBody').style.maxHeight=Math.max(90,height-100)+'px';

  }
  if(hosted){const update=()=>{if($('documentPreview').open)fitDesktopPreview();};window.parent.addEventListener('scroll',update,{passive:true});window.parent.addEventListener('resize',update);window.addEventListener('pagehide',()=>{window.parent.removeEventListener('scroll',update);window.parent.removeEventListener('resize',update);});}
  async function viewDocument(doc, control) {
    if (window.matchMedia('(max-width: 780px), (pointer: coarse)').matches) {
      // Reserve the tab during the click so mobile browsers allow the full PDF viewer.
      const viewer = window.open('about:blank', '_blank');
      if (!viewer) { notice('Allow a new tab to open this document, then tap View again.', 'warning'); return; }
      viewer.opener = null;
      viewer.document.title = doc.title || 'Opening document';
      const loading = viewer.document.createElement('p');
      loading.textContent = 'Opening document…';
      viewer.document.body.append(loading);
      busy(control, true);
      try {
        const file = await documentFile(doc);
        if (viewer.closed) return;
        const blob = file.blob.type === file.mimeType ? file.blob : new Blob([file.blob], { type: file.mimeType || 'application/pdf' });
        const url = URL.createObjectURL(blob);
        viewer.location.replace(url);
        setTimeout(() => URL.revokeObjectURL(url), 300000);
      } catch (error) {
        if (!viewer.closed) viewer.close();
        notice(errorMessage(error), 'error');
      } finally { busy(control, false); }
      return;
    }
    busy(control, true); const version = ++state.previewGeneration; $('previewTitle').textContent = doc.title || 'Document'; $('previewBody').replaceChildren(); status('previewStatus', 'Opening document…'); fitDesktopPreview(); if (!$('documentPreview').open) $('documentPreview').showModal();
    try { const file=await documentFile(doc);if(version!==state.previewGeneration)return;if(!window.JGCJsaPreview)await loadJgcScriptOnce('job-board-jsa-preview.js?v=2');await JGCJsaPreview.render($('previewBody'),file,()=>version===state.previewGeneration&&$('documentPreview').open);if(version===state.previewGeneration){fitDesktopPreview();status('previewStatus','');} }
    catch (e) { if (version === state.previewGeneration) status('previewStatus', errorMessage(e), 'error'); } finally { busy(control, false); }
  }
  let emailFile = null, emailSubject = '', emailVersion = 0;
  async function emailDocument(doc, control) {
    const version = ++emailVersion; emailFile = null;
    $('emailPdfTitle').textContent = doc.title || 'Email PDF'; $('emailPdfReady').hidden = true;
    status('emailPdfStatus', 'Preparing PDF…'); $('emailPdfDialog').showModal(); busy(control,true);
    try {
      const source = await documentFile(doc);
      const file = await JGCJobBoardEmail.pdf(source.blob,source.fileName,source.mimeType);
      if (version !== emailVersion) return;
      emailFile = file; emailSubject = [state.board.job_number && 'Job '+state.board.job_number,doc.title].filter(Boolean).join(' · ');
      $('emailPdfShare').hidden = !navigator.canShare?.({files:[file]});
      $('emailPdfReady').hidden = false; status('emailPdfStatus','PDF ready: '+file.name);
    } catch(e) { if (version === emailVersion) status('emailPdfStatus',errorMessage(e),'error'); }
    finally { busy(control,false); }
  }
  function highlightDocument() { const cards = Array.from(document.querySelectorAll('[data-document-id]')); const card = cards.find((e) => e.dataset.documentId === state.highlighted); if (!card) return; for (let parent = card.parentElement; parent; parent = parent.parentElement) if (parent.tagName === 'DETAILS') parent.open = true; card.classList.add('is-highlighted'); card.tabIndex = -1; requestAnimationFrame(() => { card.scrollIntoView({ block: 'center' }); card.focus({ preventScroll: true }); }); }
  async function renderManager() {
    const board = state.board, token = state.token;
    $('boardEnabled').checked = !!board.enabled; $('boardEnabledBadge').textContent = board.enabled ? 'Access enabled' : 'Access disabled'; $('boardEnabledBadge').className = 'jgc-badge ' + (board.enabled ? 'jgc-badge--success' : 'jgc-badge--warning');
    $('boardOpenLink').href = boardLink(); $('posterJob').textContent = [board.job_number && 'Job ' + board.job_number, board.job_name].filter(Boolean).join(' · '); $('posterAddress').textContent = board.address || '';
    $('boardQr').removeAttribute('src'); $('posterQr').removeAttribute('src'); status('boardQrStatus', 'Generating QR code…'); ['boardPrint', 'boardQrDownload'].forEach((id) => $(id).disabled = true);
    try { if (!window.QRCode || !window.QRCode.toDataURL) throw new Error('QR generator unavailable. Refresh and try again.'); const url = await window.QRCode.toDataURL(boardLink(), { width: 640, margin: 4, errorCorrectionLevel: 'M' }); if (token !== state.token) return; $('boardQr').src = url; $('posterQr').src = url; status('boardQrStatus', 'Scan to open this job’s board.'); ['boardPrint', 'boardQrDownload'].forEach((id) => $(id).disabled = false); }
    catch (e) { status('boardQrStatus', errorMessage(e), 'error'); }
  }
  async function configureBoard(rotate) { const control = rotate ? $('boardRotateYes') : $('boardSaveEnabled'); busy(control, true); try { const updated = await rpc('configure_job_board', { p_board_id: state.board.id, p_enabled: $('boardEnabled').checked, p_rotate_token: !!rotate }); if (updated && updated.token) state.token = updated.token; $('boardRotateConfirm').hidden = true; notice(rotate ? 'QR link replaced. Print a new poster for the site.' : 'Board access updated.'); invalidateLogs(); await loadBoard(); } catch (e) { notice(errorMessage(e), 'error'); } finally { busy(control, false); } }
  function renderViewers() {
    const list = $('viewerList'), viewers = state.board.viewers || []; list.replaceChildren(); if (!viewers.length) return empty(list, 'No additional Portal accounts have been granted access.');
    viewers.forEach((viewer) => { const row = text('div', '', 'jgc-record-row board-viewer'); row.append(text('span', viewer.email), button('Remove access', async (e) => { const b = e.currentTarget; busy(b, true); try { await rpc('revoke_job_board_viewer', { p_board_id: state.board.id, p_viewer_id: viewer.id }); notice('Restricted access removed.'); await loadBoard(); } catch (error) { notice(errorMessage(error), 'error'); } finally { busy(b, false); } }, true)); list.append(row); });
  }
  function renderCreateForms() { const list = $('createFormLinks'); list.replaceChildren(); FORMS.forEach(([file, label]) => { const u = new URL(file, location.href); u.searchParams.set('jobBoard', '1'); u.hash = new URLSearchParams({ board: state.token, visit: state.visit && state.visit.token || '' }).toString(); const a = text('a', label, 'jgc-button jgc-button--secondary'); a.href = u.href; list.append(a); }); }
  function mime(file) { if (TYPES.includes(file.type)) return file.type; if (file.type) return ''; const extension = file.name.toLowerCase().split('.').pop(); return ({ pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' })[extension] || ''; }
  function showSelectedFiles() { $('uploadFileList').replaceChildren(); Array.from($('uploadFiles').files || []).forEach((file) => { const row = text('div', '', 'board-upload-file'); row.append(text('span', file.name), text('span', bytes(file.size))); $('uploadFileList').append(row); }); }
  async function uploadDocuments(event) {
    event.preventDefault(); if (state.uploadBusy || !state.board || !state.board.can_upload || !$('uploadForm').reportValidity()) return;
    const files = Array.from($('uploadFiles').files || []); if (!files.length) return;
    const invalid = files.find((file) => !mime(file) || !file.size || file.size > 20 * 1024 * 1024); if (invalid) return status('uploadStatus', invalid.name + ': choose a PDF, JPG, PNG or WebP file up to 20 MB.', 'error');
    state.uploadBusy = true; busy($('uploadSubmit'), true, 'Uploading…'); $('uploadProgress').hidden = false;
    Array.from($('uploadForm').elements).forEach((e) => { if (e.id !== 'uploadSubmit') e.disabled = true; });
    let completed = 0;
    try {
      for (const file of files) {
        let attempt = state.uploads.get(file);
        if (attempt && !attempt.finalized && !attempt.uploaded) {
          // A lost response may conceal an upload already committed by Storage.
          // Finalization validates the reserved path, size and MIME before accepting it.
          try { await rpc('finalize_job_board_upload', { p_document_id: attempt.id }); attempt.finalized = true; attempt.uploaded = true; } catch { /* No complete object yet; retry the original upload. */ }
        }
        if (!attempt) { const result = await rpc('begin_job_board_upload', { p_board_id: state.board.id, p_category: $('uploadCategory').value, p_title: (files.length > 1 ? $('uploadTitle').value.trim() + ' · ' + file.name : $('uploadTitle').value.trim()).slice(0, 200), p_report_date: $('uploadDate').value, p_file_name: file.name, p_mime_type: mime(file), p_file_size: file.size, p_notes: $('uploadNotes').value.trim() }); if (!result || !result.id || !result.object_path) throw new Error('The upload destination was not created. Please retry.'); attempt = { id: result.id, path: result.object_path, uploaded: false, finalized: false }; state.uploads.set(file, attempt); }
        if (!attempt.finalized) {
          status('uploadStatus', 'Uploading ' + (completed + 1) + ' of ' + files.length + ': ' + file.name);
          if (!attempt.uploaded) { const result = await uploadJgcFile({ client: state.client, bucket: 'job-board-files', path: attempt.path, file, contentType: mime(file), maxBytes: 20 * 1024 * 1024, types: TYPES, upsert: false, onProgress: (loaded, total, percentage) => { $('uploadProgress').value = Number.isFinite(percentage) ? percentage : total ? loaded / total * 100 : 0; } }); if (result.error) throw result.error; attempt.uploaded = true; }
          await rpc('finalize_job_board_upload', { p_document_id: attempt.id }); attempt.finalized = true;
        }
        completed += 1;
      }
      $('uploadForm').reset(); $('uploadDate').value = dateToday(); $('uploadFileList').replaceChildren(); state.uploads.clear(); status('uploadStatus', completed + (completed === 1 ? ' file uploaded' : ' files uploaded') + ' for office review.', 'success'); notice('Upload received. The office must review it before it appears on the board.'); invalidateLogs(); await loadBoard();
    } catch (error) { status('uploadStatus', errorMessage(error) + (completed ? ' ' + completed + ' file(s) completed. Retry continues the remaining files.' : ' Your selected files are kept; retry when your connection improves.'), 'error'); }
    finally { state.uploadBusy = false; Array.from($('uploadForm').elements).forEach((e) => e.disabled = false); busy($('uploadSubmit'), false, 'Upload for review'); $('uploadProgress').hidden = true; }
  }
  function invalidateLogs(){Object.values(state.logs).forEach(log=>{log.loaded=false;});}
  function activityElement(kind,suffix){return $(kind==='site'?'siteActivity'+suffix:'activity'+suffix);}
  async function loadActivity(kind,append) {
    const log=state.logs[kind];if(log.busy||!state.board?.can_manage)return;
    const boardId=state.board.id,generation=state.generation;log.busy=true;busy(activityElement(kind,'Refresh'),true);busy(activityElement(kind,'More'),true);status(activityElement(kind,'Status').id,'Loading sign-ins…');
    try {
      const result=await rpc('get_job_board_signins',{p_board_id:boardId,p_kind:kind,p_before:append?log.before:null,p_limit:50});
      if(state.board?.id!==boardId||state.generation!==generation)return;
      const events=(Array.isArray(result)?result:result?.events||[]).filter(e=>e.action===(kind==='site'?'site-signin':'visit'));
      log.events=append?log.events.concat(events):events;log.before=result&&Object.prototype.hasOwnProperty.call(result,'next_before')?result.next_before:null;log.loaded=true;activityElement(kind,'More').hidden=!log.before;renderActivity(kind);status(activityElement(kind,'Status').id,log.events.length+' sign-ins shown. Times are in Toronto.');
    }catch(e){status(activityElement(kind,'Status').id,errorMessage(e),'error');}finally{log.busy=false;busy(activityElement(kind,'Refresh'),false);busy(activityElement(kind,'More'),false);}
  }
  function renderActivity(kind){const list=activityElement(kind,'List');list.replaceChildren();const events=state.logs[kind].events;if(!events.length)return empty(list,'No sign-ins have been recorded yet.');events.forEach(event=>{const row=text('div','','jgc-record-row board-activity-row'),detail=text('div','');detail.append(text('strong',event.actor_name||event.actor_email||'Portal account'),text('p',[event.actor_company,event.actor_email].filter(Boolean).join(' · '),'board-activity-details'));detail.append(text('p',kind==='site'?'Site Sign in (self-reported)':event.identity_type==='visitor'?'Visitor Login (self-reported)':'Staff Login','board-activity-details'));if(event.reason)detail.append(text('p','Reason: '+event.reason,'board-activity-details'));row.append(text('time',timeLabel(event.created_at),'board-help'),detail);list.append(row);});}
  let sitePdfBusy=false;
  async function downloadSiteSignins(){
    if(sitePdfBusy||!state.board?.can_manage)return;sitePdfBusy=true;const control=$('siteActivityPdf'),board=state.board,generation=state.generation;busy(control,true);status('siteActivityStatus','Preparing all site sign-ins…');
    try {
      const events=[],cursors=new Set();let before=null;
      do{const result=await rpc('get_job_board_signins',{p_board_id:board.id,p_kind:'site',p_before:before,p_limit:100});if(state.generation!==generation||state.board?.id!==board.id)throw new Error('The job changed. Open the site sign-ins again.');events.push(...(result?.events||[]).filter(e=>e.action==='site-signin'));before=result?.next_before||null;if(before){if(cursors.has(before))throw new Error('The sign-in list could not be completed. Please try again.');cursors.add(before);}}while(before);
      await loadJgcScriptOnce('job-board-site-signins-pdf.js?v=1','JGCSiteSigninsPdf');const blob=await JGCSiteSigninsPdf.create(board,events);if(state.generation!==generation||state.board?.id!==board.id)throw new Error('The job changed. Open the site sign-ins again.');saveBlob(blob,'JGC-Job-'+(board.job_number||'Board')+'-Site-Sign-ins.pdf');status('siteActivityStatus','PDF downloaded with '+events.length+' site sign-ins.');
    }catch(e){status('siteActivityStatus',errorMessage(e),'error');}finally{sitePdfBusy=false;busy(control,false);}
  }
  async function loadSources() { if (!state.board || !state.board.can_manage) return; busy($('importRefresh'), true); status('importStatus', 'Loading available reports…'); try { const data = await rpc('list_job_board_sources', { p_board_id: state.board.id }); const sources = (Array.isArray(data) ? data : data && data.sources || []).filter((source) => !(source.source_type === 'policies' && (state.board.documents || []).some((doc) => doc.automatic && doc.source_type === 'policies' && String(doc.source_id) === String(source.source_id)))); state.sourcesLoaded = true; $('importList').replaceChildren(); if (!sources.length) empty($('importList'), 'No unattached matching reports or company policies are available.'); sources.forEach((source) => { const row = text('div', '', 'jgc-record-row board-viewer'); const desc = document.createElement('div'); desc.append(text('strong', source.title || categoryName(source.category)), text('p', [categoryName(source.category), dateLabel(source.report_date), source.match === 'company-policy' ? 'Company policy' : 'Job number match'].join(' · '), 'board-help')); row.append(desc, button(source.source_type === 'policies' ? 'Attach for review' : 'Attach report', async (e) => { const b = e.currentTarget; busy(b, true); try { await rpc('attach_job_board_report', { p_token: state.token, p_visit_token: state.visit && state.visit.token || null, p_source_type: source.source_type, p_source_id: source.source_id }); notice(source.source_type === 'policies' ? 'Company policy attached for office review.' : 'Report attached and published on this Job Board.'); invalidateLogs(); await loadBoard(); await loadSources(); } catch (error) { notice(errorMessage(error), 'error'); } finally { busy(b, false); } }, true)); $('importList').append(row); }); status('importStatus', sources.length + ' available items.'); } catch (e) { status('importStatus', errorMessage(e), 'error'); } finally { busy($('importRefresh'), false); } }
  function selectTab(id) { document.querySelectorAll('.board-tabs [role="tab"]').forEach((tab) => { const chosen = tab.dataset.panel === id; tab.classList.toggle('active', chosen); tab.setAttribute('aria-selected', String(chosen)); tab.tabIndex = chosen ? 0 : -1; $(tab.dataset.panel).hidden = !chosen; }); }
  function chooseLogin(id) { ['loginOptions','visitorGate','staffGate','siteGate'].forEach(key => $(key).hidden = key !== id); }
  function openStaff() { chooseLogin('staffGate'); $('staffEmail').focus(); $('staffGate').scrollIntoView({ block: 'center' }); }
  async function visitorSignIn(e) { e.preventDefault(); busy($('visitorSubmit'), true); status('visitorStatus', 'Signing in…'); try { await registerVisit({ p_name: $('visitorName').value.trim(), p_company: $('visitorCompany').value.trim(), p_email: $('visitorEmail').value.trim() }); await loadBoard(); if ($('visitorGate').hidden) status('visitorStatus', ''); else status('visitorStatus', 'Site sign-in expired. Please sign in again.', 'error'); } catch (error) { status('visitorStatus', errorMessage(error), 'error'); } finally { busy($('visitorSubmit'), false); } }
  async function staffSignIn(e) {
    e.preventDefault(); busy($('staffSubmit'), true); status('staffStatus', 'Signing in…');
    try {
      if (!state.client) throw new Error('The Portal is unavailable. Refresh and try again.');
      if (typeof setJgcAuthPersistencePreference === 'function') setJgcAuthPersistencePreference(false);
      const result = await state.client.auth.signInWithPassword({ email: $('staffEmail').value.trim(), password: $('staffPassword').value }); if (result.error) throw result.error;
      const verified = await state.client.auth.getUser(); if (verified.error || !verified.data.user) throw new Error('Your sign-in could not be verified. Try again.');
      const profileResult = await state.client.from('profiles').select('display_name,worker_key,role,account_status,email').eq('id', verified.data.user.id).maybeSingle();
      if (profileResult.error || !profileResult.data) throw new Error('Your Portal profile could not be loaded. Please try again or ask the office.');
      const profile = profileResult.data;
      if (!['approved', 'limited'].includes(profile.account_status)) { await state.client.auth.signOut(); if (typeof clearJgcSession === 'function') clearJgcSession(); throw new Error(profile.account_status === 'inactive' ? 'This account is inactive. Please contact the office.' : 'Your Portal account is waiting for approval.'); }
      // These canonical keys support the existing Portal forms; all board permissions come from RPCs.
      localStorage.setItem('currentWorker', profile.worker_key || ''); localStorage.setItem('currentWorkerDisplay', profile.display_name || '');
      localStorage.setItem('currentUserEmail', profile.email || verified.data.user.email || ''); localStorage.setItem('currentUserRole', profile.role || 'worker');
      localStorage.setItem('currentAccountStatus', profile.account_status); localStorage.setItem('jgcStayLoggedIn', 'false'); sessionStorage.setItem('jgcActiveSession', 'true');
      state.user = verified.data.user; clearVisit(); $('staffPassword').value = ''; $('staffGate').hidden = true; status('staffStatus', ''); await loadBoard();
    } catch (error) { status('staffStatus', errorMessage(error), 'error'); }
    finally { busy($('staffSubmit'), false); }
  }
  categories($('uploadCategory'), 'jsa'); $('uploadDate').value = dateToday();
  let contactsGeneration = 0;
  async function showContacts() {
    const generation = ++contactsGeneration;
    if (!$('contactsDialog').open) $('contactsDialog').showModal();
    $('contactsList').replaceChildren(); $('contactsRetry').hidden = true; status('contactsStatus','Loading contacts…');
    try {
      const contacts = await rpc('get_job_board_contacts',{p_token:state.token,p_visit_token:state.visit?.token || null});
      if (generation !== contactsGeneration || !$('contactsDialog').open) return;
      status('contactsStatus','');
      if (!Array.isArray(contacts) || !contacts.length) return empty($('contactsList'),'No contacts are currently listed. Please contact the site supervisor.');
      contacts.forEach(contact => {
        const card = text('article','','jgc-panel board-contact'); card.append(text('h3',contact.name,'jgc-section-title'));
        if (contact.role) card.append(text('p',contact.role,'board-help'));
        const links = text('div','','board-actions');
        if (contact.phone) { const phone = text('a',contact.phone,'jgc-button jgc-button--secondary'); phone.href = 'tel:'+String(contact.phone).replace(/[^+0-9*,;#]/g,''); links.append(phone); }
        if (contact.email) { const email = text('a',contact.email,'jgc-button jgc-button--secondary'); email.href = 'mailto:'+encodeURIComponent(contact.email); links.append(email); }
        card.append(links); $('contactsList').append(card);
      });
    } catch(error) { if (generation === contactsGeneration) { status('contactsStatus',errorMessage(error),'error'); $('contactsRetry').hidden = false; } }
  }
  $('boardContacts').addEventListener('click',showContacts); $('contactsRetry').addEventListener('click',showContacts);
  $('contactsClose').addEventListener('click',()=>$('contactsDialog').close());
  $('contactsDialog').addEventListener('close',()=>{contactsGeneration++; $('contactsList').replaceChildren();});
  $('boardLogout').addEventListener('click',async()=>{
    const control=$('boardLogout');busy(control,true);
    try{if(state.user){const result=await state.client.auth.signOut({scope:'local'});if(result.error)throw result.error;}clearVisit();state.user=null;state.board=null;state.loggedBoardVisit='';state.generation++;state.previewGeneration++;jsaReviewGeneration++;jsaReview=null;$('jsaSignOnPanel').hidden=true;['documentPreview','contactsDialog','emailPdfDialog','jsaReadDialog'].forEach(id=>{if($(id).open)$(id).close();});['documentSections','activityList','siteActivityList','viewerList','contactsList','jsaSignOnReport','jsaSignOnRoster'].forEach(id=>$(id).replaceChildren());Object.values(state.logs).forEach(log=>{log.events=[];log.loaded=false;log.before=null;});$('boardLogout').hidden=true;syncBoardTheme();await loadBoard();notice('You have logged out of this Job Board.');}catch(error){notice(errorMessage(error),'error');}finally{busy(control,false);}
  });
  $('boardRefresh').addEventListener('click', loadBoard); $('boardRetry').addEventListener('click', loadBoard);
  $('boardSignIn').addEventListener('click', openStaff); $('uploadSignInButton').addEventListener('click', openStaff); $('staffCancel').addEventListener('click', () => chooseLogin(state.board?.requires_visitor_signin ? 'loginOptions' : ''));
  $('visitorLogin').addEventListener('click',()=>chooseLogin('visitorGate')); $('staffLogin').addEventListener('click',openStaff); $('siteLogin').addEventListener('click',()=>chooseLogin('siteGate')); $('boardSiteSignIn').addEventListener('click',()=>{chooseLogin('siteGate'); $('siteName').focus(); $('siteGate').scrollIntoView({block:'center'});});
  ['visitorCancel','siteCancel'].forEach(id => $(id).addEventListener('click',()=>chooseLogin(state.board?.requires_visitor_signin ? 'loginOptions' : '')));
  let siteSubmission = null;
  $('siteForm').addEventListener('input',()=>siteSubmission = null);
  $('siteForm').addEventListener('submit',async e => {
    e.preventDefault(); if ($('siteSubmit').disabled) return; busy($('siteSubmit'),true); status('siteStatus','Recording sign-in…');
    siteSubmission ||= crypto.randomUUID();
    try { const result = await rpc('record_job_board_site_signin',{p_token:state.token,p_name:$('siteName').value.trim(),p_company:$('siteCompany').value.trim(),p_reason:$('siteReason').value.trim(),p_submission_id:siteSubmission});
      status('siteStatus','Site sign-in recorded: '+timeLabel(result.recorded_at),'success'); $('siteForm').reset(); siteSubmission = null; invalidateLogs();
    } catch(error) { status('siteStatus',errorMessage(error),'error'); } finally { busy($('siteSubmit'),false); }
  });
  $('visitorForm').addEventListener('submit', visitorSignIn); $('staffForm').addEventListener('submit', staffSignIn);
  function isStaffBoard(){return !!state.user&&!!(state.manage&&state.board?.can_manage||state.board?.can_register_as_staff);}
  function syncBoardTheme(){if(hosted)return;const theme=isStaffBoard()?getStoredJgcThemePreference(state.user.id):'light';if(document.documentElement.dataset.jgcTheme!==theme)applyJgcTheme(theme);}
  window.addEventListener('jgc-theme-change',()=>{if(!hosted&&!isStaffBoard()&&document.documentElement.dataset.jgcTheme!=='light')applyJgcTheme('light');});
  let parentRefreshBusy = false;
  window.addEventListener('message', async event => {
    if (!hosted || event.origin !== location.origin || event.source !== window.parent || event.data?.type !== 'jgc-job-board-refresh' || event.data.jobId !== state.job || !state.board?.can_manage || parentRefreshBusy) return;
    parentRefreshBusy = true;
    const generation = state.generation, boardId = state.board.id;
    try {
      const updated = await rpc('get_or_create_job_board', { p_job_id: state.job });
      if (generation !== state.generation || updated?.id !== boardId || !updated.can_manage) return;
      state.board = updated;
      // Only document lists need updating. Keep office review inputs and selected files.
      renderLibrary();
    } catch (error) { if (generation === state.generation) notice('The plan was published. Refresh the board to load its latest documents. ' + errorMessage(error), 'error'); }
    finally { parentRefreshBusy = false; }
  });
  window.addEventListener('storage',event=>{if(event.key?.startsWith('jgcPortalTheme'))syncBoardTheme();});syncBoardTheme();
  document.querySelectorAll('.board-tabs [role="tab"]').forEach((tab) => { tab.addEventListener('click', () => selectTab(tab.dataset.panel)); tab.addEventListener('keydown', (e) => { if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return; e.preventDefault(); const tabs = Array.from(document.querySelectorAll('.board-tabs [role="tab"]')).filter((t) => !t.hidden); const index = tabs.indexOf(tab); const next = e.key === 'Home' ? tabs[0] : e.key === 'End' ? tabs[tabs.length - 1] : tabs[(index + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length]; selectTab(next.dataset.panel); next.focus(); }); });
  $('uploadFiles').addEventListener('change', () => { state.uploads.clear(); showSelectedFiles(); status('uploadStatus', ''); }); $('uploadForm').addEventListener('submit', uploadDocuments);
  $('boardPrint').addEventListener('click', () => { if ($('posterQr').src) window.print(); });
  $('boardQrDownload').addEventListener('click', async (e) => { const control = e.currentTarget; busy(control, true); try { const response = await fetch($('boardQr').src); saveBlob(await response.blob(), 'JGC-Job-' + (state.board.job_number || 'Board') + '-QR.png'); } catch (error) { notice(errorMessage(error), 'error'); } finally { busy(control, false); } });
  $('boardCopyLink').addEventListener('click', async () => { try { await navigator.clipboard.writeText(boardLink()); notice('Job Board link copied.'); } catch (_) { notice('Copy is unavailable in this browser. Open board, then copy its address.', 'warning'); } });
  $('boardSaveEnabled').addEventListener('click', () => configureBoard(false)); $('boardRotate').addEventListener('click', () => $('boardRotateConfirm').hidden = false); $('boardRotateNo').addEventListener('click', () => $('boardRotateConfirm').hidden = true); $('boardRotateYes').addEventListener('click', () => configureBoard(true));
  $('viewerForm').addEventListener('submit', async (e) => { e.preventDefault(); busy($('viewerSubmit'), true); try { await rpc('grant_job_board_viewer', { p_board_id: state.board.id, p_email: $('viewerEmail').value.trim() }); $('viewerForm').reset(); notice('Restricted report access granted.'); await loadBoard(); } catch (error) { notice(errorMessage(error), 'error'); } finally { busy($('viewerSubmit'), false); } });
  for(const kind of ['portal','site']){const section=$(kind==='portal'?'boardActivity':'boardSiteActivity');section.addEventListener('toggle',()=>{if(section.open&&!state.logs[kind].loaded)void loadActivity(kind,false);});activityElement(kind,'Refresh').addEventListener('click',()=>loadActivity(kind,false));activityElement(kind,'More').addEventListener('click',()=>loadActivity(kind,true));}
  $('siteActivityPdf').addEventListener('click',downloadSiteSignins);
  $('boardImport').addEventListener('toggle', () => { if ($('boardImport').open && !state.sourcesLoaded) loadSources(); }); $('importRefresh').addEventListener('click', loadSources);
  $('emailPdfClose').addEventListener('click',()=>$('emailPdfDialog').close());
  $('emailPdfDialog').addEventListener('close',()=>{ emailVersion++; emailFile = null; });
  $('emailPdfShare').addEventListener('click',async e => {
    if (!emailFile) return; const control = e.currentTarget; busy(control,true);
    try { await navigator.share({files:[emailFile],title:emailSubject,text:emailSubject}); status('emailPdfStatus','PDF handed to your chosen app.'); }
    catch(error) { if (error.name !== 'AbortError') status('emailPdfStatus','File sharing failed. Download the email draft below.','error'); }
    finally { busy(control,false); }
  });
  $('emailPdfDraft').addEventListener('click',async()=>{ if (emailFile) saveBlob(await JGCJobBoardEmail.draft(emailFile,emailSubject),emailFile.name.replace(/\.pdf$/i,'')+'.eml'); });
  $('emailPdfDownload').addEventListener('click',()=>{ if (emailFile) saveBlob(emailFile,emailFile.name); });
  $('previewClose').addEventListener('click', () => $('documentPreview').close()); $('documentPreview').addEventListener('close', () => { state.previewGeneration++; if (state.previewUrl) URL.revokeObjectURL(state.previewUrl); state.previewUrl = null; $('previewBody').replaceChildren(); });
  if (hosted && window.ResizeObserver) {
    let scheduled = false, previousHeight = 0;
    // Measure content, not the iframe viewport: this also lets shorter tabs shrink.
    const content = $('jobBoardPage');
    const resizeObserver = new ResizeObserver(() => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        const height = Math.ceil(content.getBoundingClientRect().height);
        if (height <= 0) { previousHeight = 0; return; }
        if (height !== previousHeight) {
          previousHeight = height;
          window.parent.postMessage({ type: 'jgc-job-board-height', height }, location.origin);
        }
      });
    });
    resizeObserver.observe(content);
    window.addEventListener('pagehide', (event) => { if (!event.persisted) resizeObserver.disconnect(); });
  }
  selectTab('documentsPanel'); loadBoard();
})();
