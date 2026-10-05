(function () {
  'use strict';
  const params = new URLSearchParams(location.search), hash = new URLSearchParams(location.hash.slice(1));
  const token = params.get('jobBoard') === '1' ? hash.get('board') : null;
  const visit = hash.get('visit');
  const pendingKey = 'jgcJobBoardAttachmentsV1';
  let board = null, loading = null, status = null, canonicalWorker = null, actorId = null, retrying = null;
  const photoAttempts = new Map();
  const active = Boolean(token);
  const submissionId = crypto.randomUUID();
  function notice(message, retry) {
    if (!status) {
      status = document.createElement('section'); status.className = 'jgc-notice jgc-stack'; status.setAttribute('aria-live', 'polite');
      status.id = 'jobBoardFormStatus';
      (document.querySelector('main') || document.body).prepend(status);
    }
    status.replaceChildren();
    const text = document.createElement('p'); text.textContent = message; status.append(text);
    if (active) {
      const back = document.createElement('a'); back.className = 'jgc-button jgc-button--secondary'; back.textContent = 'Back to Job Board'; back.href = returnUrl(); status.append(back);
    }
    if (retry) { const button = document.createElement('button'); button.type = 'button'; button.className = 'jgc-button'; button.textContent = 'Retry attaching saved report'; button.onclick = retry; status.append(button); }
  }
  function returnUrl() {
    return active ? 'job-board.html?embedded=1#' + new URLSearchParams({ board: token }).toString() : '';
  }
  function readQueue() {
    try {
      const queue = JSON.parse(localStorage.getItem(pendingKey) || '[]');
      return Array.isArray(queue) ? queue.filter(item => item && typeof item.board_id === 'string' && typeof item.source_id === 'string' && typeof item.source_type === 'string' && typeof item.actor_id === 'string') : [];
    } catch { return []; }
  }
  function saveQueue(queue) { try { localStorage.setItem(pendingKey, JSON.stringify(queue)); } catch { /* Report remains in the saved safety history. */ } }
  function prefill() {
    if (!board) return;
    const display = board.job_number + ' - ' + board.job_name;
    document.querySelectorAll('[data-jgc-project-job]').forEach(field => {
      field.value = display; field.readOnly = true; field.hidden = false;
      const picker = field.closest('.jgc-project-job-picker')?.querySelector('select');
      if (picker) { picker.disabled = true; picker.hidden = true; }
    });
    ['location', 'jsaField2', 'siteAddress'].forEach(id => { const field = document.getElementById(id); if (field && !field.value) field.value = board.address || board.job_name; });
  }
  function propagateLinks() {
    if (!active) return;
    const pages = /^(jsa|toolbox-talks|daily-site-report|incident-report|accident-report|employee-injury-report|hot-work-permit|excavation-permit|confined-space-permit|aerial-lifts|forklift|harness|tele-handler|reports|permits|inspections)\.html(?:\?.*)?$/;
    const makeUrl = href => { const url = new URL(href, location.href); url.searchParams.set('jobBoard', '1'); url.hash = new URLSearchParams({ board: token, visit: visit || '' }).toString(); return url.href; };
    document.querySelectorAll('a[href]').forEach(link => { if (pages.test(link.getAttribute('href'))) link.href = makeUrl(link.getAttribute('href')); });
    document.querySelectorAll('[onclick]').forEach(button => {
      const match = button.getAttribute('onclick').match(/(?:window\.)?location\.href\s*=\s*['"]([^'"]+)['"]/);
      if (match && pages.test(match[1])) { button.removeAttribute('onclick'); button.onclick = () => { location.href = makeUrl(match[1]); }; }
    });
  }
  async function load() {
    if (!active) return null;
    const client = createJgcSupabaseClient();
    if (!navigator.onLine) {
      const session = await client.auth.getSession();
      let saved = null; try { saved = JSON.parse(sessionStorage.getItem('jgcJobBoardForm:' + token) || 'null'); } catch { /* Require an online first visit. */ }
      if (!saved || saved.actor_id !== session.data?.session?.user?.id) throw new Error('Open this Job Board once with a connection before creating an offline form.');
      board = saved.board; canonicalWorker = saved.worker; actorId = saved.actor_id; prefill(); propagateLinks();
      notice('Offline form for Job ' + board.job_number + '. Supported inspections will stay on this device until they can sync.');
      return board;
    }
    const user = await client.auth.getUser();
    if (user.error || !user.data?.user) throw new Error('Sign in as JGC staff on the Job Board before creating a form.');
    const result = await client.rpc('get_job_board', { p_token: token, p_visit_token: visit || null });
    if (result.error || !result.data?.can_upload) throw new Error('Your account cannot create forms for this Job Board. Return to the board and sign in as JGC staff.');
    const profile = await client.from('profiles').select('worker_key,display_name,email,role,account_status').eq('id', user.data.user.id).maybeSingle();
    if (profile.error || !profile.data || profile.data.account_status !== 'approved') throw new Error('Your staff profile could not be verified. Return to the Job Board and sign in again.');
    canonicalWorker = { key: profile.data.worker_key, display: profile.data.display_name, email: profile.data.email, role: profile.data.role, status: profile.data.account_status };
    actorId = user.data.user.id;
    for (const [key, value] of Object.entries({ currentWorker: canonicalWorker.key, currentWorkerDisplay: canonicalWorker.display, currentUserEmail: canonicalWorker.email, currentUserRole: canonicalWorker.role, currentAccountStatus: canonicalWorker.status })) localStorage.setItem(key, value || '');
    sessionStorage.setItem('jgcActiveSession', 'true');
    board = result.data;
    // Cache only the previously verified job identity for existing offline inspection queues.
    // It grants no server access; all eventual inserts/attachments remain authorized by RLS.
    try { sessionStorage.setItem('jgcJobBoardForm:' + token, JSON.stringify({ actor_id: actorId, worker: canonicalWorker, board: { id: board.id, job_number: board.job_number, job_name: board.job_name, address: board.address } })); } catch { /* Offline preparation is optional. */ }
    prefill(); propagateLinks();
    notice('Job ' + board.job_number + ' · ' + board.job_name + '. This saved form will attach to this job automatically.');
    return board;
  }
  async function prepare() {
    if (!active) return true;
    try {
      if (!navigator.onLine) { await load(); prefill(); return true; }
      const current = await createJgcSupabaseClient().auth.getUser();
      if (current.error || !current.data?.user) throw new Error('Sign in as JGC staff on the Job Board before saving this form.');
      if (actorId && actorId !== current.data.user.id) { loading = null; board = null; canonicalWorker = null; actorId = null; }
      if (!loading) loading = load().catch(error => { loading = null; throw error; });
      await loading; prefill(); return true;
    } catch (error) { notice(error.message); return false; }
  }
  async function attach(sourceType, sourceId, boardId) {
    const id = boardId || board?.id;
    if (!id || !sourceId) return true;
    const session = await createJgcSupabaseClient().auth.getSession();
    const item = { board_id: id, source_type: sourceType, source_id: sourceId, actor_id: session.data?.session?.user?.id || actorId || null };
    const queue = readQueue().filter(q => !(q.board_id === id && q.source_type === sourceType && q.source_id === sourceId));
    queue.push(item); saveQueue(queue);
    try {
      const result = await createJgcSupabaseClient().rpc('attach_job_board_report_by_id', { p_board_id: id, p_source_type: sourceType, p_source_id: sourceId });
      if (result.error) throw new Error('The report is saved, but its Job Board attachment needs a retry. Do not submit the report again.');
      saveQueue(readQueue().filter(q => !(q.board_id === id && q.source_type === sourceType && q.source_id === sourceId)));
      if (active && board?.id === id) notice('Report saved and attached to Job ' + board.job_number + ' automatically.');
      prefill(); return true;
    } catch (error) { notice(error.message || 'Report saved; Job Board attachment needs a retry.', () => { void attach(sourceType, sourceId, id); }); return false; }
  }
  async function attachPhotos(sourceId, reportDate, photos) {
    if (!active || !board || !photos?.length) return true;
    const retry = () => { void attachPhotos(sourceId, reportDate, photos); };
    try {
      if (!(await attach('daily_site_reports', sourceId))) {
        notice('The report is saved, but its Job Board attachment and photos need a retry. Do not submit the report again.', retry);
        return false;
      }
      for (const [index, photo] of photos.entries()) {
        const key = sourceId + ':' + index;
        let attempt = photoAttempts.get(key);
        if (attempt?.finished) continue;
        if (attempt && !attempt.uploaded) {
          try {
            const result = await createJgcSupabaseClient().rpc('finalize_job_board_upload', { p_document_id: attempt.id });
            if (!result.error) { attempt.uploaded = true; attempt.finished = true; continue; }
          } catch { /* An incomplete upload can still be retried at its reserved path. */ }
        }
        const blob = await (await fetch(photo.dataUrl)).blob();
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(blob.type)) throw new Error('The report is attached. To add these photos, upload JPEG, PNG or WebP copies on the Job Board.');
        if (!attempt) {
          const result = await createJgcSupabaseClient().rpc('begin_job_board_upload', { p_board_id: board.id, p_category: 'daily-report', p_title: ('Daily report photo · ' + photo.name).slice(0, 200), p_report_date: reportDate,
            p_file_name: photo.name, p_mime_type: blob.type, p_file_size: blob.size, p_notes: 'Photo for daily site report ' + sourceId });
          if (result.error) throw new Error('The report is attached, but its photos need a retry. Keep this page open to retry the photos.');
          attempt = { ...result.data, uploaded: false, finished: false }; photoAttempts.set(key, attempt);
        }
        if (!attempt.uploaded) {
          const file = new File([blob], photo.name, { type: blob.type });
          const result = await uploadJgcFile({ client: createJgcSupabaseClient(), bucket: 'job-board-files', path: attempt.object_path, file, contentType: blob.type, maxBytes: 20 * 1024 * 1024,
            types: ['image/jpeg', 'image/png', 'image/webp'], upsert: false });
          if (result.error) throw new Error('The report is attached, but its photos need a retry. Keep this page open to retry the photos.');
          attempt.uploaded = true;
        }
        const finalized = await createJgcSupabaseClient().rpc('finalize_job_board_upload', { p_document_id: attempt.id });
        if (finalized.error) throw new Error('The photo uploaded, but its Job Board listing needs a retry.');
        attempt.finished = true;
      }
      notice('Daily report and photos attached to Job ' + board.job_number + ' automatically.'); return true;
    } catch (error) { notice(error.message, retry); return false; }
  }
  async function retryQueue() {
    if (!navigator.onLine || !readQueue().length) return;
    if (retrying) return retrying;
    retrying = (async () => {
      const user = await createJgcSupabaseClient().auth.getUser();
      if (!user.data?.user) return;
      for (const item of readQueue().filter(item => item.actor_id === user.data.user.id)) await attach(item.source_type, item.source_id, item.board_id);
    })();
    try { await retrying; } finally { retrying = null; }
  }
  window.JGCJobBoardContext = { active, submissionId, prepare, attach, retryAttachments: retryQueue, get board() { return board; }, get worker() { return canonicalWorker; } };
  window.prepareJgcJobBoardForm = prepare;
  window.attachJgcJobBoardReport = attach;
  window.attachJgcJobBoardPhotos = attachPhotos;
  window.getJgcJobBoardReturnUrl = returnUrl;
  function start() {
    if (active) { void prepare(); new MutationObserver(() => { prefill(); }).observe(document.body, { childList: true, subtree: true }); }
    void retryQueue();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
  window.addEventListener('online', retryQueue);
}());
