const { test, expect } = require('@playwright/test');

const ORIGIN = 'https://xnrljkkszoimegfivlya.supabase.co';
const TOKEN = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa' + 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
const VISIT = 'cccccccc-cccc-4ccc-cccc-cccccccccccc';
const BOARD = 'dddddddd-dddd-4ddd-dddd-dddddddddddd';
const OTHER_BOARD = '00000000-0000-4000-8000-000000000099';
const STAFF = { id: 'eeeeeeee-eeee-4eee-eeee-eeeeeeeeeeee', worker_key: 'synthetic alpha', display_name: 'Synthetic Alpha', email: 'alpha@example.test', role: 'worker', account_status: 'approved' };
const OTHER = { id: '00000000-0000-4000-8000-000000000002', worker_key: 'synthetic bravo', display_name: 'Synthetic Bravo', email: 'bravo@example.test', role: 'worker', account_status: 'approved' };
const QUEUE = 'jgcJobBoardAttachmentsV1';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aHu8AAAAASUVORK5CYII=', 'base64');

function auth(person) { const now = Math.floor(Date.now() / 1000), b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url'); const user = { id: person.id, aud: 'authenticated', role: 'authenticated', email: person.email, user_metadata: {} }; return { user, access_token: [b64({ alg: 'HS256', typ: 'JWT' }), b64({ sub: person.id, aud: 'authenticated', role: 'authenticated', exp: now + 3600, iat: now }), 'fixture-signature'].join('.'), refresh_token: 'fixture-refresh', token_type: 'bearer', expires_at: now + 3600, expires_in: 3600 }; }
function board() { return { id: BOARD, job_number: '26132', job_name: 'Synthetic site work', address: '14815 County Road 2', can_upload: true, can_register_as_staff: true, can_manage: false, enabled: true, documents: [] }; }
function fixture() { return { person: STAFF, calls: [], inspections: [], dailyReports: [], emails: [], failAttach: false, failFinalize: false, storageReady: false }; }
async function install(page, store, options = {}) {
  await page.exposeFunction('fixturePhotoStorageComplete', () => { store.storageReady = true; });
  await page.addInitScript(({ person, session, token, board, offline, attachmentQueue, queueKey, sessionOnly }) => {
    (sessionOnly ? sessionStorage : localStorage).setItem('sb-xnrljkkszoimegfivlya-auth-token', JSON.stringify(session)); localStorage.setItem('jgcStayLoggedIn',sessionOnly ? 'false' : 'true'); sessionStorage.setItem('jgcActiveSession', 'true');
    if (!localStorage.getItem('fixtureContextInitialized')) { localStorage.setItem('fixtureContextInitialized', 'true'); localStorage.setItem('fixtureOffline', offline ? 'true' : 'false'); localStorage.setItem(queueKey, JSON.stringify(attachmentQueue)); }
    for (const [key, value] of Object.entries({ currentWorker: person.worker_key, currentWorkerDisplay: person.display_name, currentUserEmail: person.email, currentUserRole: person.role, currentAccountStatus: person.account_status })) { if (!localStorage.getItem(key)) localStorage.setItem(key, value); }
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => localStorage.getItem('fixtureOffline') !== 'true' });
    if (offline) sessionStorage.setItem('jgcJobBoardForm:' + token, JSON.stringify({ actor_id: person.id, worker: { key: person.worker_key, display: person.display_name, email: person.email, role: person.role, status: person.account_status }, board }));
  }, { person: STAFF, session: auth(STAFF), token: TOKEN, board: board(), offline: !!options.offline, attachmentQueue: options.attachmentQueue || [], queueKey: QUEUE, sessionOnly: !!options.sessionOnly });
  page.on('dialog', (dialog) => dialog.accept());
  // Block or mock every external request, including the existing email script.
  await page.route('**/*', async (route) => {
    const req = route.request(), url = new URL(req.url()), single = String(req.headers().accept || '').includes('vnd.pgrst.object');
    if (['127.0.0.1', 'localhost'].includes(url.hostname)) return route.fallback();
    if (url.hostname === 'script.google.com') { store.emails.push(JSON.parse(req.postData() || '{}')); return route.fulfill({ status: 200, contentType: 'text/plain', body: 'fixture email request only' }); }
    if (url.origin !== ORIGIN) return route.abort('blockedbyclient');
    if (url.pathname.startsWith('/auth/v1/user')) return route.fulfill({ json: auth(store.person).user });
    if (url.pathname.startsWith('/auth/v1/token')) return route.fulfill({ json: auth(store.person) });
    if (url.pathname.endsWith('/rpc/get_job_board')) { const args = req.postDataJSON(); store.calls.push({ name: 'get_job_board', args }); return route.fulfill({ json: board() }); }
    if (url.pathname.endsWith('/rpc/register_job_board_visit')) return route.fulfill({ json: { visit_token: VISIT } });
    if (url.pathname.endsWith('/rpc/attach_job_board_report_by_id')) { const args = req.postDataJSON(); store.calls.push({ name: 'attach_job_board_report_by_id', args }); return store.failAttach ? route.fulfill({ status: 403, json: { message: 'Synthetic attachment failure' } }) : route.fulfill({ json: { id: 'attached-document' } }); }
    if (url.pathname.endsWith('/rpc/begin_job_board_upload')) { const args = req.postDataJSON(); store.calls.push({ name: 'begin_job_board_upload', args }); return route.fulfill({ json: { id: '00000000-0000-4000-8000-000000000008', object_path: BOARD + '/daily-photo.png' } }); }
    if (url.pathname.endsWith('/rpc/finalize_job_board_upload')) { const args = req.postDataJSON(); store.calls.push({ name: 'finalize_job_board_upload', args }); return store.failFinalize || !store.storageReady ? route.fulfill({ status: 403, json: { message: 'Synthetic finalize failure or incomplete file' } }) : route.fulfill({ json: {} }); }
    if (url.pathname.includes('/rpc/')) return route.fulfill({ json: [] });
    if (url.pathname.endsWith('/profiles')) return route.fulfill({ json: single ? store.person : [store.person] });
    if (url.pathname.endsWith('/jobs') || url.pathname.endsWith('/active_jobs')) return route.fulfill({ json: [{ id: 'stable-official-job', job_number: '26132', job_name: 'Synthetic site work', address: '14815 County Road 2', active: true }] });
    if (['/work_order_labour_workers','/employee_feature_access','/inspection_records'].some(name=>url.pathname.endsWith(name)) && !String(req.headers().authorization || '').startsWith('Bearer eyJ')) return route.fulfill({status:403,json:{code:'42501',message:'permission denied for table inspection_records'}});
    if (url.pathname.endsWith('/work_order_labour_workers')) return store.failCrew ? route.fulfill({status:403,json:{code:'42501',message:'Synthetic roster lookup failure'}}) : route.fulfill({json:[{id:STAFF.id,profile_id:STAFF.id,display_name:STAFF.display_name,worker_key:STAFF.worker_key,approved:true},{id:OTHER.id,profile_id:OTHER.id,display_name:OTHER.display_name,worker_key:OTHER.worker_key,approved:true}]});
    if (url.pathname.endsWith('/employee_feature_access')) return route.fulfill({json:[{worker_id:STAFF.id,feature_key:'jsa',enabled:true},{worker_id:OTHER.id,feature_key:'jsa',enabled:true}]});
    if (url.pathname.endsWith('/inspection_records')) {
      if (req.method() === 'POST') { const record = req.postDataJSON(); store.inspections.push(record); return route.fulfill({ status: 201, json: record }); }
      return route.fulfill({ json: single ? null : [] });
    }
    if (url.pathname.endsWith('/daily_site_reports')) { if (req.method() === 'POST' || req.method() === 'PATCH') store.dailyReports.push(req.postDataJSON()); return route.fulfill({ status: req.method() === 'POST' ? 201 : 200, json: single ? null : [] }); }
    return route.fulfill({ json: single ? null : [] });
  });
}
const qr = (page) => '/' + page + '?jobBoard=1&embedded=1#' + new URLSearchParams({ board: TOKEN, visit: VISIT });
async function openJsa(page, store, options) { await install(page, store, options); await page.goto(qr('jsa.html')); await expect(page.locator('#jsaField1')).toHaveValue('26132 - Synthetic site work'); await page.getByLabel('Task / job step', { exact: true }).first().fill('Inspect roof access'); await page.getByLabel('Hazards', { exact: true }).first().fill('Falls from height'); await page.getByLabel('Controls / PPE', { exact: true }).first().fill('Guardrails and fall protection'); }

test('actual JSA prefills the stable board, resets changed job text, and saves/attaches with the canonical actor', async ({ page }) => {
  const store = fixture(); await openJsa(page, store); await expect(page.locator('#jsaField1')).toHaveAttribute('readonly', ''); await expect(page.locator('#jsaField2')).toHaveValue('14815 County Road 2');
  expect(store.calls.find((c) => c.name === 'get_job_board').args).toEqual({ p_token: TOKEN, p_visit_token: VISIT });
  const prepared = await page.evaluate(async () => { document.getElementById('jsaField1').value = '26999 - Wrong job'; localStorage.setItem('currentWorker', 'stale worker'); localStorage.setItem('currentWorkerDisplay', 'Stale Worker'); const prepared = await buildInspectionRecord('JSA', getCurrentWorker()); const saved = await persistInspectionRecord(prepared.record); return { prepared, saved }; });
  expect(prepared.saved).toMatchObject({ worker_name: STAFF.worker_key, worker_display_name: STAFF.display_name, summary: { completed_by: STAFF.display_name }, form_data: { job_context: { job_board_id: BOARD, jobNumber: '26132', project: '26132 - Synthetic site work' } } });
  expect(prepared.saved.email_body).toContain('Completed by: ' + STAFF.display_name);
  expect(store.inspections).toHaveLength(1); expect(store.calls.find((c) => c.name === 'attach_job_board_report_by_id').args).toEqual({ p_board_id: BOARD, p_source_type: 'inspection_records', p_source_id: prepared.saved.id });
  await expect(page.locator('#jobBoardFormStatus')).toContainText('Report saved and attached'); expect(await page.getByRole('link', { name: 'Back to Job Board', exact: true }).getAttribute('href')).toContain('#board=' + TOKEN);
});

test('daily report attachment failure blocks photo success; retries do not resubmit the report or recreate uploaded files', async ({ page }) => {
  const store = fixture(); store.failAttach = true; await install(page, store); await page.goto(qr('daily-site-report.html')); await expect(page.locator('#project')).toHaveValue('26132 - Synthetic site work');
  await page.locator('#workCompleted').fill('Roof access inspection complete'); await page.locator('#photos').setInputFiles({ name: 'daily-photo.png', mimeType: 'image/png', buffer: PNG });
  await page.evaluate(() => { window.fixtureUploadCalls = 0; window.fixtureUploadFails = true; window.uploadJgcFile = async () => { window.fixtureUploadCalls++; if (window.fixtureUploadFails) return { error: { message: 'Synthetic photo connection failure' } }; await window.fixturePhotoStorageComplete(); return { data: {} }; }; });
  await page.locator('#saveReportButton').click(); await expect(page.locator('#jobBoardFormStatus')).toContainText('attachment and photos need a retry'); expect(store.dailyReports).toHaveLength(1); expect(store.calls.filter((c) => c.name === 'begin_job_board_upload')).toHaveLength(0); await expect(page.locator('#jobBoardFormStatus')).not.toContainText('Daily report and photos attached');
  store.failAttach = false; await page.getByRole('button', { name: 'Retry attaching saved report', exact: true }).click(); await expect(page.locator('#jobBoardFormStatus')).toContainText('The report is attached, but its photos need a retry.'); expect(store.calls.filter((c) => c.name === 'begin_job_board_upload')).toHaveLength(1); expect(store.calls.filter((c) => c.name === 'finalize_job_board_upload')).toHaveLength(0);
  await page.evaluate(() => window.fixtureUploadFails = false); store.failFinalize = true; await page.getByRole('button', { name: 'Retry attaching saved report', exact: true }).click(); await expect(page.locator('#jobBoardFormStatus')).toContainText('listing needs a retry');
  store.failFinalize = false; await page.getByRole('button', { name: 'Retry attaching saved report', exact: true }).click(); await expect(page.locator('#jobBoardFormStatus')).toContainText('Daily report and photos attached');
  expect(store.dailyReports).toHaveLength(1); expect(store.calls.filter((c) => c.name === 'begin_job_board_upload')).toHaveLength(1); expect(await page.evaluate(() => window.fixtureUploadCalls)).toBe(2); expect(store.calls.filter((c) => c.name === 'finalize_job_board_upload')).toHaveLength(3);
  const saved = store.dailyReports[0]; expect(saved.worker_name).toBe(STAFF.worker_key); expect(saved.project).toBe('26132 - Synthetic site work'); expect(store.calls.filter((c) => c.name === 'attach_job_board_report_by_id').every((c) => c.args.p_board_id === BOARD && c.args.p_source_id === saved.id)).toBe(true); expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), QUEUE)).toEqual([]);
});

test('account switching revalidates the user and replaces the previous canonical form actor', async ({ page }) => {
  const store = fixture(); await openJsa(page, store); store.person = OTHER;
  await page.evaluate(async (session) => { await createJgcSupabaseClient().auth.setSession(session); }, auth(OTHER));
  const result = await page.evaluate(async () => { const ok = await prepareJgcJobBoardForm(); const prepared = await buildInspectionRecord('JSA', getCurrentWorker()); return { ok, worker: JGCJobBoardContext.worker, record: prepared.record, key: localStorage.getItem('currentWorker') }; });
  expect(result.ok).toBe(true); expect(result.worker.key).toBe(OTHER.worker_key); expect(result.record.worker_name).toBe(OTHER.worker_key); expect(result.key).toBe(OTHER.worker_key); expect(store.calls.filter((c) => c.name === 'get_job_board')).toHaveLength(2);
});

test('offline JSA retains its board and actor then attaches that exact board when syncing from an ordinary inspection page', async ({ page }) => {
  const store = fixture(); await openJsa(page, store, { offline: true }); await expect(page.locator('#jobBoardFormStatus')).toContainText('Offline form for Job 26132');
  await page.evaluate(() => { localStorage.setItem('currentWorker', 'stale local worker'); return saveInspection('JSA'); }); await page.waitForURL(/job-board\.html/);
  const queue = await page.evaluate(() => JSON.parse(localStorage.getItem('jgcInspectionOfflineQueueV1'))); expect(queue).toHaveLength(1); expect(queue[0]).toMatchObject({ workerName: STAFF.worker_key, record: { worker_name: STAFF.worker_key, form_data: { job_context: { job_board_id: BOARD, jobNumber: '26132' } } } }); expect(store.inspections).toHaveLength(0);
  const sourceId = queue[0].record.id; await page.evaluate((worker) => { localStorage.setItem('fixtureOffline', 'false'); localStorage.setItem('currentWorker', worker); }, STAFF.worker_key); await page.goto('/aerial-lifts.html?embedded=1');
  await expect.poll(() => store.inspections.length).toBe(1); await expect.poll(() => store.calls.filter((c) => c.name === 'attach_job_board_report_by_id').length).toBe(1); expect(store.inspections[0].id).toBe(sourceId); expect(store.calls.find((c) => c.name === 'attach_job_board_report_by_id').args).toEqual({ p_board_id: BOARD, p_source_type: 'inspection_records', p_source_id: sourceId }); await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('jgcInspectionOfflineQueueV1')).length)).toBe(0);
});

test('attachment retry on a non-QR page replays only the signed-in actor and preserves other actors’ queued items', async ({ page }) => {
  const store = fixture(), first = { board_id: BOARD, source_type: 'daily_site_reports', source_id: 'queued-alpha-source', actor_id: STAFF.id }, second = { board_id: OTHER_BOARD, source_type: 'daily_site_reports', source_id: 'queued-bravo-source', actor_id: OTHER.id };
  await install(page, store, { offline: true, attachmentQueue: [first, second] }); await page.goto('/daily-site-report.html?embedded=1'); expect(store.calls.some((c) => c.name === 'attach_job_board_report_by_id')).toBe(false);
  await page.evaluate(() => { localStorage.setItem('fixtureOffline', 'false'); window.dispatchEvent(new Event('online')); }); await expect.poll(() => store.calls.filter((c) => c.name === 'attach_job_board_report_by_id').length).toBe(1); expect(store.calls.find((c) => c.name === 'attach_job_board_report_by_id').args).toEqual({ p_board_id: BOARD, p_source_type: first.source_type, p_source_id: first.source_id }); await expect.poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key)), QUEUE)).toEqual([second]);
});

test('ordinary non-QR daily reports keep the existing project/save workflow without creating a board attachment', async ({ page }) => {
  const store = fixture(); await install(page, store); await page.goto('/daily-site-report.html?embedded=1'); expect(await page.evaluate(() => JGCJobBoardContext.active)).toBe(false); await expect(page.locator('#jobBoardFormStatus')).toHaveCount(0); expect(await page.locator('#project').evaluate((field) => field.readOnly)).toBe(false);
  await page.locator('.jgc-project-job-select').selectOption('__manual__'); await page.locator('#project').fill('26999 - Ordinary project'); await page.locator('#workCompleted').fill('Normal report content'); await page.locator('#saveReportButton').click(); await expect(page.locator('#reportStatus')).toContainText('Daily site report saved'); expect(store.dailyReports).toHaveLength(1); expect(store.dailyReports[0].project).toBe('26999 - Ordinary project'); expect(store.calls.some((c) => ['get_job_board', 'attach_job_board_report_by_id', 'begin_job_board_upload'].includes(c.name))).toBe(false); expect(store.emails).toHaveLength(1);
});

test('a lost successful daily photo upload response finalizes the original stored object without a duplicate transfer', async ({ page }) => {
  const store = fixture(); await install(page, store); await page.goto(qr('daily-site-report.html')); await expect(page.locator('#project')).toHaveValue('26132 - Synthetic site work'); await page.locator('#photos').setInputFiles({ name: 'stored-photo.png', mimeType: 'image/png', buffer: PNG });
  await page.evaluate(() => { window.fixtureUploadCalls = 0; window.uploadJgcFile = async () => { window.fixtureUploadCalls++; await window.fixturePhotoStorageComplete(); return { error: { message: 'Response lost after Storage completed the file' } }; }; });
  await page.locator('#saveReportButton').click(); await expect(page.locator('#jobBoardFormStatus')).toContainText('photos need a retry'); await page.getByRole('button', { name: 'Retry attaching saved report', exact: true }).click(); await expect(page.locator('#jobBoardFormStatus')).toContainText('Daily report and photos attached'); expect(await page.evaluate(() => window.fixtureUploadCalls)).toBe(1); expect(store.dailyReports).toHaveLength(1); expect(store.calls.filter((c) => c.name === 'begin_job_board_upload')).toHaveLength(1); expect(store.calls.filter((c) => c.name === 'finalize_job_board_upload')).toHaveLength(1);
});

test('returning to the board retries a saved attachment once with its original board and actor', async ({ page }) => {
  const store = fixture(), queued = { board_id: OTHER_BOARD, source_type: 'daily_site_reports', source_id: 'saved-report-from-other-board', actor_id: STAFF.id };
  await install(page, store, { attachmentQueue: [queued] }); await page.goto('/job-board.html?embedded=1#board=' + TOKEN); await expect(page.locator('#boardContent')).toBeVisible();
  expect(store.calls.filter((c) => c.name === 'attach_job_board_report_by_id')).toHaveLength(1); expect(store.calls.find((c) => c.name === 'attach_job_board_report_by_id').args).toEqual({ p_board_id: OTHER_BOARD, p_source_type: queued.source_type, p_source_id: queued.source_id }); expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), QUEUE)).toEqual([]);
});


test('session-only mobile staff login loads approved JSA crew and saves with the same authenticated session',async ({page})=>{
  await page.setViewportSize({width:390,height:844});const store=fixture();await openJsa(page,store,{sessionOnly:true});
  await expect(page.locator('#approvedCrewStatus')).toContainText('2 approved employees loaded');await page.locator('#approvedCrewSelect').selectOption(OTHER.worker_key);
  await expect(page.locator('#selectedCrewList')).toContainText(OTHER.display_name);
  const saved=await page.evaluate(async()=>{const prepared=await buildInspectionRecord('JSA',getCurrentWorker());return persistInspectionRecord(prepared.record);});expect(saved.worker_name).toBe(STAFF.worker_key);expect(store.inspections).toHaveLength(1);
  expect(await page.evaluate(()=>localStorage.getItem('sb-xnrljkkszoimegfivlya-auth-token'))).toBeNull();
});

test('failed JSA crew lookup shows unavailable and retry rather than no approved employees',async ({page})=>{
  const store=fixture();store.failCrew=true;await openJsa(page,store,{sessionOnly:true});await expect(page.locator('#approvedCrewStatus')).toContainText('could not be loaded');await expect(page.locator('#approvedCrewSelect')).toContainText('Employee list unavailable');await expect(page.locator('#approvedCrewRetry')).toBeVisible();
  store.failCrew=false;await page.locator('#approvedCrewRetry').click();await expect(page.locator('#approvedCrewStatus')).toContainText('2 approved employees loaded');await expect(page.locator('#approvedCrewRetry')).toBeHidden();
});
