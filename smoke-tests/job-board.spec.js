const { test, expect } = require('@playwright/test');
// Full Chromium renders PDF tabs; the default headless shell downloads them instead.
test.use({ channel: 'chromium' });
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { directoryState, serveDirectory, openDirectoryJob } = require('./fixtures/job-readability-fixture');

const ORIGIN = 'https://xnrljkkszoimegfivlya.supabase.co';
const TOKEN = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa' + 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
const VISIT = 'cccccccc-cccc-4ccc-cccc-cccccccccccc';
const BOARD_ID = 'dddddddd-dddd-4ddd-dddd-dddddddddddd';
const USER_ID = 'eeeeeeee-eeee-4eee-eeee-eeeeeeeeeeee';
const DOCUMENT_ID = 'ffffffff-ffff-4fff-ffff-ffffffffffff';
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto' }).format(new Date());
const previousDate = '2026-09-30';
const categoryValues = ['hs-documents', 'site-specific', 'jgc-policy', 'jsa', 'toolbox-talk', 'accident-incident', 'daily-report', 'permit', 'inspection', 'other'];

function session(identity) {
  const now = Math.floor(Date.now() / 1000);
  const user = { id: USER_ID, aud: 'authenticated', role: 'authenticated', email: identity + '@example.test', user_metadata: {} };
  const b64 = (data) => Buffer.from(JSON.stringify(data)).toString('base64url');
  return { user, access_token: [b64({ alg: 'HS256', typ: 'JWT' }), b64({ sub: USER_ID, role: 'authenticated', aud: 'authenticated', exp: now + 3600 }), Buffer.from('fixture-signature').toString('base64url')].join('.'), refresh_token: 'fixture-refresh', token_type: 'bearer', expires_at: now + 3600, expires_in: 3600 };
}
function documents() {
  return [
    { id: DOCUMENT_ID, title: 'Morning JSA – elevated work', category: 'jsa', report_date: today(), file_name: 'Morning-JSA.pdf', mime_type: 'application/pdf', file_size: 250000, status: 'published', visibility: 'public', notes: 'Use the designated access route.' },
    { id: '00000000-0000-4000-8000-000000000002', title: 'Previous roof access JSA', category: 'jsa', report_date: previousDate, file_name: 'Previous-JSA.pdf', mime_type: 'application/pdf', status: 'published', visibility: 'public' },
    { id: '00000000-0000-4000-8000-000000000003', title: 'JGC Health & Safety Policy', category: 'jgc-policy', report_date: previousDate, file_name: 'Policy.pdf', mime_type: 'application/pdf', status: 'published', visibility: 'public', source_type: 'policies', source_id: 'policy-source', automatic: true },
    { id: '00000000-0000-4000-8000-000000000004', title: 'Private accident report', category: 'accident-incident', report_date: today(), file_name: 'Accident.jpg', mime_type: 'image/jpeg', status: 'published', visibility: 'restricted' },
    { id: '00000000-0000-4000-8000-000000000005', title: 'Paper incident for office review', category: 'accident-incident', report_date: today(), file_name: 'Paper-incident.jpg', mime_type: 'image/jpeg', status: 'pending', visibility: 'restricted', notes: 'Office review required.' }
  ];
}
function sourceJsa() {
  return { source_type: 'inspection_records', record: { id: 'jsa-source', inspection_type: 'JSA', inspection_date: today(), form_data: { fields: [
    { label: 'Project', value: 'Job 26132 Synthetic Site' }, { label: 'Location', value: 'North roof' },
    { label: 'Contractor Supervisor', value: 'Synthetic supervisor' }, { label: 'Crew Sign Off', value: 'Synthetic worker' }
  ], rows: [{ cells: ['Install roof curb', 'Falls from height', 'Guardrails and fall protection'] }] } } };
}
function fixture(identity = 'guest') {
  return { identity, auth: identity === 'guest' ? null : session(identity), visit: null, calls: [], events: [], sources: [
    { source_type: 'inspection_records', source_id: 'existing-jsa', title: 'Existing job-number-matched JSA', category: 'jsa', report_date: previousDate, match: 'job-number' },
    { source_type: 'policies', source_id: 'existing-policy', title: 'Company safety policy', category: 'jgc-policy', report_date: previousDate, match: 'company-policy' }
  ], documentRows: documents(), edgeCalls: [], failBoard: false, activityPages: null, storageReady: false };
}
async function install(page, store, options = {}) {
  await page.exposeFunction('fixtureBoardStorageComplete', () => { store.storageReady = true; });
  await page.addInitScript(({ auth, theme, forgedAdmin }) => {
    localStorage.setItem('jgcPortalTheme', theme);
    if (auth) { localStorage.setItem('sb-xnrljkkszoimegfivlya-auth-token', JSON.stringify(auth)); localStorage.setItem('jgcStayLoggedIn', 'true'); sessionStorage.setItem('jgcActiveSession', 'true'); }
    if (forgedAdmin) { localStorage.setItem('currentWorker', 'forged admin'); localStorage.setItem('currentUserRole', 'admin'); localStorage.setItem('currentAccountStatus', 'approved'); }
  }, { auth: store.auth, theme: options.theme || 'dark', forgedAdmin: !!options.forgedAdmin });
  // Every non-local request is intercepted. These fixtures never contact production.
  await page.route('**/*', async (route) => {
    const req = route.request(), url = new URL(req.url());
    if (['127.0.0.1', 'localhost'].includes(url.hostname)) return route.fallback();
    if (url.origin !== ORIGIN) return route.abort('blockedbyclient');
    if (url.pathname.startsWith('/auth/v1/token')) { store.identity = 'staff'; store.auth = session('staff'); return route.fulfill({ json: store.auth }); }
    if (url.pathname.startsWith('/auth/v1/user')) return store.auth ? route.fulfill({ json: store.auth.user }) : route.fulfill({ status: 401, json: { message: 'No authenticated session' } });
    if (url.pathname.startsWith('/rest/v1/profiles')) return route.fulfill({ json: { display_name: 'Synthetic Site Staff', worker_key: 'synthetic site staff', role: 'worker', account_status: 'approved', email: 'staff@example.test' } });
    if (url.pathname === '/functions/v1/jgc-job-board-document') { store.edgeCalls.push(req.postDataJSON()); return store.failDocument ? route.fulfill({ status: 403, json: { error: 'Synthetic document unavailable' } }) : route.fulfill({ json: { sourcePayload: sourceJsa(), fileName: 'Job-26132-JSA.pdf', mimeType: 'application/pdf' } }); }
    if (!url.pathname.startsWith('/rest/v1/rpc/')) return route.fulfill({ json: [] });
    const name = url.pathname.split('/').pop(), args = req.postDataJSON() || {};
    store.calls.push({ name, args });
    const role = store.identity, manager = role === 'admin', canUpload = role === 'staff' || manager, restricted = role === 'client' || canUpload;
    const board = () => ({ id: BOARD_ID, job_id: 'existing-estimator-job', job_number: '26132', job_name: '14815 County Road 2 – Site safety', address: 'South Stormont, Ontario', token: TOKEN, enabled: true, can_manage: manager, can_upload: canUpload, can_register_as_staff: canUpload, can_read_restricted: restricted, requires_visitor_signin: !store.visit && !manager, documents: manager ? store.documentRows : !store.visit ? [] : store.documentRows.filter((d) => d.status === 'published' && (d.visibility === 'public' || restricted)), viewers: manager ? [{ id: 'viewer-id', email: 'client@example.test' }] : [] });
    if (name === 'get_job_board' || name === 'get_or_create_job_board') return store.failBoard ? route.fulfill({ status: 403, json: { message: 'Board unavailable for this test' } }) : route.fulfill({ json: board() });
    if (name === 'register_job_board_visit') { if (!canUpload && (!args.p_name || !args.p_company || !args.p_email)) return route.fulfill({ status: 403, json: { message: 'Visitor name, company and email are required' } }); store.visit = VISIT; store.events.push({ id: 'visit-event', actor_name: canUpload ? 'Synthetic Site Staff' : args.p_name, actor_company: args.p_company, actor_email: canUpload ? store.auth.user.email : args.p_email, identity_type: canUpload ? 'staff' : 'visitor', action: canUpload ? 'staff-signin' : 'visitor-signin', created_at: new Date().toISOString() }); return route.fulfill({ json: { visit_token: VISIT } }); }
    if (name === 'get_job_board_activity') { const events = store.activityPages || store.events; const start = args.p_before ? events.findIndex((event) => event.created_at === args.p_before) + 1 : 0; const batch = events.slice(start, start + args.p_limit); return route.fulfill({ json: { events: batch, next_before: start + batch.length < events.length ? batch.at(-1).created_at : null } }); }
    if (name === 'log_job_board_activity') { store.events.push({ id: 'document-event', actor_name: 'Synthetic user', identity_type: role === 'guest' ? 'visitor' : 'staff', action: args.p_action, document_title: store.documentRows.find((d) => d.id === args.p_document_id)?.title, created_at: new Date().toISOString() }); return route.fulfill({ json: {} }); }
    if (name === 'begin_job_board_upload') return route.fulfill({ json: { id: '00000000-0000-4000-8000-000000000007', object_path: BOARD_ID + '/paper-upload.pdf' } });
    if (name === 'finalize_job_board_upload') return store.storageReady ? route.fulfill({ json: {} }) : route.fulfill({ status: 403, json: { message: 'The original object has not finished uploading' } });
    if (name === 'list_job_board_sources') return route.fulfill({ json: store.sources });
    if (name === 'attach_job_board_report') { const source = store.sources.find((s) => s.source_id === args.p_source_id); store.documentRows.push({ id: 'imported-document', ...source, file_name: 'Source-report.pdf', status: 'pending', visibility: 'restricted', mime_type: 'application/pdf' }); store.sources = store.sources.filter((s) => s !== source); return route.fulfill({ json: {} }); }
    if (name === 'review_job_board_document') { const doc = store.documentRows.find((d) => d.id === args.p_document_id); if (doc) { doc.status = args.p_status; doc.visibility = args.p_visibility; } return route.fulfill({ json: {} }); }
    if (name === 'update_job_board_document') { const doc = store.documentRows.find((d) => d.id === args.p_document_id); if (doc) Object.assign(doc, { title: args.p_title, category: args.p_category, report_date: args.p_report_date, notes: args.p_notes }); return route.fulfill({ json: {} }); }
    return route.fulfill({ json: {} });
  });
}
async function open(page, identity, options) { const store = fixture(identity); await install(page, store, options); await page.goto(identity === 'admin' ? '/job-board.html?job=existing-estimator-job&manage=1&embedded=1' : '/job-board.html?embedded=1#board=' + TOKEN); await expect(page.locator(identity === 'guest' || identity === 'client' ? '#visitorGate' : '#boardContent')).toBeVisible(); return store; }
async function visitorSignIn(page) { await page.getByLabel('Your name', { exact: true }).fill('Synthetic Visitor'); await page.getByLabel('Company', { exact: true }).fill('Synthetic Client Company'); await page.getByLabel('Email address', { exact: true }).first().fill('visitor@example.test'); await page.getByRole('button', { name: 'Continue to Job Board', exact: true }).click(); await expect(page.locator('#boardContent')).toBeVisible(); }
function receipt(testInfo, name) { const root = process.env.JGC_JOB_BOARD_RECEIPTS; const file = root ? path.join(root, name) : testInfo.outputPath(name); fs.mkdirSync(path.dirname(file), { recursive: true }); return file; }
async function pdfTexts(bytes) { const lib = await import(pathToFileURL(path.resolve(__dirname, '../estimating-app/node_modules/pdfjs-dist/legacy/build/pdf.mjs')).href); const task = lib.getDocument({ data: new Uint8Array(bytes), disableWorker: true }); const pdf = await task.promise, pages = []; for (let n = 1; n <= pdf.numPages; n++) { const content = await (await pdf.getPage(n)).getTextContent(); pages.push(content.items.map((item) => item.str).join(' ')); } await task.destroy(); return pages.join('\n'); }

test('visitor sign-in gates documents, records identity/time, and keeps restricted reports private', async ({ page }) => {
  const store = await open(page, 'guest', { forgedAdmin: true });
  await expect(page.locator('#boardContent')).toBeHidden(); await expect(page.locator('#documentList article')).toHaveCount(0);
  const before = Date.now(); await visitorSignIn(page);
  expect(store.calls.find((c) => c.name === 'register_job_board_visit').args).toEqual({ p_token: TOKEN, p_name: 'Synthetic Visitor', p_company: 'Synthetic Client Company', p_email: 'visitor@example.test' });
  expect(store.events[0]).toMatchObject({ identity_type: 'visitor', actor_name: 'Synthetic Visitor', actor_company: 'Synthetic Client Company', actor_email: 'visitor@example.test', action: 'visitor-signin' });
  expect(Date.parse(store.events[0].created_at)).toBeGreaterThanOrEqual(before); expect(Date.parse(store.events[0].created_at)).toBeLessThanOrEqual(Date.now());
  await expect(page.locator('#documentList')).not.toContainText('Private accident'); await expect(page.locator('#boardManager')).toBeHidden();
  await page.getByRole('tab', { name: 'Upload', exact: true }).click(); await expect(page.locator('#uploadSignIn')).toBeVisible(); await expect(page.locator('#uploadForm')).toBeHidden();
  await page.reload(); await expect(page.locator('#boardContent')).toBeVisible(); expect(store.calls.filter((c) => c.name === 'register_job_board_visit')).toHaveLength(1);
  expect(store.calls.filter((c) => c.name === 'get_job_board').at(-1).args.p_visit_token).toBe(VISIT);
});

test('client access comes from the server and cannot upload despite a forged local admin role', async ({ page }) => {
  const store = await open(page, 'client', { forgedAdmin: true });
  expect(store.calls.filter((c) => c.name === 'register_job_board_visit')).toHaveLength(0); await visitorSignIn(page);
  await expect(page.locator('#documentList')).toContainText('Private accident report'); await expect(page.locator('#reviewTab')).toBeHidden(); await expect(page.locator('#boardManager')).toBeHidden();
  await page.getByRole('tab', { name: 'Upload', exact: true }).click(); await expect(page.locator('#uploadForm')).toBeHidden(); await expect(page.locator('#createForms')).toBeHidden();
  expect(store.calls.some((c) => c.name === 'register_job_board_visit')).toBe(true);
});

for (const theme of ['light', 'dark']) for (const width of [390, 1440]) test(`Job Board is contained and readable ${theme} ${width}`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 1000 }); const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await open(page, 'admin', { theme }); await expect(page.locator('#boardQr')).toHaveAttribute('src', /^data:image\/png;base64,/);
  await expect(page.locator('#todayJsaList')).toContainText('Morning JSA'); await expect(page.locator('#todayJsaList')).not.toContainText('Previous roof access');
  for (const name of ['Documents', 'Upload', 'Review uploads (1)']) { await page.getByRole('tab', { name, exact: true }).click(); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true); await page.screenshot({ path: receipt(testInfo, `board-${theme}-${width}-${name.split(' ')[0].toLowerCase()}.png`), fullPage: true }); }
  expect(errors).toEqual([]);
  await page.getByRole('tab', { name: 'Documents', exact: true }).click(); await page.getByRole('button', { name: 'JSA history', exact: true }).click(); await expect(page.locator('#documentList article')).toHaveCount(2);
  await page.getByLabel('Search documents').fill('previous'); await expect(page.locator('#documentList')).toContainText('Previous roof access'); await expect(page.locator('#documentList article')).toHaveCount(1);
});

test('actual QR PNG and print poster encode the public board link without identity or signed file URLs', async ({ page }, testInfo) => {
  await open(page, 'admin'); await expect(page.locator('#boardQr')).toHaveAttribute('src', /^data:image\/png;base64,/);
  const href = await page.locator('#boardOpenLink').getAttribute('href'), parsed = new URL(href);
  expect(parsed.pathname).toBe('/job-board.html'); expect(parsed.searchParams.get('embedded')).toBe('1'); expect(new URLSearchParams(parsed.hash.slice(1)).get('board')).toBe(TOKEN); expect(parsed.searchParams.has('board')).toBe(false);
  const png = await page.locator('#boardQr').getAttribute('src'); const pngBytes = Buffer.from(png.split(',')[1], 'base64'); expect(pngBytes.subarray(1, 4).toString()).toBe('PNG'); fs.writeFileSync(receipt(testInfo, 'job-board-qr.png'), pngBytes); fs.writeFileSync(receipt(testInfo, 'job-board-qr-expected.txt'), href);
  const pending = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download QR', exact: true }).click(); const download = await pending; expect(download.suggestedFilename()).toBe('JGC-Job-26132-QR.png');
  await download.saveAs(receipt(testInfo, 'job-board-qr-downloaded.png')); expect(fs.readFileSync(receipt(testInfo, 'job-board-qr-downloaded.png'))).toEqual(pngBytes);
  await page.emulateMedia({ media: 'print' }); await expect(page.locator('#jobBoardPage')).toBeHidden(); await expect(page.locator('#boardPoster')).toBeVisible(); await expect(page.locator('#posterJob')).toContainText('Job 26132'); await expect(page.locator('#posterQr')).toHaveAttribute('src', png); await page.screenshot({ path: receipt(testInfo, 'job-board-qr-poster.png'), fullPage: true });
});

test('staff direct sign-in verifies profile, preserves job context, and retries a failed upload without duplicate metadata', async ({ page }) => {
  const store = await open(page, 'guest'); await visitorSignIn(page); await page.getByRole('tab', { name: 'Upload', exact: true }).click(); await page.getByRole('button', { name: 'Staff sign-in', exact: true }).click();
  await page.locator('#staffEmail').fill('staff@example.test'); await page.locator('#staffPassword').fill('fixture-password'); await page.locator('#staffSubmit').click(); await expect(page.locator('#uploadForm')).toBeVisible();
  expect(await page.evaluate(() => [localStorage.getItem('currentWorker'), localStorage.getItem('currentUserRole'), localStorage.getItem('currentAccountStatus'), sessionStorage.getItem('jgcActiveSession')])).toEqual(['synthetic site staff', 'worker', 'approved', 'true']);
  expect(store.calls.filter((c) => c.name === 'register_job_board_visit')).toHaveLength(2);
  const links = await page.locator('#createFormLinks a').evaluateAll((links) => links.map((a) => a.href)); expect(links).toHaveLength(13);
  for (const href of links) { const u = new URL(href); expect(u.origin).toBe(new URL(page.url()).origin); expect(u.searchParams.get('jobBoard')).toBe('1'); expect(new URLSearchParams(u.hash.slice(1)).get('board')).toBe(TOKEN); expect(new URLSearchParams(u.hash.slice(1)).get('visit')).toBe(VISIT); }
  expect(links.some((href) => new URL(href).pathname === '/inspections.html')).toBe(false);
  expect(await page.locator('#uploadCategory option').evaluateAll((options) => options.map((o) => o.value))).toEqual(categoryValues);
  await page.evaluate(() => { window.boardUploadAttempts = 0; window.uploadJgcFile = async () => { if (++window.boardUploadAttempts === 1) return { error: { message: 'Synthetic connection loss' } }; await window.fixtureBoardStorageComplete(); return { data: {} }; }; });
  await page.getByLabel('Title', { exact: true }).fill('Paper JSA for review'); await page.locator('#uploadFiles').setInputFiles({ name: 'paper-jsa.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\nSynthetic upload') }); await page.locator('#uploadSubmit').click();
  await expect(page.locator('#uploadStatus')).toContainText('Synthetic connection loss'); await expect(page.locator('#uploadTitle')).toHaveValue('Paper JSA for review'); expect(await page.locator('#uploadFiles').evaluate((e) => e.files.length)).toBe(1); expect(store.calls.filter((c) => c.name === 'finalize_job_board_upload')).toHaveLength(0);
  await page.locator('#uploadSubmit').click(); await expect(page.locator('#uploadStatus')).toContainText('1 file uploaded for office review'); expect(store.calls.filter((c) => c.name === 'begin_job_board_upload')).toHaveLength(1); expect(store.calls.filter((c) => c.name === 'finalize_job_board_upload')).toHaveLength(2); expect(await page.locator('#uploadFiles').evaluate((e) => e.files.length)).toBe(0);
  expect(store.calls.find((c) => c.name === 'begin_job_board_upload').args).toMatchObject({ p_board_id: BOARD_ID, p_category: 'jsa', p_title: 'Paper JSA for review', p_file_name: 'paper-jsa.pdf', p_mime_type: 'application/pdf' });
});

test('accident publication locks restricted access and existing source imports require review', async ({ page }) => {
  const store = await open(page, 'admin'); await page.getByRole('tab', { name: 'Review uploads (1)', exact: true }).click();
  const card = page.locator('#reviewList article').first(); const visibility = card.getByLabel('Published access', { exact: true }); await expect(visibility).toHaveValue('restricted'); await expect(visibility).toBeDisabled();
  await card.getByRole('button', { name: 'Publish document', exact: true }).click(); await expect(page.locator('#reviewList')).toContainText('No uploads are waiting'); expect(store.calls.find((c) => c.name === 'review_job_board_document').args).toMatchObject({ p_status: 'published', p_visibility: 'restricted' });
  await page.locator('#boardImport summary').click(); await expect(page.locator('#importList')).toContainText('Existing job-number-matched JSA'); await expect(page.locator('#importList')).toContainText('Company safety policy');
  await page.locator('#importList .board-viewer').first().getByRole('button', { name: 'Attach for review' }).click(); await expect(page.locator('#reviewList')).toContainText('Existing job-number-matched JSA'); expect(store.calls.find((c) => c.name === 'attach_job_board_report').args).toMatchObject({ p_token: TOKEN, p_visit_token: VISIT, p_source_type: 'inspection_records', p_source_id: 'existing-jsa' });
});

test('source JSA downloads as a real PDF containing the saved tasks and controls', async ({ page }, testInfo) => {
  const store = await open(page, 'staff'); const pending = page.waitForEvent('download'); await page.locator('#documentList article').filter({ hasText: 'Morning JSA' }).getByRole('button', { name: 'Download', exact: true }).click(); const download = await pending;
  expect(download.suggestedFilename()).toBe('Job-26132-JSA.pdf'); const file = receipt(testInfo, 'job-board-source-jsa.pdf'); await download.saveAs(file); const bytes = fs.readFileSync(file); expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  const content = await pdfTexts(bytes); expect(content).toContain('JOB SAFETY ANALYSIS'); expect(content).toContain('Job 26132 Synthetic Site'); expect(content).toContain('Install roof curb'); expect(content).toContain('Guardrails and fall protection'); expect(store.edgeCalls[0]).toEqual({ boardToken: TOKEN, visitToken: VISIT, documentId: DOCUMENT_ID });
  await page.locator('#documentList article').filter({ hasText: 'Morning JSA' }).getByRole('button', { name: 'View', exact: true }).click(); await expect(page.locator('#documentPreview iframe')).toBeVisible(); expect(store.calls.some((c) => c.name === 'log_job_board_activity' && c.args.p_action === 'view-document')).toBe(true); await page.getByRole('button', { name: 'Close', exact: true }).click();
});

test('client email prepares a permanent board document link and logs the action without sending an attachment', async ({ page }) => {
  const store = await open(page, 'client'); await visitorSignIn(page); const cdp = await page.context().newCDPSession(page); await cdp.send('Page.enable'); const navigation = []; cdp.on('Page.frameRequestedNavigation', (event) => navigation.push(event.url));
  await page.locator('#documentList article').filter({ hasText: 'Morning JSA' }).getByRole('button', { name: 'Email link', exact: true }).click(); await expect(page.locator('#boardNotice')).toContainText('Email link prepared');
  expect(store.calls.find((call) => call.name === 'log_job_board_activity' && call.args.p_action === 'email-link').args).toEqual({ p_token: TOKEN, p_visit_token: VISIT, p_action: 'email-link', p_document_id: DOCUMENT_ID }); expect(store.edgeCalls).toHaveLength(0);
  await expect.poll(() => navigation.find((url) => url.startsWith('mailto:'))).toBeTruthy(); const email = new URL(navigation.find((url) => url.startsWith('mailto:'))); const body = email.searchParams.get('body'); expect(body).toContain('/job-board.html?embedded=1#board=' + TOKEN + '&document=' + DOCUMENT_ID); expect(body).not.toContain('/storage/v1/'); expect(body).not.toContain('token=');
});

test('a shared document deep link retains its target through visitor sign-in and highlights it', async ({ page }) => {
  const store = fixture('guest'); await install(page, store); await page.goto('/job-board.html?embedded=1#board=' + TOKEN + '&document=' + DOCUMENT_ID); await expect(page.locator('#visitorGate')).toBeVisible(); await visitorSignIn(page); await expect(page.locator('#documentList [data-document-id="' + DOCUMENT_ID + '"]')).toBeVisible(); await expect(page.locator('.board-document.is-highlighted')).toHaveCount(1); expect(await page.evaluate(() => document.activeElement.dataset.documentId)).toBe(DOCUMENT_ID);
});

test('activity starts collapsed, shows names and Toronto times, and pages with the server cursor', async ({ page }) => {
  const store = fixture('admin'); store.activityPages = Array.from({ length: 51 }, (_, index) => ({ id: 'event-' + index, actor_name: index === 0 ? 'Synthetic Visitor' : 'Synthetic staff', actor_company: 'Synthetic company', actor_email: 'person@example.test', identity_type: index === 0 ? 'visitor' : 'staff', action: index === 0 ? 'email-link' : 'view-document', document_title: 'Morning JSA', created_at: new Date(Date.UTC(2026, 9, 5, 17, 0, 0) - index * 60000).toISOString() })); await install(page, store); await page.goto('/job-board.html?job=existing-estimator-job&manage=1&embedded=1'); await expect(page.locator('#boardContent')).toBeVisible();
  await expect(page.locator('#boardActivity')).not.toHaveAttribute('open', ''); expect(store.calls.filter((c) => c.name === 'get_job_board_activity')).toHaveLength(0);
  await page.locator('#boardActivity summary').click(); await expect(page.locator('#activityList .board-activity-row')).toHaveCount(50); await expect(page.locator('#activityList .board-activity-row').first()).toContainText('Synthetic Visitor'); await expect(page.locator('#activityList .board-activity-row').first()).toContainText('Visitor (self-reported)'); await expect(page.locator('#activityList .board-activity-row').first()).toContainText('Prepared email link'); await expect(page.locator('#activityStatus')).toContainText('Times are in Toronto');
  await page.getByRole('button', { name: 'Load more', exact: true }).click(); await expect(page.locator('#activityList .board-activity-row')).toHaveCount(51); await expect(page.locator('#activityMore')).toBeHidden(); expect(store.calls.filter((c) => c.name === 'get_job_board_activity')[1].args).toEqual({ p_board_id: BOARD_ID, p_before: store.activityPages[49].created_at, p_limit: 50 });
});

test('unavailable board shows a retry and never claims it loaded', async ({ page }) => {
  const store = fixture('guest'); store.failBoard = true; await install(page, store); await page.goto('/job-board.html?embedded=1#board=' + TOKEN); await expect(page.locator('#boardError')).toBeVisible(); await expect(page.locator('#boardContent')).toBeHidden(); store.failBoard = false; await page.getByRole('button', { name: 'Try again', exact: true }).click(); await expect(page.locator('#visitorGate')).toBeVisible(); await expect(page.locator('#boardError')).toBeHidden();
});

test('React Job Board tab opens the matching stable job iframe and accepts its height message', async ({ page }) => {
  const state = directoryState(); await serveDirectory(page, state); const store = fixture('admin'); await install(page, store); await openDirectoryJob(page, '26901'); await page.getByRole('tab', { name: 'Job Board', exact: true }).click();
  const frame = page.getByTitle('Job 26901 Board', { exact: true }); await expect(frame).toBeVisible(); const src = new URL(await frame.getAttribute('src')); expect(src.pathname).toBe('/job-board.html'); expect(src.searchParams.get('job')).toBe('existing-estimator-job'); expect(src.searchParams.get('manage')).toBe('1'); expect(src.searchParams.get('embedded')).toBe('1');
  await expect(page.frameLocator('iframe[title="Job 26901 Board"]').locator('#boardContent')).toBeVisible(); await expect.poll(async () => await frame.evaluate((e) => e.getBoundingClientRect().height)).toBeGreaterThan(1100);
  await page.getByRole('tab', { name: 'Summary', exact: true }).click(); await expect(frame).toBeHidden(); await page.getByRole('tab', { name: 'Job Board', exact: true }).click(); await expect(frame).toBeVisible(); expect(store.calls.filter((c) => c.name === 'get_or_create_job_board')).toHaveLength(1);
});

test('lost successful upload response finalizes the stored original without a duplicate file transfer', async ({ page }) => {
  const store = await open(page, 'staff'); await page.getByRole('tab', { name: 'Upload', exact: true }).click(); await page.getByLabel('Title', { exact: true }).fill('JSA with a lost response'); await page.locator('#uploadFiles').setInputFiles({ name: 'stored-jsa.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\nSynthetic stored file') });
  await page.evaluate(() => { window.fixtureLostResponseTransfers = 0; window.uploadJgcFile = async () => { window.fixtureLostResponseTransfers++; await window.fixtureBoardStorageComplete(); return { error: { message: 'Response lost after file stored' } }; }; });
  await page.locator('#uploadSubmit').click(); await expect(page.locator('#uploadStatus')).toContainText('Response lost after file stored'); expect(store.storageReady).toBe(true); expect(store.calls.filter((c) => c.name === 'finalize_job_board_upload')).toHaveLength(0);
  await page.locator('#uploadSubmit').click(); await expect(page.locator('#uploadStatus')).toContainText('1 file uploaded for office review'); expect(await page.evaluate(() => window.fixtureLostResponseTransfers)).toBe(1); expect(store.calls.filter((c) => c.name === 'begin_job_board_upload')).toHaveLength(1); expect(store.calls.filter((c) => c.name === 'finalize_job_board_upload')).toHaveLength(1);
});

test('an exact 50-event terminal activity page honors the explicit null server cursor', async ({ page }) => {
  const store = fixture('admin'); store.activityPages = Array.from({ length: 50 }, (_, index) => ({ id: 'terminal-' + index, actor_name: 'Synthetic Staff', identity_type: 'staff', action: 'view-document', document_title: 'Site JSA', created_at: new Date(Date.UTC(2026, 9, 5, 16) - index * 60000).toISOString() }));
  await install(page, store); await page.goto('/job-board.html?job=existing-estimator-job&manage=1&embedded=1'); await expect(page.locator('#boardContent')).toBeVisible(); await page.locator('#boardActivity summary').click(); await expect(page.locator('#activityList .board-activity-row')).toHaveCount(50); await expect(page.locator('#activityMore')).toBeHidden(); expect(store.calls.filter((call) => call.name === 'get_job_board_activity')).toHaveLength(1);
});

test('visitor board openings log once per page, reload logs reopening, and management does not log visitor openings', async ({ page }) => {
  const store = await open(page, 'guest'); await visitorSignIn(page);
  const openings = () => store.calls.filter((call) => call.name === 'log_job_board_activity' && call.args.p_action === 'open-board');
  await expect.poll(() => openings().length).toBe(1); expect(openings()[0].args).toEqual({ p_token: TOKEN, p_visit_token: VISIT, p_action: 'open-board', p_document_id: null });
  await page.getByRole('button', { name: 'Refresh', exact: true }).click(); await expect(page.locator('#boardContent')).toBeVisible(); expect(openings()).toHaveLength(1);
  await page.reload(); await expect(page.locator('#boardContent')).toBeVisible(); await expect.poll(() => openings().length).toBe(2); expect(openings()[1].args).toEqual(openings()[0].args); expect(store.calls.filter((call) => call.name === 'register_job_board_visit')).toHaveLength(1);
  store.identity = 'admin'; store.auth = session('admin'); await page.evaluate(async (auth) => { setJgcAuthPersistencePreference(true); sessionStorage.setItem('jgcActiveSession', 'true'); const result = await createJgcSupabaseClient().auth.setSession(auth); if (result.error) throw result.error; }, store.auth); await page.goto('/job-board.html?job=existing-estimator-job&manage=1&embedded=1'); await expect(page.locator('#boardManager')).toBeVisible(); expect(openings()).toHaveLength(2);
});

for (const installed of [false, true]) test(`embedded board wheel scrolls its native job page without iframe height feedback${installed ? ' in installed PWA mode' : ''}`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  if (installed) await page.addInitScript(() => { const original = window.matchMedia.bind(window); window.matchMedia = (query) => { const media = original(query); if (query === '(display-mode: standalone)') Object.defineProperty(media, 'matches', { value: true }); return media; }; });
  await serveDirectory(page, directoryState()); const store = fixture('admin'); await install(page, store);
  await openDirectoryJob(page, '26901'); await page.getByRole('tab', { name: 'Job Board', exact: true }).click();
  const iframe = page.getByTitle('Job 26901 Board', { exact: true }), board = page.frameLocator('iframe[title="Job 26901 Board"]');
  await expect(board.locator('#boardContent')).toBeVisible();
  const samples = [], scrolls = [];
  for (let n = 0; n < 5; n++) { samples.push(await iframe.evaluate((element) => element.getBoundingClientRect().height)); await page.waitForTimeout(100); }
  for (const [tab, target, delta] of [['Documents', '#todayJsaList', 420], ['Upload', '#uploadTitle', 420], ['Review uploads (1)', '#reviewList .board-document-title', 420], ['Documents', '#boardManager', 420], ['Documents', '#boardActivity summary', -420]]) {
    await board.getByRole('tab', { name: tab, exact: true }).click(); await board.locator(target).first().hover();
    const before = { parentY: await page.evaluate(() => scrollY), child: await board.locator('body').evaluate(() => ({ y: scrollY, height: innerHeight, bodyHeight: document.body.scrollHeight, minHeight: getComputedStyle(document.body).minHeight, overscroll: getComputedStyle(document.documentElement).overscrollBehaviorY })) };
    await page.mouse.wheel(0, delta); await page.waitForTimeout(180);
    const after = { parentY: await page.evaluate(() => scrollY), child: await board.locator('body').evaluate(() => ({ y: scrollY, height: innerHeight, bodyHeight: document.body.scrollHeight })) };
    scrolls.push({ tab, target, delta, before, after });
  }
  const observation = { samples, scrolls }; console.log('Board wheel observation: ' + JSON.stringify(observation));
  fs.writeFileSync(receipt(testInfo, `embedded-wheel${installed ? '-installed' : ''}-observation.json`), JSON.stringify(observation, null, 2));
  await page.screenshot({ path: receipt(testInfo, `embedded-wheel${installed ? '-installed' : ''}-desktop.png`), fullPage: false });
  for (const { tab, delta, before, after } of scrolls) { expect((after.parentY - before.parentY) * Math.sign(delta), tab + ' wheel moves the surrounding job page').toBeGreaterThan(100); expect(after.child.y).toBe(0); expect(after.child.bodyHeight).toBeLessThanOrEqual(after.child.height + 1); }
  expect(Math.max(...samples) - Math.min(...samples)).toBeLessThan(8);
  expect(scrolls.find((item) => item.tab === 'Review uploads (1)').after.child.height).toBeLessThan(samples[0] - 200);
});

async function openNativeBoard(page, theme = 'light') {
  const directory = serveDirectory(page, directoryState());
  if (page.viewportSize().width <= 760) await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await directory; const store = fixture('admin');
  await install(page, store, { theme: theme === 'light' ? 'dark' : 'light' });
  await page.evaluate((theme) => {
    localStorage.setItem('currentWorker', 'synthetic site staff'); localStorage.setItem('currentWorkerDisplay', 'Synthetic Site Staff');
    localStorage.setItem('currentUserRole', 'admin'); localStorage.setItem('currentAccountStatus', 'approved');
    // The active parent can differ from a stale device cache; the iframe must use the parent.
    localStorage.setItem('jgcPortalTheme', theme === 'light' ? 'dark' : 'light'); applyJgcTheme(theme);
  }, theme);
  await openDirectoryJob(page, '26901'); await page.getByRole('tab', { name: 'Job Board', exact: true }).click();
  const iframe = page.getByTitle('Job 26901 Board', { exact: true }), board = page.frameLocator('iframe[title="Job 26901 Board"]');
  await expect(board.locator('#boardContent')).toBeVisible(); await expect(board.locator('html')).toHaveAttribute('data-jgc-theme', theme);
  return { store, iframe, board };
}

for (const theme of ['light', 'dark']) for (const width of [390, 1440]) test(`native embedded job tab preserves parent chrome and fills the content area ${theme} ${width}`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 1000 }); const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  const { store, iframe, board } = await openNativeBoard(page, theme);
  await expect(board.locator('html')).toHaveAttribute('data-job-board-host', 'job');
  for (const selector of ['.board-header', '.board-header .jgc-brand', '#boardTitle', '#boardTheme', '#boardSignIn', '#boardIdentity', '.board-footer']) await expect(board.locator(selector)).toBeHidden();
  await expect(board.locator('#jgcAppearanceSettings,#jgcAdminGlobalSearch,#jgcNotificationBell,#jgcGlobalTopNav,#jgcMobileBottomNav,#jgcPageBar,#jgcPwaPullIndicator')).toHaveCount(0);
  await expect(board.locator('#boardToolbar')).toBeVisible(); await expect(board.getByRole('button', { name: 'Refresh', exact: true })).toHaveCount(1);
  const layout = await board.locator('body').evaluate(() => { const shell = document.getElementById('jobBoardPage').getBoundingClientRect(); return { minHeight: getComputedStyle(document.body).minHeight, background: getComputedStyle(document.body).backgroundColor, shellLeft: shell.left, shellWidth: shell.width, width: innerWidth, scrollWidth: document.documentElement.scrollWidth, text: document.body.innerText }; });
  expect(layout.minHeight).toBe('0px'); expect(layout.background).toBe('rgba(0, 0, 0, 0)'); expect(layout.shellLeft).toBe(0); expect(layout.shellWidth).toBeCloseTo(layout.width, 0); expect(layout.scrollWidth).toBeLessThanOrEqual(layout.width + 1); expect(layout.text).not.toMatch(/â€™|â€¦|Â·|\uFFFD/);
  // Compare resolved colours on real controls/cards to the native Desk tokens.
  const desk = await page.evaluate(() => {
    const native = getComputedStyle(document.documentElement), probe = document.createElement('div');
    const resolve = (property, token) => { probe.style[property] = native.getPropertyValue(token).trim(); document.body.append(probe); const value = getComputedStyle(probe)[property]; probe.remove(); return value; };
    return { surface: resolve('backgroundColor', '--jgc-estimator-surface'), text: resolve('color', '--jgc-estimator-slate-900'), heading: resolve('color', '--jgc-estimator-navy-900'), font: resolve('fontFamily', '--jgc-estimator-font-family') };
  });
  const rendered = await board.locator('#policyList article').evaluate((card) => {
    const policy = getComputedStyle(card), panel = getComputedStyle(card.closest('.jgc-panel')), heading = getComputedStyle(document.getElementById('policyTitle')), selectedTab = getComputedStyle(document.querySelector('.jgc-tab[aria-selected="true"]')), action = getComputedStyle(card.querySelector('button'));
    return { cardSurface: policy.backgroundColor, panelSurface: panel.backgroundColor, text: policy.color, font: policy.fontFamily, size: policy.fontSize, heading: heading.color, selectedTab: selectedTab.backgroundColor, actionSize: action.fontSize, actionRadius: action.borderRadius };
  });
  fs.writeFileSync(receipt(testInfo, `embedded-${theme}-${width}-style-observation.json`), JSON.stringify({ desk, rendered }, null, 2));
  expect(desk.surface).toBe('rgb(255, 255, 255)'); expect(rendered.cardSurface).toBe(desk.surface); expect(rendered.panelSurface).toBe(desk.surface); expect(rendered.text).toBe(desk.text); expect(rendered.font).toBe(desk.font); expect(rendered.size).toBe('14px'); expect(rendered.heading).toBe(desk.heading); expect(rendered.selectedTab).toBe(desk.heading); expect(rendered.actionSize).toBe('14px'); expect(rendered.actionRadius).toBe('6px');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
  await page.evaluate(() => scrollTo(0, 0)); await page.screenshot({ path: receipt(testInfo, `embedded-${theme}-${width}-documents.png`), fullPage: true });
  await board.getByRole('button', { name: 'Refresh', exact: true }).click(); await expect(board.locator('#boardContent')).toBeVisible(); expect(store.calls.filter((call) => call.name === 'get_or_create_job_board')).toHaveLength(2);
  await board.getByRole('tab', { name: 'Upload', exact: true }).click();
  const input = await board.locator('#uploadTitle').evaluate((element) => { const style = getComputedStyle(element); return { font: style.fontFamily, size: style.fontSize, radius: style.borderRadius }; }); expect(input).toEqual({ font: desk.font, size: '14px', radius: '6px' });
  await page.evaluate(() => scrollTo(0, 0)); await page.screenshot({ path: receipt(testInfo, `embedded-${theme}-${width}-upload.png`), fullPage: true });
  await expect.poll(async () => Math.abs(await iframe.evaluate((element) => element.getBoundingClientRect().height) - await board.locator('#jobBoardPage').evaluate((element) => Math.ceil(element.getBoundingClientRect().height)))).toBeLessThan(2);
  expect(errors).toEqual([]);
});

test('parent theme changes and job-tab hiding preserve upload files and review drafts without reloading the board', async ({ page }) => {
  const { store, iframe, board } = await openNativeBoard(page, 'light');
  await board.locator('body').evaluate(() => { window.embeddedBoardMarker = 'same-document'; });
  await board.getByRole('tab', { name: 'Upload', exact: true }).click(); await board.locator('#uploadTitle').fill('Unsaved paper JSA draft'); await board.locator('#uploadNotes').fill('Keep these field notes'); await board.locator('#uploadFiles').setInputFiles({ name: 'unsaved-jsa.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\nUnsaved synthetic paper') });
  await page.evaluate(() => applyJgcTheme('dark')); await expect(board.locator('html')).toHaveAttribute('data-jgc-theme', 'dark'); await expect(board.locator('#uploadTitle')).toHaveValue('Unsaved paper JSA draft'); expect(await board.locator('#uploadFiles').evaluate((element) => element.files.length)).toBe(1);
  await board.getByRole('tab', { name: 'Review uploads (1)', exact: true }).click(); await board.locator('#reviewList').getByLabel('Title', { exact: true }).fill('Unsaved office review draft');
  await page.getByRole('tab', { name: 'Summary', exact: true }).click(); await expect(iframe).toBeHidden(); await page.evaluate(() => applyJgcTheme('light')); await expect(board.locator('html')).toHaveAttribute('data-jgc-theme', 'light');
  await page.getByRole('tab', { name: 'Job Board', exact: true }).click(); await expect(iframe).toBeVisible(); await expect(board.locator('#reviewList').getByLabel('Title', { exact: true })).toHaveValue('Unsaved office review draft');
  await board.getByRole('tab', { name: 'Upload', exact: true }).click(); await expect(board.locator('#uploadTitle')).toHaveValue('Unsaved paper JSA draft'); await expect(board.locator('#uploadNotes')).toHaveValue('Keep these field notes'); expect(await board.locator('#uploadFiles').evaluate((element) => element.files.length)).toBe(1);
  expect(await board.locator('body').evaluate(() => window.embeddedBoardMarker)).toBe('same-document'); expect(store.calls.filter((call) => call.name === 'get_or_create_job_board')).toHaveLength(1); expect(store.calls.filter((call) => call.name === 'begin_job_board_upload' || call.name === 'update_job_board_document')).toHaveLength(0);
});

test('embedded board height grows and shrinks with activity, imports and inner tabs, then remains stable when reopened', async ({ page }, testInfo) => {
  const { store, iframe, board } = await openNativeBoard(page);
  store.activityPages = Array.from({ length: 20 }, (_, index) => ({ id: 'resize-' + index, actor_name: 'Synthetic Visitor', actor_company: 'Synthetic Client', identity_type: 'visitor', action: 'view-document', document_title: 'Morning JSA', created_at: new Date(Date.UTC(2026, 9, 5, 17) - index * 60000).toISOString() }));
  store.sources = Array.from({ length: 10 }, (_, index) => ({ source_type: 'inspection_records', source_id: 'resize-source-' + index, title: 'Existing matched JSA ' + index, category: 'jsa', report_date: previousDate, match: 'job-number' }));
  const height = () => iframe.evaluate((element) => element.getBoundingClientRect().height);
  await expect.poll(async () => Math.abs(await height() - await board.locator('#jobBoardPage').evaluate((element) => Math.ceil(element.getBoundingClientRect().height)))).toBeLessThan(2); const initial = await height();
  await board.locator('#boardActivity summary').click(); await expect(board.locator('#activityList .board-activity-row')).toHaveCount(20); await expect.poll(height).toBeGreaterThan(initial + 600); const activityExpanded = await height();
  await board.locator('#boardActivity summary').click(); await expect.poll(height).toBeLessThan(initial + 2);
  await board.getByRole('tab', { name: 'Review uploads (1)', exact: true }).click(); await expect.poll(height).toBeLessThan(initial - 200); const shorter = await height();
  await board.locator('#boardImport summary').click(); await expect(board.locator('#importList .board-viewer')).toHaveCount(10); await expect.poll(height).toBeGreaterThan(shorter + 500); const importExpanded = await height();
  await board.locator('#boardImport summary').click(); await expect.poll(height).toBeLessThan(shorter + 2);
  const reopened = [];
  for (let n = 0; n < 3; n++) { await page.getByRole('tab', { name: 'Summary', exact: true }).click(); await expect(iframe).toBeHidden(); await page.getByRole('tab', { name: 'Job Board', exact: true }).click(); await expect(iframe).toBeVisible(); await expect.poll(height).toBeLessThan(shorter + 2); reopened.push(await height()); }
  expect(Math.max(...reopened) - Math.min(...reopened)).toBeLessThan(2); expect(store.calls.filter((call) => call.name === 'get_or_create_job_board')).toHaveLength(1);
  fs.writeFileSync(receipt(testInfo, 'embedded-height-lifecycle.json'), JSON.stringify({ initial, activityExpanded, importExpanded, shorter, reopened }, null, 2));
});

for (const width of [390, 1440]) test(`standalone QR visitor page keeps branding and appearance/sign-in controls with embedded query ${width}`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 1000 }); await open(page, 'guest', { theme: 'light' });
  await expect(page.locator('html')).not.toHaveAttribute('data-job-board-host', 'job'); await expect(page.locator('.board-header .jgc-brand img')).toBeVisible(); await expect(page.locator('#boardTitle')).toBeVisible(); await expect(page.locator('#boardTheme')).toBeVisible(); await expect(page.locator('#boardSignIn')).toBeVisible(); await expect(page.locator('#boardToolbar')).toBeHidden();
  await page.getByLabel('Your name', { exact: true }).fill('Unsubmitted visitor draft'); await page.getByRole('button', { name: 'Switch colour theme', exact: true }).click(); await expect(page.locator('html')).toHaveAttribute('data-jgc-theme', 'dark'); await expect(page.getByLabel('Your name', { exact: true })).toHaveValue('Unsubmitted visitor draft');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1); await page.screenshot({ path: receipt(testInfo, `standalone-qr-${width}.png`), fullPage: true });
});

test('current company policy stays pinned while document search, category, date and JSA history filters change', async ({ page }) => {
  const { board } = await openNativeBoard(page);
  const policy = board.locator('#policyList article'); await expect(policy).toHaveCount(1); await expect(policy).toContainText('JGC Health & Safety Policy'); await expect(policy).toContainText('Company policy'); await expect(policy.locator('.board-document-edit')).toHaveCount(0);
  await board.getByLabel('Search documents').fill('no matching report'); await board.locator('#documentCategory').selectOption('inspection'); await board.locator('#documentDate').fill('2020-01-01'); await expect(board.locator('#documentList')).toContainText('No documents match'); await expect(policy).toBeVisible();
  await board.getByRole('button', { name: 'JSA history', exact: true }).click(); await expect(board.locator('#documentList article')).toHaveCount(2); await expect(policy).toBeVisible(); await expect(policy.getByRole('button', { name: 'View', exact: true })).toBeVisible(); await expect(policy.getByRole('button', { name: 'Download', exact: true })).toBeVisible(); await expect(policy.getByRole('button', { name: 'Email link', exact: true })).toBeVisible();
});

test('mobile View opens the authorized saved JSA as a full PDF tab instead of the preview dialog', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 }); const store = await open(page, 'staff');
  const pending = page.waitForEvent('popup'); await page.locator('#documentList article').filter({ hasText: 'Morning JSA' }).getByRole('button', { name: 'View', exact: true }).click(); const viewer = await pending; await viewer.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => viewer.url(), { timeout: 10000 }).toMatch(/^blob:http:\/\/127\.0\.0\.1:/); await expect(page.locator('#documentPreview')).not.toHaveAttribute('open', ''); await expect(page.locator('#documentPreview iframe')).toHaveCount(0);
  const bytes = Buffer.from(await page.evaluate(async (url) => Array.from(new Uint8Array(await (await fetch(url)).arrayBuffer())), viewer.url())); expect(bytes.subarray(0, 5).toString()).toBe('%PDF-'); const content = await pdfTexts(bytes); expect(content).toContain('JOB SAFETY ANALYSIS'); expect(content).toContain('Install roof curb'); expect(content).toContain('Guardrails and fall protection');
  expect(store.edgeCalls).toEqual([{ boardToken: TOKEN, visitToken: VISIT, documentId: DOCUMENT_ID }]); expect(store.calls.find((call) => call.name === 'log_job_board_activity' && call.args.p_action === 'view-document').args).toEqual({ p_token: TOKEN, p_visit_token: VISIT, p_action: 'view-document', p_document_id: DOCUMENT_ID }); expect(await viewer.evaluate(() => window.opener)).toBeNull();
  fs.writeFileSync(receipt(testInfo, 'mobile-view-source-jsa.pdf'), bytes); await viewer.screenshot({ path: receipt(testInfo, 'mobile-full-pdf-view.png') }); await viewer.close();
});

test('mobile View closes its reserved blank tab on an access failure and opens the PDF on retry', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); const store = await open(page, 'staff'); store.failDocument = true;
  const view = page.locator('#documentList article').filter({ hasText: 'Morning JSA' }).getByRole('button', { name: 'View', exact: true }); let pending = page.waitForEvent('popup'); await view.click(); const failed = await pending;
  await expect.poll(() => failed.isClosed()).toBe(true); await expect(page.locator('#boardNotice')).toContainText('Synthetic document unavailable'); await expect(view).toBeEnabled(); await expect(page.locator('#documentPreview')).not.toHaveAttribute('open', '');
  store.failDocument = false; pending = page.waitForEvent('popup'); await view.click(); const recovered = await pending; await expect.poll(() => recovered.url(), { timeout: 10000 }).toMatch(/^blob:/); expect(store.edgeCalls).toHaveLength(2); await recovered.close();
});
