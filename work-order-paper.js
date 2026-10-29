(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  let signatures = {};
  let scheduled = false;
  let outputBusy = false;
  const signatureTypes = ['supervisor', 'client'];
  function cleanSignatures(value) {
    const result = {};
    for (const type of signatureTypes) {
      const item = value && value[type];
      if (!item || !String(item.name || '').trim()) continue;
      const image = String(item.image || '');
      if (image.length > 150000 || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(image)) continue;
      result[type] = { name: String(item.name).trim().slice(0, 150), image, signed_at: String(item.signed_at || '').slice(0, 40) };
    }
    return result;
  }
  function setText(element, value) { if (element && element.textContent !== value) element.textContent = value; }
  function refresh() {
    scheduled = false;
    if (!$('woPaperNumber')) return;
    const number = $('woNumber').value || 'Number assigned when you select a job';
    setText($('woPaperNumber'), number);
    setText($('woDockNumber'), $('woNumber').value || 'New Work Order');
    const locked = !$('lockedNotice').hidden;
    setText($('woStatusLabel'), ['submitted','ready_for_submission'].includes($('woStatus').value) ? 'Submitted' : 'Draft');
    setText($('woDockState'), locked ? 'Submitted · locked' : 'Save or submit from anywhere on this page');
    const rows = typeof buildLabourPreviewRows === 'function' ? buildLabourPreviewRows() : [];
    const checks = [
      [Boolean($('woJobNumber').value && $('woDate').value), 'Job & date'],
      [Boolean($('woDescription').value.trim()), 'Description'],
      [Boolean(rows.length && rows.every(row => row.complete)), rows.filter(row => row.complete).length + ' / ' + rows.length + ' labour entries complete']
    ];
    checks.forEach(([complete, label], index) => {
      const element = $('woReadiness').children[index];
      setText(element, label);
      element.dataset.complete = String(complete);
    });
    const wo = typeof workOrders !== 'undefined' && typeof editingWorkOrderId !== 'undefined' ? workOrders.find(item => item.id === editingWorkOrderId) : null;
    const job = typeof getSelectedJob === 'function' ? getSelectedJob() : null;
    setText($('woJobClient'), job?.customer || '');
    setText($('woSupervisor'), wo?.supervisor_name || wo?.created_by_name || (typeof worker !== 'undefined' ? worker.display || worker.key : '') || '');
    for (const type of signatureTypes) {
      const button = $(type + 'SignatureButton');
      const signed = signatures[type];
      const existing = button.querySelector('img');
      if (signed) {
        if (!existing || existing.getAttribute('src') !== signed.image) {
          existing?.remove();
          const img = document.createElement('img'); img.src = signed.image; img.alt = type + ' signature'; button.append(img);
        }
        setText(button.querySelector('span'), signed.name);
      } else { existing?.remove(); setText(button.querySelector('span'), locked ? 'Not signed' : 'Tap to sign · optional'); }
    }
    document.querySelectorAll('.form-section-header').forEach(button => {
      const body = button.nextElementSibling;
      if (body) button.setAttribute('aria-expanded', String(!body.hidden));
    });
    measureDock();
  }
  function schedule() { if (!scheduled) { scheduled = true; requestAnimationFrame(refresh); } }
  function measureDock() {
    const dock = $('woSubmitDock');
    if (!dock) return;
    const nav = document.querySelector('.jgc-mobile-bottom-nav');
    const navHeight = nav && getComputedStyle(nav).display !== 'none' ? nav.getBoundingClientRect().height : 0;
    const root = document.documentElement;
    const setSize = (name, value) => { const text = Math.ceil(value) + 'px'; if(root.style.getPropertyValue(name) !== text) root.style.setProperty(name,text); };
    setSize('--wo-nav-height', navHeight);
    setSize('--wo-dock-height', dock.getBoundingClientRect().height);
  }
  function positionEmbeddedDialog() {
    const dialog = $('woSignatureDialog');
    if (!dialog?.open || !document.body.classList.contains('embedded-work-order')) return;
    try {
      const frame = window.frameElement.getBoundingClientRect();
      dialog.style.margin = '0 auto';
      dialog.style.top = Math.max(16, 90 - frame.top) + 'px';
      dialog.style.maxHeight = Math.max(200, window.parent.innerHeight - 190) + 'px';
    } catch (_) { /* Use the native dialog position outside the same-origin admin editor. */ }
  }
  async function output(mode) {
    if (outputBusy) return;
    // Reserve the window in the user's click so mobile browsers do not block it after saving.
    const targetWindow = mode === 'email' ? null : window.open('', '_blank');
    if (mode !== 'email' && !targetWindow) { setFormStatus('Allow popups to open this Work Order PDF.', true); return; }
    if (targetWindow) targetWindow.document.body.textContent = 'Preparing Work Order…';
    outputBusy = true;
    try {
      const locked = !$('lockedNotice').hidden;
      const id = locked ? editingWorkOrderId : await saveWorkOrder({ silent: true });
      if (!id) { targetWindow?.close(); return; }
      if (mode === 'email') await emailWorkOrderPdf(id);
      else await downloadWorkOrderPdf(id, { targetWindow, preview: mode === 'preview' });
    } catch (error) { targetWindow?.close(); setFormStatus('Could not prepare this Work Order. Your entries are still here. ' + (error.message || ''), true); }
    finally { outputBusy = false; }
  }
  function sign(type) {
    if (!signatureTypes.includes(type) || !$('lockedNotice').hidden) return;
    const dialog = $('woSignatureDialog');
    const canvas = $('woSignatureCanvas');
    const ctx = canvas.getContext('2d');
    const name = $('woSignatureName');
    const error = $('woSignatureError');
    const done = $('woSignatureDone');
    const trigger = document.activeElement;
    let strokes = [], active = null;
    setText($('woSignatureTitle'), (type === 'supervisor' ? 'Supervisor' : 'Client') + ' signature');
    name.value = signatures[type]?.name || (type === 'supervisor' ? $('woSupervisor').textContent : '');
    error.textContent = '';
    $('woSignatureRemove').hidden = !signatures[type];
    const draw = () => {
      ctx.fillStyle = '#fff'; ctx.fillRect(0,0,canvas.width,canvas.height);
      ctx.strokeStyle = '#152c24'; ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (const stroke of strokes) {
        ctx.beginPath(); ctx.moveTo(stroke[0].x,stroke[0].y);
        for (const point of stroke.slice(1)) ctx.lineTo(point.x,point.y);
        ctx.stroke();
      }
      done.disabled = !strokes.some(s => s.length > 1) || !name.value.trim();
    };
    const point = event => { const box = canvas.getBoundingClientRect(); return {x:(event.clientX-box.left)*canvas.width/box.width,y:(event.clientY-box.top)*canvas.height/box.height}; };
    canvas.onpointerdown = event => { if (active !== null || (event.pointerType === 'mouse' && event.button !== 0)) return; event.preventDefault(); active = event.pointerId; canvas.setPointerCapture(active); strokes.push([point(event)]); draw(); };
    canvas.onpointermove = event => { if (event.pointerId !== active) return; event.preventDefault(); strokes[strokes.length-1].push(point(event)); draw(); };
    canvas.onpointerup = canvas.onpointercancel = () => { active = null; };
    name.oninput = draw;
    $('woSignatureClear').onclick = () => { strokes = []; draw(); };
    const close = () => dialog.close();
    $('woSignatureCancel').onclick = close;
    $('woSignatureRemove').onclick = () => { delete signatures[type]; $('workOrderFormCard').dispatchEvent(new Event('input',{bubbles:true})); schedule(); close(); };
    done.onclick = () => {
      if (done.disabled || !$('lockedNotice').hidden) return;
      const image = canvas.toDataURL('image/png');
      if (image.length > 150000) { error.textContent = 'Please clear the box and try a simpler signature.'; return; }
      signatures[type] = { name: name.value.trim().slice(0,150), image, signed_at: new Date().toISOString() };
      $('workOrderFormCard').dispatchEvent(new Event('input',{bubbles:true})); schedule(); close();
    };
    dialog.onclose = () => trigger?.focus();
    dialog.showModal(); positionEmbeddedDialog(); draw(); name.focus();
  }
  window.JgcWorkOrderPaper = {
    refresh: schedule, output, sign,
    getSignatures: () => cleanSignatures(signatures),
    setSignatures: value => { signatures = cleanSignatures(value); schedule(); }
  };
  document.addEventListener('DOMContentLoaded', () => {
    const form = $('workOrderFormCard');
    form.addEventListener('input', schedule); form.addEventListener('change', schedule); form.addEventListener('click', schedule);
    const observer = new MutationObserver(schedule);
    ['labourPreview','digitalPoLinkedList','digitalPoAvailableList','formStatus','lockedNotice'].forEach(id => observer.observe($(id),{subtree:true,childList:true,characterData:true,attributes:id==='lockedNotice'}));
    window.addEventListener('resize', measureDock); window.visualViewport?.addEventListener('resize', measureDock);
    const navObserver = new MutationObserver(measureDock); navObserver.observe(document.body,{childList:true});
    const resizeObserver = new ResizeObserver(measureDock); resizeObserver.observe($('woSubmitDock'));
    // Keep the shared job detail information available without repeating it across the paper.
    const jobField = $('woJobPicker').parentElement;
    const compactJobDetails = () => {
      const card = jobField.querySelector('.jgc-employee-job-details');
      if (!card) return;
      let details = card.closest('.wo-job-details');
      if (!details) {
        details = document.createElement('details'); details.className = 'wo-job-details';
        const summary = document.createElement('summary'); summary.textContent = 'Job details';
        details.append(summary); card.before(details); details.append(card);
      }
      if (details.hidden !== card.hidden) details.hidden = card.hidden;
    };
    new MutationObserver(compactJobDetails).observe(jobField,{subtree:true,childList:true,attributes:true,attributeFilter:['hidden']});
    compactJobDetails();
    // In the admin's full-height editor, anchor the same controls to the parent's visible viewport.
    if (document.body.classList.contains('embedded-work-order') && window.parent !== window) {
      try {
        const update = () => {
          const rect = window.frameElement.getBoundingClientRect();
          const parentNav = window.parent.document.querySelector('.jgc-mobile-bottom-nav');
          const parentNavHeight = parentNav && window.parent.getComputedStyle(parentNav).display !== 'none' ? parentNav.getBoundingClientRect().height : 0;
          const bottom = Math.max(0, rect.bottom - window.parent.innerHeight + parentNavHeight);
          document.documentElement.style.setProperty('--wo-embedded-bottom',bottom+'px');
          positionEmbeddedDialog();
        };
        const frameObserver = new ResizeObserver(update); frameObserver.observe(window.frameElement);
        window.parent.addEventListener('scroll', update, {passive:true}); window.parent.addEventListener('resize', update);
        window.addEventListener('pagehide',()=>{frameObserver.disconnect();window.parent.removeEventListener('scroll',update);window.parent.removeEventListener('resize',update);});
        resizeObserver.observe(document.body); update();
      } catch (_) { /* The standalone action bar still works when parent access is unavailable. */ }
    }
    refresh();
  });
})();
