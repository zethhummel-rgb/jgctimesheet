const { test, expect } = require("@playwright/test");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { directoryState, serveDirectory } = require("./fixtures/job-readability-fixture");

function previewState() {
  const state = directoryState();
  state.clients[0].sites = [{ id: "saved-site", label: "Brockville Station", address: "100 Station Road" }];
  state.clients[0].contacts = [{ id: "saved-contact", name: "Avery Buyer", email: "avery@example.com", phone: "613-555-0100", role: "Facilities" }];
  state.quotes[0].customerPo = "WO-100";
  state.jobs[0].acceptedQuoteSnapshot = JSON.stringify(state.quotes[0]);
  state.quotes.push({ ...state.quotes[0], id: "finished-preview-quote", number: "JGC-Q-2026-0905", status: "Finished", revisions: [],
    project: "Sump pump inspections", site: "Brockville Station", address: "100 Station Road", customerPo: "WO-200", proposalAttention: "Avery Buyer",
    lines: [{ id: "sub-preview-line", division: "02", priceBookCode: null, description: "Emergency service", internalScope: "", classification: "Firm", included: true,
      costType: "Sub / Vendor", quantity: 1, unit: "LS", catalogCost: 100, projectCost: 100, markupOverride: null, priceOverride: null,
      vendorId: "fixture-sub", vendorName: "Fixture subcontractor", vendorReference: "REF", vendorQuoteDate: "", vendorQuoteExpiry: "", vendorActualCost: 100,
      liveQuote: true, confidence: "High", low: null, high: null, sourceNote: "", customerNote: "", internalNote: "" }],
  });
  return state;
}
async function openPreview(page, state = previewState()) {
  const captures = await serveDirectory(page, state);
  await page.getByRole("button", { name: /New job/ }).click();
  await expect(page.getByRole("dialog", { name: "New job", exact: true })).toBeVisible();
  return captures;
}
async function choose(page, name, value) {
  await page.getByRole("combobox", { name, exact: true }).fill(value);
  await page.getByRole("option").filter({ hasText: value }).first().click();
}

test("new job validates missing fields and cancelling makes no writes", async ({page}) => {
  const captures=await openPreview(page);
  await expect(page.getByLabel("Job number",{exact:true})).toHaveValue("Assigned when saved");
  await page.getByRole("button",{name:"Create job",exact:true}).click();
  await expect(page.locator("#new-job-name")).toHaveAttribute("aria-invalid","true");
  await expect(page.getByText("This information is required.",{exact:true}).first()).toBeVisible();
  await expect(page.getByLabel(/Job value/)).toHaveAttribute("aria-invalid","true");
  expect(captures.writes).toEqual([]);
  await page.getByRole("button",{name:"Cancel",exact:true}).click();
  await expect(page.getByText("Excel job-list upload",{exact:true})).toHaveCount(0);
  await expect(page.getByText("Excel job-list download",{exact:true})).toBeVisible();
  const download=await page.locator('.job-accounting-disclosure').boundingBox();
  const results=await page.locator('.jobs-table').boundingBox();
  expect(download.y).toBeGreaterThan(results.y+results.height);
  await page.getByRole("button",{name:/New job/}).click();
  await expect(page.locator("#new-job-name")).toHaveValue("");
  expect(captures.unexpectedRequests).toEqual([]);
});

test("finished quote autofills value and Yes/No flag in the shared quote conversion form", async ({ page }) => {
  const state = previewState();
  const captures = await openPreview(page, state);
  await choose(page, "Fill from finished quote", "JGC-Q-2026-0905");
  await expect(page.locator("#new-job-name")).toHaveValue("Sump pump inspections");
  await expect(page.getByRole("combobox", { name: "New job client" })).toHaveValue("Quoted Contract Client");
  await expect(page.getByLabel(/Client PO#\/WO#/)).toHaveValue("WO-200");
  await expect(page.getByLabel(/Job value/)).toHaveValue("120");
  await expect(page.getByLabel(/Job value/)).toHaveAttribute("readonly", "");
  await expect(page.getByLabel("Subcontractors", { exact: false })).toHaveValue("Yes");
  await expect(page.getByLabel("Site address", { exact: true })).toHaveValue("100 Station Road");
  await page.getByRole("button", { name: "Unlink quote" }).click();
  await page.getByLabel(/Job value/).fill("2500");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: /^Quotes(?:\s|$)/ }).first().click();
  await page.getByPlaceholder("Search quote, client, project or reference").fill("JGC-Q-2026-0905");
  await page.locator(".quotes-table tbody tr").filter({ hasText: "JGC-Q-2026-0905" }).click();
  await page.getByRole("button", { name: "Make into job", exact: true }).click();
  const handoff = page.getByRole("dialog", { name: "New job", exact: true });
  await expect(handoff.locator("#new-job-name")).toHaveValue("Sump pump inspections");
  await expect(handoff.getByLabel(/Job value/)).toHaveValue("120");
  expect(captures.writes).toEqual([]);
  expect(captures.jobInfo).toEqual([]);
});

test("new clients, sites and attention contacts remain unsaved until Create job on phone", async ({ page }) => {
  const captures = await openPreview(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("combobox", { name: "New job client" }).fill("Preview Client Only");
  await page.getByRole("button", { name: /Add new client: Preview Client Only/ }).click();
  let dialog = page.getByRole("dialog", { name: "Add new client", exact: true });
  await dialog.getByLabel("Attention name").fill("Preview Contact");
  await dialog.getByLabel("Email", { exact: true }).fill("preview@example.com");
  await dialog.getByLabel("Site name", { exact: true }).fill("Preview Station");
  await dialog.getByLabel("Address", { exact: true }).fill("12 Preview Road");
  await dialog.getByRole("button", { name: "Use these details" }).click();
  await expect(page.getByRole("combobox", { name: "New job client" })).toHaveValue("Preview Client Only");
  await expect(page.getByRole("combobox", { name: "New job attention" })).toHaveValue("Preview Contact");
  await expect(page.getByLabel("Site address", { exact: true })).toHaveValue("12 Preview Road");
  await choose(page, "New job client", "Quoted Contract Client");
  await choose(page, "New job site", "Brockville Station");
  await expect(page.getByLabel("Site address", { exact: true })).toHaveValue("100 Station Road");
  await page.getByRole("combobox", { name: "New job site" }).fill("New station");
  await page.getByRole("button", { name: /Add new site: New station/ }).click();
  dialog = page.getByRole("dialog", { name: "Add new site", exact: true });
  await dialog.getByLabel("Address", { exact: true }).fill("50 New Road");
  await dialog.getByRole("button", { name: "Use these details" }).click();
  await page.getByRole("combobox", { name: "New job attention" }).fill("New Attention");
  await page.getByRole("button", { name: /Add new attention: New Attention/ }).click();
  await page.getByRole("dialog", { name: "Add new attention", exact: true }).getByRole("button", { name: "Use these details" }).click();
  await expect(page.getByLabel("Site address", { exact: true })).toHaveValue("50 New Road");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: /New job/ }).click();
  await page.getByRole("combobox", { name: "New job client" }).fill("Preview Client Only");
  await expect(page.getByRole("option").filter({ hasText: "Preview Client Only" })).toHaveCount(0);
  expect(captures.writes).toEqual([]);
  expect(captures.jobInfo).toEqual([]);
});

test("only active matching names and matching or unknown client references trigger advisory", async ({ page }) => {
  await openPreview(page);
  await choose(page, "New job client", "Quoted Contract Client");
  await page.locator("#new-job-name").fill("Accepted Canopy Contract");
  await page.getByLabel(/Client PO#\/WO#/).fill("WO-100");
  await expect(page.locator(".job-preview-warning")).toContainText("26901");
  await page.getByLabel(/Client PO#\/WO#/).fill("WO-101");
  await expect(page.locator(".job-preview-warning")).toHaveCount(0);
  await page.locator("#new-job-name").fill("Historical Imported Repair");
  await page.getByLabel(/Client PO#\/WO#/).fill("");
  await expect(page.locator(".job-preview-warning")).toHaveCount(0);
});

test("job date is assigned at save and quote picker is at bottom", async ({page}) => {
  await openPreview(page);
  await expect(page.getByLabel("Job date",{exact:true})).toHaveAttribute('readonly','');
  const quote=await page.locator('.job-preview-quote').boundingBox();
  const more=await page.locator('.job-preview-more').boundingBox();
  expect(quote.y).toBeGreaterThanOrEqual(more.y+more.height);
});

for (const theme of ["light", "dark"]) {
  test(`new job form is readable and keyboard-contained in ${theme} theme`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openPreview(page);
    await page.evaluate((theme) => { if (typeof applyJgcTheme === "function") applyJgcTheme(theme); }, theme);
    await page.locator("#new-job-name").fill("Sump pump inspections");
    await choose(page, "New job client", "Quoted Contract Client");
    await choose(page, "New job site", "Brockville Station");
    await expect(page.getByRole("button", { name: /Create job/ })).toBeEnabled();
    const size = await page.locator(".job-preview-modal").evaluate((element) => ({
      width: element.getBoundingClientRect().width, overflow: getComputedStyle(element).overflowY,
      bottom: element.getBoundingClientRect().bottom,
    }));
    expect(size.width).toBeGreaterThan(900);
    expect(size.overflow).toBe("visible");
    expect(size.bottom).toBeLessThanOrEqual(1000);
    expect(await page.getByLabel(/Start date/).evaluate((element) => getComputedStyle(element).colorScheme)).toBe("light");
    await page.screenshot({ path: path.join(__dirname, "screenshots", `job-preview-${theme}.png`) });
    await page.getByRole("button", { name: "Create job", exact: true }).focus();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Close new job", exact: true })).toBeFocused();
    await page.getByRole("combobox", { name: "New job client" }).click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "New job", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "New job", exact: true })).toHaveCount(0);
  });
}

for (const width of [1440,390]) {
  test(`Create job saves once and opens the created job at width ${width}`, async ({page}, testInfo) => {
    const state=previewState(); const captures=await openPreview(page,state); const creates=[];
    await page.setViewportSize({width,height:1000});
    await page.route('**/api/job-create',async route=>{
      const body=route.request().postDataJSON(); creates.push(body);
      await new Promise(resolve=>setTimeout(resolve,150));
      const job={...state.jobs[0],id:'created-synthetic',portalJobId:'00000000-0000-4000-8000-000000000090',jobNumber:'26905',quoteId:'',acceptedQuoteSnapshot:'',project:body.draft.jobName,portalJobName:body.draft.jobName,acceptedRevenue:Number(body.draft.value),hasQuotedValue:true,jobDate:'2026-09-18'};
      return route.fulfill({json:{state:{...state,jobs:[job,...state.jobs]},jobId:job.id,jobNumber:job.jobNumber,updatedAt:'2026-09-18T16:00:00Z'}});
    });
    await choose(page,'New job client','Quoted Contract Client');
    await page.locator('#new-job-name').fill('Synthetic new contract');
    await page.getByLabel(/Job value/).fill('1500');
    await page.getByRole('button',{name:'Create job',exact:true}).evaluate(button=>{button.click();button.click();});
    await expect(page.locator('.job-detail-page')).toContainText('26905');
    await expect(page.getByRole('region',{name:'Quoted price'})).toContainText('$1,500.00');
    expect(creates).toHaveLength(1);
    expect(creates[0].requestId).toMatch(/^[a-f0-9-]{36}$/);
    await page.waitForTimeout(850);
    expect(captures.writes).toEqual([]);
    await page.screenshot({path:testInfo.outputPath('created-job.png'),fullPage:true});
  });
}
test('failed network request retains the form and same request ID on retry',async({page})=>{
  const state=previewState();await openPreview(page,state);const ids=[];
  await page.route('**/api/job-create',route=>{ids.push(route.request().postDataJSON().requestId);return route.fulfill({status:503,json:{error:'Connection interrupted. Retry Create job.'}});});
  await choose(page,'New job client','Quoted Contract Client');await page.locator('#new-job-name').fill('Retry job');await page.getByLabel(/Job type/).selectOption('T&M');
  await page.getByRole('button',{name:'Create job',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Connection interrupted');
  await page.getByRole('button',{name:'Create job',exact:true}).click();await expect.poll(()=>ids.length).toBe(2);
  expect(ids[0]).toBe(ids[1]);await expect(page.locator('#new-job-name')).toHaveValue('Retry job');
});
test('Summary shortcut opens the real New Job form on Jobs',async({page})=>{
  const captures=await serveDirectory(page,previewState());
  await page.goto('/estimating/index.html?dev=1&view=jobs&newJob=1');
  await expect(page.getByRole('dialog',{name:'New job',exact:true})).toBeVisible();
  await expect(page.locator('.job-directory-page')).toBeVisible();
  expect(captures.writes).toEqual([]);
  const html=readFileSync(path.join(__dirname,'../admin.html'),'utf8');expect(html).toContain('estimating/?view=jobs&amp;newJob=1');
});
