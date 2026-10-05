const { test, expect } = require('@playwright/test');
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
    { id: '00000000-0000-4000-8000-000000000003', title: 'JGC Health & Safety Policy', category: 'jgc-policy', report_date: previousDate, file_name: 'Policy.pdf', mime_type: 'application/pdf', status: 'published', visibility: 'public', source_type: 'policies', source_id: 'policy-source' },
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
    if (url.pathname === '/functions/v1/jgc-job-board-document') { store.edgeCalls.push(req.postDataJSON()); return route.fulfill({ json: { sourcePayload: sourceJsa(), fileName: 'Job-26132-JSA.pdf', mimeType: 'application/pdf' } }); }
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
