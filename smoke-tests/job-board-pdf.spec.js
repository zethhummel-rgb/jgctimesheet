const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const project = '26999 - Synthetic Job Board Site';
const id = '00000000-0000-4000-8000-000000000974';

async function exporter(page) {
  await page.setContent('<!doctype html><title>Isolated Job Board PDF exercise</title>');
  await page.addScriptTag({ path: path.join(ROOT, 'vendor/jspdf.umd.min.js') });
  await page.evaluate(() => { window.loadJgcScriptOnce = async () => {}; });
  await page.addScriptTag({ path: path.join(ROOT, 'job-board-report-pdf.js') });
}

async function createPdf(page, testInfo, source_type, record, fileName) {
  const bytes = await page.evaluate(async payload => Array.from(new Uint8Array(await (await window.JGCJobBoardPdf.create(payload)).arrayBuffer())), { source_type, record });
  const output = testInfo.outputPath(fileName);
  fs.writeFileSync(output, Buffer.from(bytes));
  if (process.env.JGC_JOB_BOARD_PDF_DIR) {
    fs.mkdirSync(process.env.JGC_JOB_BOARD_PDF_DIR, { recursive: true });
    fs.writeFileSync(path.join(process.env.JGC_JOB_BOARD_PDF_DIR, fileName), Buffer.from(bytes));
  }
  await testInfo.attach(fileName, { path: output, contentType: 'application/pdf' });
  const pdfjs = await import(pathToFileURL(path.join(ROOT, 'estimating-app/node_modules/pdfjs-dist/legacy/build/pdf.mjs')).href);
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), disableWorker: true, standardFontDataUrl: path.join(ROOT, 'estimating-app/node_modules/pdfjs-dist/standard_fonts').replaceAll('\\', '/') + '/' });
  const document = await task.promise;
  const pages = [];
  for (let i = 1; i <= document.numPages; i++) {
    const page = await document.getPage(i);
    const content = await page.getTextContent();
    pages.push({ text: content.items.map(item => item.str).join(' '), items: content.items.filter(item => item.str.trim()).map(item => ({ text: item.str, x: item.transform[4], y: item.transform[5], width: item.width })) });
  }
  if (typeof task.destroy === 'function') await task.destroy();
  return { pages, text: pages.map(page => page.text).join('\n'), output };
}

function brandedAndBounded(pdf, title) {
  expect(pdf.pages.length).toBeGreaterThan(0);
  pdf.pages.forEach((page, index) => {
    expect(page.text).toContain('JOHN GORDON CONSTRUCTION');
    expect(page.text).toContain(title);
    expect(page.text).toContain(`Page ${index + 1} of ${pdf.pages.length}`);
    expect(page.items.every(item => item.x >= 39 && item.x + item.width <= 576 && item.y >= 25 && item.y <= 764), 'All printed text fits letter page margins and footer').toBe(true);
  });
}

test.beforeEach(async ({ page }) => exporter(page));

test('toolbox PDF preserves the saved discussion, controls and crew names', async ({ page }, testInfo) => {
  const record = { id, report_date: '2026-10-05', project, location: 'East work area', talk_title: 'Synthetic ladder safety', presenter_name: 'Synthetic Presenter', submitted_by_name: 'Synthetic Submitter', crew: [{ workerName: 'internal-worker-key', displayName: 'Synthetic Crew Member', company: 'Synthetic Trade', email: 'not-for-pdf@example.com' }], discussion_notes: 'Three points of contact when climbing.', hazards_discussed: 'Uneven supporting surface.', corrective_actions: 'Inspect feet before use.' };
  const pdf = await createPdf(page, testInfo, 'toolbox_talk_reports', record, 'toolbox-talk.pdf');
  brandedAndBounded(pdf, 'TOOLBOX TALK REPORT');
  [project, 'Synthetic ladder safety', 'Synthetic Presenter', 'Synthetic Submitter', 'Synthetic Crew Member', 'Synthetic Trade', record.discussion_notes, record.hazards_discussed, record.corrective_actions].forEach(value => expect(pdf.text).toContain(value));
  expect(pdf.text).not.toContain('internal-worker-key');
  expect(pdf.text).not.toContain('not-for-pdf@example.com');
});

test('daily PDF preserves all saved sections and identifies photo files', async ({ page }, testInfo) => {
  const record = { id, report_date: '2026-10-05', project, worker_display_name: 'Synthetic Reporter', weather: 'Clear, 12 C', crew: 'Four installers', work_completed: 'Installed east wall framing.', deliveries: 'Stud bundle delivered.', visitors: 'Client representative visited.', delays: 'Thirty minute delivery delay.', photos: [{ name: 'framing-photo.jpg', type: 'image/jpeg', size: 1200 }] };
  const pdf = await createPdf(page, testInfo, 'daily_site_reports', record, 'daily-site-report.pdf');
  brandedAndBounded(pdf, 'DAILY SITE REPORT');
  [project, record.worker_display_name, record.weather, record.crew, record.work_completed, record.deliveries, record.visitors, record.delays, 'framing-photo.jpg'].forEach(value => expect(pdf.text).toContain(value));
});

test('incident PDF preserves every report section and renders booleans', async ({ page }, testInfo) => {
  const record = { id, report_date: '2026-10-05', project, reported_by_name: 'Synthetic Investigator', incident_type: 'Near miss', severity: 'Low', incident_time: '10:15', location: 'South entrance', people_involved: 'Synthetic Individual', witnesses: 'Synthetic Witness', description: 'A loose piece fell within the barricaded work area.', immediate_action: 'Work stopped and area inspected.', injury_details: 'No injury.', property_damage_details: 'No damage.', environmental_details: 'No spill.', follow_up_required: true, follow_up_notes: 'Review the barricade before the next shift.', photos: [{ name: 'barricade-photo.png', type: 'image/png', size: 1200, path: 'private-source-uuid/01-barricade-photo.png' }] };
  const pdf = await createPdf(page, testInfo, 'incident_reports', record, 'incident-report.pdf');
  brandedAndBounded(pdf, 'INCIDENT / NEAR MISS REPORT');
  Object.entries(record).filter(([key]) => !['id', 'photos', 'follow_up_required'].includes(key)).forEach(([, value]) => expect(pdf.text).toContain(value));
  expect(pdf.text.replace(/\s+/g, ' ')).toContain('Follow-up required Yes');
  expect(pdf.text).toContain('barricade-photo.png');
  expect(pdf.text).not.toContain('private-source-uuid');
  expect(pdf.text).not.toContain('image/png');
});

for (const inspection_type of ['Hot Work Permit', 'Fork Lift']) {
  test(`${inspection_type} PDF retains saved form answers and every checklist cell`, async ({ page }, testInfo) => {
    const record = { id, inspection_date: '2026-10-05', inspection_type, worker_display_name: 'Synthetic Inspector', form_data: { job_context: { project }, fields: [{ label: 'Location / Building / Floor', value: 'Synthetic workshop / First floor' }, { label: 'Permit Authorizing Individual', value: 'Synthetic Supervisor' }, { label: 'Fire watch required', value: 'Yes' }], rows: [{ table: 1, cells: ['Portable extinguishers available', 'Checked', 'Synthetic comment'] }, { table: 1, cells: ['Equipment inspected', 'Pass', 'No defects found'] }] } };
    const pdf = await createPdf(page, testInfo, 'inspection_records', record, inspection_type === 'Fork Lift' ? 'inspection.pdf' : 'hot-work-permit.pdf');
    brandedAndBounded(pdf, 'INSPECTION / PERMIT REPORT');
    [project, inspection_type, record.worker_display_name, ...record.form_data.fields.flatMap(field => [field.label, field.value]), ...record.form_data.rows.flatMap(row => row.cells)].forEach(value => expect(pdf.text).toContain(value));
  });
}

test('long multipage daily PDF preserves the first and last lines without text overflow', async ({ page }, testInfo) => {
  const lines = Array.from({ length: 150 }, (_, i) => `LOG-${String(i + 1).padStart(3, '0')} Synthetic daily field record: reviewed the safe work area, installed the specified item, and documented the completed work.`);
  const record = { id, report_date: '2026-10-05', project, worker_display_name: 'Synthetic Reporter', weather: 'Clear', crew: 'Synthetic crew', work_completed: lines.join('\n'), deliveries: 'FINAL-DELIVERY received.', visitors: 'FINAL-VISITOR recorded.', delays: 'FINAL-DELAY recorded.', photos: [] };
  const pdf = await createPdf(page, testInfo, 'daily_site_reports', record, 'long-daily-site-report.pdf');
  brandedAndBounded(pdf, 'DAILY SITE REPORT');
  expect(pdf.pages.length).toBeGreaterThanOrEqual(5);
  const bodyText = pdf.pages.flatMap(page => page.items.filter(item => item.y >= 50 && item.y <= 700).map(item => item.text)).join(' ').replace(/\s+/g, ' ');
  lines.forEach(line => expect(bodyText).toContain(line));
  ['FINAL-DELIVERY received.', 'FINAL-VISITOR recorded.', 'FINAL-DELAY recorded.'].forEach(value => expect(pdf.text).toContain(value));
  expect(pdf.text.replace(/\s+/g, ' ')).toContain('Photo files None recorded');
});

test('unsupported or missing snapshots reject instead of producing a misleading report', async ({ page }) => {
  const errors = await page.evaluate(async () => {
    const errors = [];
    for (const payload of [{ source_type: 'unknown', record: {} }, { source_type: 'daily_site_reports', record: null }]) {
      try { await window.JGCJobBoardPdf.create(payload); errors.push('unexpected success'); } catch (error) { errors.push(error.message); }
    }
    return errors;
  });
  expect(errors).toEqual(['This report format is unavailable.', 'The saved report is unavailable.']);
});
