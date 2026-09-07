const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const { directoryState, serveDirectory, openDirectoryJob, fixtureDate } = require("./fixtures/job-readability-fixture");

function readabilityState() {
  const state = directoryState();
  const quote = state.quotes[0];
  const job = state.jobs[0];
  const line = {
    id: "readability-subcontract-line", section: "General", division: "Division 05 – Metals", divisionManual: true,
    priceBookCode: null, description: "Canopy fabrication and installation", internalScope: "", classification: "Required", included: true,
    costType: "Sub / Vendor", quantity: 1, unit: "LS", catalogCost: null, projectCost: 10000, markupOverride: null,
    priceOverride: null, vendorId: null, vendorName: "Readable Fabrication Company", vendorReference: "SUB-1901",
    vendorQuoteDate: "2026-09-01", vendorQuoteExpiry: "", vendorPricingMode: "Quoted", vendorActualCost: 10000,
    vendorOverrideCost: null, liveQuote: true, confidence: "Project-specific", low: null, high: null,
    sourceNote: "", customerNote: "", internalNote: "",
  };
  quote.lines = [line];
  job.acceptedQuoteSnapshot = JSON.stringify(quote);
  job.documentLinks = [{ id: "readability-document", label: "Project drawings and subcontractor quotes", url: "https://example.com/jobs/26901/documents", createdAt: fixtureDate }];
  job.documentLink = job.documentLinks[0].url;
  job.documentLinkLabel = job.documentLinks[0].label;
  job.costs = [{ id: "readability-actual", date: "2026-09-01", type: "Material", section: "General", vendor: "Construction Supply Company", reference: "INVOICE-1901", hours: 0, preTaxAmount: 850, hstAmount: 110.5, paid: false, notes: "Material delivery" }];
  job.purchaseOrders = [{
    id: "readability-po", number: "26901-1", revision: 0, status: "Issued", sourceQuoteId: quote.id, vendorId: null,
    vendorName: line.vendorName, vendorContact: "Fabrication Contact", vendorEmail: "contact@example.com", vendorPhone: "613-555-0100", vendorQuoteNumber: line.vendorReference,
    issueDate: "2026-09-01", shipBy: "Your means", shipVia: "Your means", fob: "Job Site", shipTo: "1 Main Street", authorizedBy: "Directory Test Manager",
    taxRate: 0.13, notes: "Approved fabrication scope", lines: [{ id: "readability-po-line", quoteLineId: line.id, description: line.description, quantity: 1, unit: "LS", unitCost: 10000, amount: 10000, sourceReference: line.vendorReference }],
    revisions: [], finalizedAt: fixtureDate, createdAt: fixtureDate, updatedAt: fixtureDate,
  }];
  job.shopDrawings = [{
    id: "readability-drawing", number: "SD-001", revision: 1, title: "Fabricated canopy connection details", division: line.division,
    vendorId: null, vendorName: line.vendorName, consultant: "Project Consulting Engineer", status: "Approved", responsibility: "Complete",
    requestedDate: "2026-08-01", receivedDate: "2026-08-03", submittedDate: "2026-08-04", dueDate: "2026-08-10",
    returnedDate: "2026-08-09", requiredOnsiteDate: "2026-09-10", oneDriveUrl: "https://example.com/drawings/sd-001-r1.pdf",
    notes: "Reviewed connection details", sharedWithEmployees: false, revisions: [], createdAt: fixtureDate, updatedAt: fixtureDate,
  }];
  state.quotes.push({
    ...quote, id: "readability-ccn", number: "26901-CCN-001", documentKind: "Change Notice", status: "Finished",
    project: "Canopy design adjustment", jobId: job.id, changeSequence: 1, changeTitle: "Additional canopy reinforcing",
    changeStatus: "Submitted", changeRequestedBy: "Project Consulting Engineer", changeRequestedDate: "2026-09-01", changeDueDate: "2026-09-14",
    changeOrder: null, changeOrderHistory: [], lines: [{ ...line, id: "readability-change-line", vendorActualCost: 1200, projectCost: 1200 }],
  });
  return state;
}

async function workbookFile() {
  const ExcelJS = require("../vendor/exceljs.min.js");
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("2026");
  sheet.getCell("A1").value = "Example imported time and materials repair project";
  sheet.getCell("F1").value = "26905";
  sheet.getCell("H1").value = "Directory Test Manager";
  sheet.getCell("K1").value = "T&M";
  return { name: "readability-jobs.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from(await workbook.xlsx.writeBuffer()) };
}

async function inspectText(page, name, testInfo) {
  await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: "instant" }));
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const audit = await page.evaluate(() => {
    const parse = (value) => {
      const numbers = value.match(/[\d.]+/g)?.map(Number);
      return numbers && numbers.length >= 3 ? [...numbers.slice(0, 3), numbers[3] ?? 1] : [255, 255, 255, 0];
    };
    const blend = (front, back) => front.slice(0, 3).map((value, i) => value * front[3] + back[i] * (1 - front[3]));
    const luminance = (rgb) => rgb.map((value) => value / 255).map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4).reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i], 0);
    const path = (element) => `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}${[...element.classList].map((value) => `.${value}`).join("")}`;
    const items = [];
    const scope = document.querySelector('[role="dialog"]') || document.querySelector(".job-detail-page") || document.querySelector("main") || document.body;
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
    const candidates = [];
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const text = node.textContent.trim().replace(/\s+/g, " ");
      const element = node.parentElement;
      candidates.push({ node, text, element, placeholder: false });
    }
    for (const element of scope.querySelectorAll("input, textarea, select")) {
      if (["checkbox", "radio", "file", "hidden"].includes(element.type)) continue;
      candidates.push({ element, node: null, text: element.value || element.placeholder || "", placeholder: !element.value });
    }
    for (const element of scope.querySelectorAll("[data-label]")) {
      const style = getComputedStyle(element, "::before");
      if (!["none", "normal", '""'].includes(style.content) && style.display !== "none") candidates.push({ element, node: null, text: element.getAttribute("data-label"), pseudo: "::before" });
    }
    for (const { node, text, element, placeholder, pseudo } of candidates) {
      if (!text || !element || element.closest("script, style, svg, .sr-only, [hidden]")) continue;
      const style = getComputedStyle(element, pseudo || null);
      let rect = element.getBoundingClientRect();
      if (node) {
        const range = document.createRange();
        range.selectNodeContents(node);
        rect = range.getBoundingClientRect();
      }
      if (!rect.width || !rect.height || style.visibility !== "visible" || !element.getClientRects().length) continue;
      let background = [255, 255, 255];
      const chain = [];
      for (let current = element; current; current = current.parentElement) chain.unshift(current);
      let opacity = 1;
      let uncertainGradient = false;
      for (const current of chain) {
        const currentStyle = getComputedStyle(current);
        const color = parse(currentStyle.backgroundColor);
        if (color[3] === 1) uncertainGradient = false;
        background = blend(color, background);
        if (currentStyle.backgroundImage !== "none") uncertainGradient = true;
        opacity *= Number(currentStyle.opacity);
      }
      const color = placeholder ? getComputedStyle(element, "::placeholder").color : style.color;
      const foreground = parse(color);
      foreground[3] *= opacity;
      const effectiveForeground = blend(foreground, background);
      const a = luminance(effectiveForeground), b = luminance(background);
      const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      const size = parseFloat(style.fontSize);
      const threshold = size >= 24 || size >= 18.66 && parseFloat(style.fontWeight) >= 700 ? 3 : 4.5;
      const clipped = (style.overflowY === "hidden" || style.overflowY === "clip") && element.scrollHeight > element.clientHeight + 2;
      let overlappingLabel = false;
      if (pseudo) {
        const context = document.createElement("canvas").getContext("2d");
        context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        const renderedText = style.textTransform === "uppercase" ? text.toUpperCase() : text;
        const pieces = style.whiteSpace === "nowrap" ? [renderedText] : renderedText.split(/[\s/-]+/);
        const widestWord = Math.max(...pieces.map((piece) => context.measureText(piece).width + (parseFloat(style.letterSpacing) || 0) * piece.length));
        const available = parseFloat(style.width) + (parseFloat(getComputedStyle(element).columnGap) || 0);
        overlappingLabel = Number.isFinite(available) && widestWord > available + 1 && !["anywhere", "break-word"].includes(style.overflowWrap) && style.wordBreak !== "break-all";
      }
      items.push({ text: text.slice(0, 125), selector: path(element) + (pseudo || ""), parent: path(element.parentElement), color, background: background.map(Math.round), fontSize: size, fontWeight: style.fontWeight, ratio: +ratio.toFixed(2), threshold, uncertainGradient, disabled: Boolean(element.closest(":disabled")), clipped, placeholder, overlappingLabel });
    }
    return { viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth, items };
  });
  const report = {
    ...audit,
    failures: audit.items.filter((item) => !item.uncertainGradient && item.ratio < item.threshold),
    tinyText: audit.items.filter((item) => item.fontSize < 11),
    clipped: audit.items.filter((item) => item.clipped),
    overlappingLabels: audit.items.filter((item) => item.overlappingLabel),
  };
  await testInfo.attach(`${name}-computed-readability`, { body: JSON.stringify(report, null, 2), contentType: "application/json" });
  if (process.env.JGC_READABILITY_AUDIT === "1") {
    fs.writeFileSync(testInfo.outputPath(`${name}-readability.json`), JSON.stringify(report, null, 2));
    const path = testInfo.outputPath(`${name}.png`);
    await page.screenshot({ path, fullPage: !(await page.getByRole("dialog").count()) });
    await testInfo.attach(name, { path, contentType: "image/png" });
    console.log(JSON.stringify({ page: name, sampledText: audit.items.length, contrastFailures: report.failures.length, tinyText: report.tinyText.length, clipped: report.clipped.length, examples: report.failures.slice(0, 9) }));
  }
  expect.soft(audit.scrollWidth, `${name}: the page must not overflow horizontally`).toBeLessThanOrEqual(audit.viewport + 1);
  expect.soft(report.failures, `${name}: text, input values and disabled labels need readable contrast`).toEqual([]);
  expect.soft(report.tinyText, `${name}: job labels and actions must not use undersized text`).toEqual([]);
  expect.soft(report.clipped, `${name}: text must not be vertically clipped`).toEqual([]);
  expect.soft(report.overlappingLabels, `${name}: mobile labels must fit without touching their values`).toEqual([]);
  // Keep an explicit financial regression check: these totals previously inherited dark ink.
  const financialTotals = audit.items.filter((item) => /grand|revised|heading-total/.test(item.parent) && /\$[\d,]+/.test(item.text));
  for (const item of financialTotals) expect.soft(item.ratio, `${name}: ${item.text} on ${item.parent}`).toBeGreaterThanOrEqual(item.threshold);
  return report;
}

for (const viewport of [{ width: 1366, height: 900, name: "desktop" }, { width: 390, height: 844, name: "phone" }]) {
  test(`job pages retain readable financial totals and contained text at ${viewport.name} size`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    const state = readabilityState();
    const captures = await serveDirectory(page, state);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.getByLabel("Search jobs", { exact: true }).fill("269");
    await expect(page.locator(".jobs-table tbody tr")).toHaveCount(3);
    await inspectText(page, `${viewport.name}-directory`, testInfo);
    await page.route("**/api/job-import", (route) => {
      const request = route.request().postDataJSON();
      expect(request.action).toBe("preview");
      return route.fulfill({ json: { preview: { insertCount: 1, updateCount: 0, activeCount: 1, inactiveCount: 0, snapshot: "readability-only", missingJobs: [{ id: "readability-missing", jobNumber: "26900", jobName: "Earlier imported repair project" }], protectedMissingJobs: [{ id: state.jobs[0].id, jobNumber: "26901", jobName: state.jobs[0].project }] } } });
    });
    await page.locator(".job-import-disclosure > summary").click();
    await page.getByLabel("Excel job-list workbook").setInputFiles(await workbookFile());
    await expect(page.getByTestId("job-import-preview")).toBeVisible();
    await page.getByText("Review 1 workbook jobs (2026)", { exact: true }).click();
    await inspectText(page, `${viewport.name}-excel-preview`, testInfo);
    await page.locator(".job-import-disclosure > summary").click();
    await openDirectoryJob(page, "26901");
    for (const [tab, file] of [["Summary", "summary"], ["Purchase Orders", "purchase-orders"], ["CCNs / Change Orders", "changes"], ["Shop Drawings", "shop-drawings"], ["Statistics / Other", "statistics"]]) {
      await page.getByRole("tab", { name: tab, exact: true }).click();
      if (tab === "Shop Drawings") await page.getByRole("button", { name: "All", exact: true }).click();
      if (tab === "Statistics / Other" || tab === "Purchase Orders") await expect(page.getByRole("tabpanel")).toContainText("PO-30902");
      await inspectText(page, `${viewport.name}-${file}`, testInfo);
      if (tab === "Summary") {
        const ledger = await page.locator(".job-ledger .data-table-wrap").evaluate((wrapper) => {
          const edge = wrapper.getBoundingClientRect();
          const value = wrapper.querySelector('td[data-label="Pre-tax cost"] strong').getBoundingClientRect();
          const heading = wrapper.querySelector("th:last-child").getBoundingClientRect();
          return { valueFits: value.x >= edge.x - 1 && value.right <= edge.right + 1, headingFits: !heading.width || heading.x >= edge.x - 1 && heading.right <= edge.right + 1, scrollLeft: wrapper.scrollLeft };
        });
        expect.soft(ledger, "The final actual-cost column must be visible without scrolling sideways").toEqual({ valueFits: true, headingFits: true, scrollLeft: 0 });
      }
      if (tab === "Purchase Orders") {
        const lines = await page.locator('.po-source-table td[data-label="PO"] > strong, .po-source-table td[data-label="PO"] > small:not(.po-status)').evaluateAll((elements) => elements.map((element) => {
          const range = document.createRange();
          range.selectNodeContents(element);
          return new Set([...range.getClientRects()].map((rect) => Math.round(rect.y))).size;
        }));
        expect(lines.length).toBeGreaterThanOrEqual(2);
        for (const count of lines) expect.soft(count, "PO identity and revision must each stay together on one line").toBe(1);
      }
      if (tab === "Statistics / Other") {
        const columns = await page.locator(".statistics-work-orders-table table").evaluate((table) => {
          const headings = [...table.querySelectorAll("thead th")].map((cell) => cell.getBoundingClientRect().x);
          const cells = [...table.querySelectorAll("tbody tr:first-child td")].map((cell) => cell.getBoundingClientRect());
          return cells.map((cell, i) => ({ offsetFromHeading: Math.abs(cell.x - headings[i]), offsetFromRow: Math.abs(cell.y - cells[0].y) }));
        });
        expect(columns).toHaveLength(4);
        for (const column of columns) {
          expect.soft(column.offsetFromHeading, "Work Order values must align under their own headings").toBeLessThanOrEqual(1);
          expect.soft(column.offsetFromRow, "Work Order cells must stay on one table row").toBeLessThanOrEqual(1);
        }
      }
      if (process.env.JGC_READABILITY_AUDIT === "1") {
        const focus = { Summary: ".job-ledger", "Purchase Orders": ".subcontract-po-panel", "Statistics / Other": ".statistics-work-orders-card" }[tab];
        if (focus) await page.locator(focus).screenshot({ path: testInfo.outputPath(`${viewport.name}-${file}-focused.png`) });
      }
    }
    await page.getByRole("tab", { name: "Purchase Orders", exact: true }).click();
    await page.getByRole("button", { name: "Edit PO", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await inspectText(page, `${viewport.name}-po-editor`, testInfo);
    if (process.env.JGC_READABILITY_AUDIT === "1") {
      await page.locator(".po-total-preview").scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath(`${viewport.name}-po-editor-total.png`), fullPage: false });
    }
    expect(captures.jobInfo).toEqual([]);
    expect(captures.writes).toEqual([]);
    expect(captures.unexpectedRequests).toEqual([]);
  });
}
