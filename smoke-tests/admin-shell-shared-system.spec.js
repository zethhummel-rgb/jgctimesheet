const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");

const portalRoot = path.resolve(__dirname, "..");

function read(file) {
  return fs.readFileSync(path.join(portalRoot, file), "utf8");
}

test("main Admin shell uses one scoped token-only visual layer", async () => {
  const html = read("admin.html");
  const shellCss = read("admin-shell-design-system.css");
  const searchCss = read("admin-global-search.css");
  const common = read("common.js");
  const worker = read("service-worker.js");

  expect(html).not.toMatch(/href=["']styles\.css/i);
  expect(html).not.toMatch(/\sstyle\s*=/i);
  expect(html).toContain('jgc-design-system.css?v=9');
  expect(html).toContain('admin-shell-design-system.css?v=4');
  expect(html).toMatch(/<body\b[^>]*\bjgc-page\b[^>]*\bjgc-admin-shell-page\b/i);
  expect(html).toContain('id="summarySection" class="dashboard-summary"');
  expect(html).toContain('<nav class="dashboard-quick-actions" aria-label="Quick actions">');
  expect(html).toContain('<a class="jgc-button" href="estimating/">Open Estimate Desk</a>');
  expect(html).toContain('id="adminToolsSection" class="card jgc-panel jgc-admin-shell-surface"');
  for (const id of [
    "timesheetsSection",
    "safetyRecordsSection",
    "inspectionsSection",
    "certificatesSection",
    "tasksSection",
    "noticePolicySection",
    "reportsSection",
    "workOrdersSection",
    "contactsSection",
    "subcontractorsSuppliersSection"
  ]) {
    expect(html).toMatch(new RegExp(`id=["']${id}["'][^>]*\\bjgc-admin-feature-surface\\b`));
  }
  const commonAsset = html.match(/src="(common\.js\?v=\d+)"/);
  expect(commonAsset).toBeTruthy();
  expect(worker).toContain(commonAsset[1]);

  for (const css of [shellCss, searchCss]) {
    expect(css).not.toMatch(/#[0-9a-f]{3,8}|rgba?\(|hsla?\(|color:\s*(?:white|black)\b/i);
    expect(css).toContain("var(--jgc-color-");
  }

  expect(common).toContain('const JGC_ADMIN_GLOBAL_SEARCH_VERSION = "9";');
  expect(worker).toMatch(/const JGC_RELEASE_ID = "\d+";/);
  expect(worker).toContain('"./admin-shell-design-system.css?v=4"');
  expect(worker).toContain('"./admin-global-search.css?v=9"');
  expect(worker).toContain('"./admin-global-search.js?v=9"');
  expect(worker).toContain('"./' + commonAsset[1] + '"');
});

async function visibleLayout(page, selector) {
  return page.evaluate((targetSelector) => {
    const viewport = document.documentElement.clientWidth;
    const surface = document.querySelector(targetSelector).getBoundingClientRect();
    const overflowingControls = Array.from(document.querySelectorAll(`${targetSelector} input, ${targetSelector} select, ${targetSelector} textarea, ${targetSelector} button, ${targetSelector} a`)).flatMap((element) => {
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return [];
      const scrollRegion = element.closest(".tabs, .table-wrap, .admin-schedule-calendar-scroll");
      const intentionallyScrollable = scrollRegion && ["auto", "scroll"].includes(getComputedStyle(scrollRegion).overflowX);
      return intentionallyScrollable || (rect.left >= -1 && rect.right <= viewport + 1)
        ? []
        : [{ tag: element.tagName, id: element.id, left: rect.left, right: rect.right }];
    });
    return {
      viewport,
      bodyWidth: document.body.scrollWidth,
      surface: { left: surface.left, right: surface.right },
      overflowingControls
    };
  }, selector);
}

const adminFeatureSurfaceSelectors = [
  "#timesheetsSection",
  "#safetyRecordsSection",
  "#inspectionsSection",
  "#certificatesSection",
  "#tasksSection",
  "#noticePolicySection",
  "#reportsSection",
  "#workOrdersSection",
  "#contactsSection",
  "#subcontractorsSuppliersSection"
];

for (const viewport of [
  { name: "desktop", width: 1280, height: 900 },
  { name: "phone", width: 390, height: 844 }
]) {
  test(`Admin Summary shell stays readable and contained on ${viewport.name}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport, javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
    await page.locator("#adminGlobalSearchResults").evaluate((results) => {
      results.innerHTML = `<section class="admin-global-search-group"><button class="admin-global-search-group-header" type="button" aria-expanded="false"><span>Time &amp; Attendance</span><span class="admin-global-search-group-count">3</span></button></section>`;
    });
    const layout = await visibleLayout(page, "#summarySection");
    expect(layout.bodyWidth).toBeLessThanOrEqual(layout.viewport + 1);
    expect(layout.surface.left).toBeGreaterThanOrEqual(0);
    expect(layout.surface.right).toBeLessThanOrEqual(layout.viewport + 1);
    expect(layout.overflowingControls).toEqual([]);
    // The Summary dashboard's quick actions replace the former Estimate Desk card.
    const quickActions = await page.locator(".dashboard-quick-actions").evaluate((nav) => {
      const navRect = nav.getBoundingClientRect();
      const links = Array.from(nav.querySelectorAll("a"));
      return {
        hrefs: links.map((link) => link.getAttribute("href")),
        contained: links.every((link) => {
          const rect = link.getBoundingClientRect();
          return rect.left >= navRect.left - 1 && rect.right <= navRect.right + 1;
        })
      };
    });
    expect(quickActions.hrefs[0]).toBe("estimating/");
    expect(quickActions.contained).toBe(true);
    const tabsOverflow = await page.locator("body > .tabs").evaluate((tabs) => getComputedStyle(tabs).overflowX);
    expect(["auto", "scroll"]).toContain(tabsOverflow);
    await context.close();
  });

  test(`Admin Tools, Employee Profiles, and Backups stay contained on ${viewport.name}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport, javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto("/admin.html", { waitUntil: "domcontentloaded" });

    for (const selector of ["#adminToolsSection", "#employeeProfileSection", "#backupsSection"]) {
      await page.locator("#summarySection, #adminToolsSection, #employeeProfileSection, #backupsSection").evaluateAll((sections, selected) => {
        sections.forEach((section) => { section.hidden = `#${section.id}` !== selected; });
      }, selector);
      const layout = await visibleLayout(page, selector);
      expect(layout.bodyWidth).toBeLessThanOrEqual(layout.viewport + 1);
      expect(layout.surface.left).toBeGreaterThanOrEqual(0);
      expect(layout.surface.right).toBeLessThanOrEqual(layout.viewport + 1);
      expect(layout.overflowingControls).toEqual([]);
    }

    if (viewport.name === "phone") {
      await page.locator("#adminToolsSection").evaluate((section) => { section.hidden = false; });
      await page.locator("#backupsSection").evaluate((section) => { section.hidden = true; });
      const toolColumns = await page.locator(".admin-tools-grid").evaluate((grid) => getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/).length);
      expect(toolColumns).toBe(1);
    }
    await context.close();
  });

  test(`Admin feature surfaces and tables retain the dark green shell on ${viewport.name}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport, javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto("/admin.html", { waitUntil: "domcontentloaded" });

    const styles = await page.evaluate((selectors) => {
      // The Summary is now a transparent dashboard, so compare against the Admin Tools shell panel.
      const reference = document.querySelector("#adminToolsSection");
      const expectedSurface = getComputedStyle(reference).backgroundColor;
      return selectors.map((selector) => {
        const surface = document.querySelector(selector);
        surface.hidden = false;
        const probe = document.createElement("table");
        probe.className = "admin-surface-theme-probe";
        probe.innerHTML = "<thead><tr><th>Header</th></tr></thead><tbody><tr><td>Row</td></tr></tbody>";
        surface.appendChild(probe);
        const result = {
          selector,
          surface: getComputedStyle(surface).backgroundColor,
          table: getComputedStyle(probe).backgroundColor,
          header: getComputedStyle(probe.querySelector("th")).backgroundColor,
          cell: getComputedStyle(probe.querySelector("td")).backgroundColor,
          expectedSurface
        };
        probe.remove();
        surface.hidden = true;
        return result;
      });
    }, adminFeatureSurfaceSelectors);

    for (const style of styles) {
      expect(style.surface, style.selector).toBe(style.expectedSurface);
      expect(style.surface, style.selector).not.toBe("rgb(251, 252, 249)");
      expect(style.table, style.selector).not.toBe("rgb(255, 255, 255)");
      expect(style.header, style.selector).not.toBe("rgb(230, 236, 230)");
      expect(style.cell, style.selector).not.toBe("rgb(255, 255, 255)");
    }

    await context.close();
  });
}

test('Open Job List has readable contrast in light and dark modes',async({browser})=>{
 const context=await browser.newContext({javaScriptEnabled:false});const page=await context.newPage();await page.goto('/admin.html');
 for(const theme of ['light','dark']) {await page.locator('html').evaluate((el,theme)=>{el.dataset.jgcTheme=theme;el.dataset.theme=theme;document.body.dataset.jgcTheme=theme;document.body.dataset.theme=theme;},theme);
 // Colours from color-mix() compute as color(srgb 0-1 ...); blend translucent layers down to an opaque one.
 const ratio=await page.getByRole('link',{name:'Open Job List',exact:true}).evaluate(el=>{
 const parse=s=>{const n=(s.match(/-?[\d.]+/g)||[]).map(Number);return s.startsWith('color(')?[n[0]*255,n[1]*255,n[2]*255,n.length>3?n[3]:1]:[n[0],n[1],n[2],n.length>3?n[3]:1];};
 const over=(t,b)=>[0,1,2].map(i=>t[i]*t[3]+b[i]*(1-t[3])).concat(1);
 const lum=c=>c.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);
 const layers=[];for(let n=el;n;n=n.parentElement){const c=parse(getComputedStyle(n).backgroundColor);if(c[3]>0)layers.push(c);if(c[3]>=1)break;}
 const bg=layers.reverse().reduce((r,l)=>over(l,r),[255,255,255,1]);
 const a=lum(over(parse(getComputedStyle(el).color),bg)),b=lum(bg);return(Math.max(a,b)+.05)/(Math.min(a,b)+.05);});expect(ratio).toBeGreaterThanOrEqual(4.5);}
 await context.close();
});
