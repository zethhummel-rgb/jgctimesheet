const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const { test, expect } = require('@playwright/test');
const root = path.resolve(__dirname, '..');

function fixture(kind = 'complete') {
  const b = {
    wo: { id: 'wo-style-fixture', wo_number: 'WO26142-007', work_order_date: '2026-10-07', customer: 'Cornwall Electric', customer_po_number: 'CE-4728', job_number: '26142', job_name: 'New Control Room - Washroom Facilities', job_address: '1001 Sydney Street, Cornwall, Ontario', supervisor_name: 'Alex Morgan', description_of_work: 'Installed framing and access panels.\nReviewed work areas with the client.', notes: 'Protect completed finishes.\nReturn unused materials to the shop.' },
    labour: [{ employee_name: 'Alex Morgan', hours: 8 }, { employee_name: 'Jordan Singh', hours: 7.5 }],
    pos: [{ po_number: 'PO-4729', company_name: 'Building Supply', notes: 'Framing and fasteners' }],
    digitalPos: [{ po_number: 31014, supplier_name: 'Electrical Supply', order_date: '2026-10-07', material_count: 3, workflow_status: 'submitted' }],
    materials: [{ purchased_from: 'JGC Shop', material_description: 'Galvanized angle brackets', quantity: 12 }],
    misc: [{ invoice_name: 'ABC Mechanical - invoice 8401' }],
    travel: [{ vehicle_name: 'White F-150', identification_number: 'BD48405', total_km: 42, trailer_used: true, trailer_name: 'Utility Trailer', trailer_identification_number: 'TR-02' }],
    equipment: [{ equipment_name: 'Scissor Lift', identification_number: 'SL-11', transportation_required: true }],
    rentals: [{ rental_equipment_description: 'Portable generator', po_number: 'PO-4730', rental_company: 'Tool Rental', quantity: 1, hours_used: 6, days_used: 1, notes: 'Delivery and pickup included' }]
  };
  if (kind === 'empty') { for (const k of Object.keys(b)) if (k !== 'wo') b[k] = []; b.wo.notes = ''; b.wo.description_of_work = ''; }
  if (kind === 'long') {
    b.labour = Array.from({length: 45}, (_, i) => ({ employee_name: `Worker ${i + 1} - long employee name for print verification`, hours: 7.5 }));
    b.rentals[0].notes = 'Maintain clear access for the delivery truck; confirm collection with the site supervisor. '.repeat(4);
    b.wo.notes = 'Multi-page note: ' + 'Protect completed finishes and keep emergency access clear. '.repeat(45);
  }
  if (kind === 'escaped') { b.wo.customer = 'A&B <Contractor>'; b.wo.description_of_work = '<script>not executable</script> & "quoted"'; b.rentals[0].notes = 'REFERENCE'.repeat(35); }
  return b;
}
function render(source, edge, b, withoutBranding = false) {
  const code = source.slice(source.indexOf('function buildPdfRows('), source.indexOf('\nfunction buildWorkOrderEmailBody('));
  const c = vm.createContext({getWorkOrderBundle: () => b, URL, window: {location: {href: 'http://127.0.0.1:41806/work-orders.html'}},
    escapeHtml: v => String(v ?? '').replace(/[&<>"']/g, x => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x])),
    moneylessNumber: v => Number.isFinite(Number(v || 0)) ? Number(v || 0).toFixed(2) : '0.00',
    formatDigitalPoNumber: v => 'PO-' + String(v || '').replace(/^PO-/i, ''),
    getStatusLabel: v => String(v || 'draft').replace(/\b\w/g, x => x.toUpperCase())});
  vm.runInContext(fs.readFileSync(path.join(root, 'work-order-pdf-branding.js'), 'utf8'), c);
  if (withoutBranding) delete c.JgcWorkOrderPdfBranding;
  vm.runInContext(edge ? stripTypeScriptTypes(code) : code, c);
  return c.buildWorkOrderPdfHtml(edge ? b : b.wo.id);
}

for (const edge of [false, true]) for (const kind of ['complete', 'empty', 'long', 'escaped']) {
  test(`Work Order ${edge ? 'automatic email' : 'browser'} PDF preserves content and prints ${kind}`, async ({ page }) => {
    const rel = edge ? 'supabase/functions/auto-submit-work-orders/index.ts' : 'work-orders.html';
    const b = fixture(kind);
    const source = fs.readFileSync(path.join(root, rel), 'utf8');
    const html = render(source, edge, b);
    await page.setContent(html);
    const logo = page.locator('.brand img');
    await expect(logo).toBeVisible();
    expect(await logo.evaluate(e => e.complete && e.naturalWidth > 0)).toBe(true);
    await expect(page.locator('.summary b')).toHaveText(['WO Number', 'Date', 'Attention', 'Customer PO #', 'Job Number', 'Job Name', 'Job Address', 'Supervisor']);
    const summaryValues = await page.locator('.summary > div').evaluateAll(es => es.map(e => [...e.childNodes].filter(n => n.nodeType === Node.TEXT_NODE).map(n => n.textContent).join('')));
    expect(summaryValues).toEqual([b.wo.wo_number, b.wo.work_order_date, b.wo.customer, b.wo.customer_po_number, b.wo.job_number, b.wo.job_name, b.wo.job_address, b.wo.supervisor_name]);
    await expect(page.locator('.description').first()).toHaveText(b.wo.description_of_work);
    await expect(page.locator('.line')).toHaveText(['Supervisor Signature', 'Client Signature']);
    if (kind === 'empty') {
      await expect(page.locator('h2')).toHaveText(['Description of Work Completed Today', 'Labour']);
      await expect(page.locator('table .empty')).toHaveText('No labour rows entered.');
      await expect(page.locator('.totals')).toHaveText('Total Labour Hours0.00');
    } else {
      await expect(page.locator('h2')).toHaveText(['Description of Work Completed Today', 'Labour', edge ? 'Purchase Orders' : 'Paper / Manual Purchase Orders', 'Digital Purchase Orders', 'Materials Used From Shop', 'Misc. Invoices and Sub Contractors', 'Travelling', 'Equipment Used', 'Rental Equipment', 'Notes']);
      const cells = await page.locator('table').evaluateAll(es => es.map(e => [...e.querySelectorAll('tr')].map(tr => [...tr.children].map(td => td.textContent))));
      expect(cells).toEqual([
        [['Employee','Hours'], ...b.labour.map(r => [r.employee_name, Number(r.hours).toFixed(2)]), ['Total Labour Hours', b.labour.reduce((n,r)=>n+r.hours,0).toFixed(2)]],
        [['PO Number','Company','Notes'], ['PO-4729','Building Supply','Framing and fasteners']],
        [['Digital PO','Supplier','PO Date','Materials','Status'], ['PO-31014','Electrical Supply','2026-10-07','3','Submitted']],
        [['Shop','Material Description','Quantity'], ['JGC Shop','Galvanized angle brackets','12']],
        [['Name'], ['ABC Mechanical - invoice 8401']],
        [['Vehicle','Identification #','Total KM','Trailer','Trailer ID #'], ['White F-150','BD48405','42','Utility Trailer','TR-02']],
        [['Lift','Identification #','Floated By Tow Truck'], ['Scissor Lift','SL-11','Yes']],
        [['Rental Equipment','PO #','Company','Quantity','Hours','Days','Notes'], ['Portable generator','PO-4730','Tool Rental','1','6','1',b.rentals[0].notes]]
      ]);
      await expect(page.locator('.description').last()).toHaveText(b.wo.notes);
    }
    await page.emulateMedia({media:'print'});
    await page.setViewportSize({width:720,height:960});
    expect(await page.evaluate(() => document.body.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    if (process.env.JGC_WO_PDF_QA_DIR) {
      fs.mkdirSync(process.env.JGC_WO_PDF_QA_DIR, { recursive:true });
      const name = `${edge ? 'automatic' : 'browser'}-${kind}`;
      await page.pdf({path:path.join(process.env.JGC_WO_PDF_QA_DIR,name+'.pdf'),preferCSSPageSize:true,printBackground:true});
      const before = path.join(process.env.JGC_WO_PDF_QA_DIR,edge ? 'before-auto.ts' : 'before-work-orders.html');
      const text = await page.locator('body').textContent();
      await page.setContent(render(fs.readFileSync(before,'utf8'),edge,b));
      expect((await page.locator('body').textContent()).replace(/\s+/g,' ').trim()).toBe(text.replace(/\s+/g,' ').trim());
      if (kind === 'complete') await page.pdf({path:path.join(process.env.JGC_WO_PDF_QA_DIR,name+'-before.pdf'),preferCSSPageSize:true,printBackground:true});
    }
  });
}

test('Work Order PDF still opens when the branding script is unavailable', async ({ page, baseURL }) => {
  const b = fixture();
  const source = fs.readFileSync(path.join(root, 'work-orders.html'), 'utf8');
  const html = render(source, false, b, true).replaceAll('http://127.0.0.1:41806', baseURL);
  await page.setContent(html);
  await expect(page.locator('.brand img')).toBeVisible();
  await expect.poll(() => page.locator('.brand img').evaluate(e => e.naturalWidth)).toBeGreaterThan(0);
  await expect(page.locator('.summary')).toContainText(b.wo.wo_number);
  await expect(page.locator('h2')).toHaveCount(10);
  await expect(page.locator('.line')).toHaveText(['Supervisor Signature', 'Client Signature']);
});
