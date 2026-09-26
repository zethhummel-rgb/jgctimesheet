const { test, expect } = require("@playwright/test");

// Estimate Desk shell: one header row (section tile + page title), the Portal's coloured tiles in the
// sidebar, the Portal link under the logo, the Overview numbers strip and the phone tab bar.
const DESKTOP = { width: 1366, height: 900 };
const PHONE = { width: 390, height: 844 };
const LOOKALIKE = { red: "red", rose: "red", amber: "amber", gold: "amber", teal: "teal", cyan: "teal", violet: "violet", indigo: "violet" };
const family = (tone) => LOOKALIKE[tone] || tone;

const openDesk = async (page, viewport) => {
  await page.setViewportSize(viewport);
  await page.goto("/estimating/index.html?dev=1");
  await expect(page.locator(".desk-shell")).toBeVisible();
};

const openDemoQuote = async (page) => {
  await page.getByRole("button", { name: "Company-wide" }).click();
  await page.getByRole("searchbox", { name: "Search estimates and jobs" }).fill("Lancaster");
  await page.locator(".overview-result-group > button").filter({ hasText: "JGC-Q-2026-0001" }).click();
  await expect(page.getByText("JGC-Q-2026-0001 · REV 0")).toBeVisible();
};

test("the header row shows the section tile and the page's own title, with no second strip above it", async ({ page }) => {
  await openDesk(page, DESKTOP);
  await expect(page.locator(".estimator-portal-strip")).toHaveCount(0);
  await expect(page.getByText("Connected to JGC Portal")).toHaveCount(0);
  expect(Math.round((await page.locator(".topbar").boundingBox()).y)).toBe(0);

  const expected = [["Overview", "Overview"], ["Quotes", "Quotes"], ["Jobs", "Jobs"], ["Clients", "Clients and sites"], ["Price Book", "Price Book"], ["Vendors", "Vendors"], ["Settings", "Settings"]];
  for (const [nav, title] of expected) {
    const navButton = page.locator(".sidebar").getByRole("button", { name: new RegExp(`^${nav}`) });
    await navButton.click();
    const header = page.locator(".topbar-title");
    await expect(header.getByRole("heading", { level: 1 }), nav).toHaveText(title);
    await expect(header.locator(".topbar-title-text span"), nav + " description").not.toHaveText("");
    await expect(header.locator(".desk-tile"), nav + " tile matches the sidebar").toHaveAttribute("data-tone", await navButton.locator(".desk-tile").getAttribute("data-tone"));
    // The page itself no longer repeats its title.
    await expect(page.locator(".page-canvas .page-heading h1"), nav).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), nav + " no sideways scroll").toBe(true);
  }

  await page.locator(".sidebar").getByRole("button", { name: "Overview" }).click();
  await openDemoQuote(page);
  const header = page.locator(".topbar-title");
  await expect(header.locator("strong")).toHaveText("JGC-Q-2026-0001");
  await expect(header.locator(".desk-tile")).toHaveAttribute("data-tone", "blue");
  await expect(header.getByRole("heading")).toHaveCount(0);
});

test("the sidebar uses the Portal's tiles, never two look-alike colours together, with the Portal link under the logo", async ({ page }) => {
  await openDesk(page, DESKTOP);
  const items = await page.locator(".primary-nav > button").evaluateAll((buttons) => buttons.map((button) => {
    const tile = button.querySelector(".desk-tile");
    const svg = tile && tile.querySelector("svg");
    return {
      label: button.textContent.replace(/\d+ drafts?/, "").trim(),
      tone: tile && tile.getAttribute("data-tone"),
      filled: tile ? getComputedStyle(tile).backgroundColor !== "rgba(0, 0, 0, 0)" : false,
      iconShare: svg ? svg.getBoundingClientRect().width / tile.getBoundingClientRect().width : 0
    };
  }));
  expect(items.map((item) => item.label)).toEqual(["Overview", "Quotes", "Jobs", "Clients", "Price Book", "Vendors"]);
  expect(items.map((item) => item.tone)).toEqual(["green", "blue", "teal", "violet", "gold", "indigo"]);
  for (const item of items) {
    expect(item.filled, item.label).toBe(true);
    expect(item.iconShare, item.label + " icon fills the tile").toBeGreaterThan(0.45);
  }
  for (let i = 1; i < items.length; i++) expect(family(items[i].tone), `${items[i - 1].label} next to ${items[i].label}`).not.toBe(family(items[i - 1].tone));
  await expect(page.locator(".sidebar-bottom .desk-tile")).toHaveAttribute("data-tone", "slate");

  const portalLink = page.locator(".sidebar-portal-link");
  await expect(portalLink).toBeVisible();
  await expect(portalLink).toHaveAttribute("href", "../admin.html?tab=summary");
  expect(await portalLink.evaluate((link) => link.previousElementSibling.classList.contains("brand-block"))).toBe(true);
  await expect(page.locator(".topbar").getByRole("link", { name: /Portal/ })).toHaveCount(0);
  await expect(page.locator(".workspace-avatar")).toHaveText("LQ");
});

test("the Overview numbers follow the scope and open the matching lists", async ({ page }) => {
  await openDesk(page, DESKTOP);
  const stat = (label) => page.locator(".overview-stat").filter({ hasText: label });
  await expect(page.locator(".overview-stat .overview-stat-label")).toHaveText(["Drafts", "Awaiting reply", "Won this month", "Active jobs"]);
  await expect(page.locator(".welcome-panel")).toHaveCount(0);

  await page.getByRole("button", { name: "Company-wide" }).click();
  await expect(page.locator(".topbar-title-text span")).toHaveText("Every estimator's quotes and jobs");
  await expect(stat("Drafts").locator("strong")).toHaveText("1");
  await expect(stat("Drafts").locator("small")).toContainText("in progress");

  await stat("Drafts").click();
  await expect(page.locator(".topbar-title").getByRole("heading")).toHaveText("Quotes");
  await expect(page.locator(".filter-tabs button.active")).toHaveText("Draft");

  await page.locator(".sidebar").getByRole("button", { name: "Overview" }).click();
  await stat("Active jobs").click();
  await expect(page.locator(".topbar-title").getByRole("heading")).toHaveText("Jobs");
});

test("phones get a tab bar for Overview, Quotes, Jobs and Clients, hidden inside a quote", async ({ page }) => {
  await openDesk(page, PHONE);
  const tabBar = page.locator(".desk-tabbar");
  await expect(tabBar).toBeVisible();
  await expect(tabBar.locator("a")).toHaveText(["Overview", "Quotes", "Jobs", "Clients"]);
  expect(await tabBar.locator("a .desk-tile").evaluateAll((tiles) => tiles.map((tile) => tile.getAttribute("data-tone")))).toEqual(["green", "blue", "teal", "violet"]);
  await expect(tabBar.locator("a.active")).toHaveText("Overview");
  const box = await tabBar.boundingBox();
  expect(Math.round(box.y + box.height)).toBe(PHONE.height);
  // The ☰ menu stays for everything else.
  await expect(page.getByRole("button", { name: "Open navigation" })).toBeVisible();

  // The end of the page clears the tab bar.
  const clearance = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector(".page-canvas")).paddingBottom) - document.querySelector(".desk-tabbar").getBoundingClientRect().height);
  expect(clearance).toBeGreaterThanOrEqual(16);

  await tabBar.locator("a", { hasText: "Quotes" }).click();
  await expect(page.locator(".topbar-title").getByRole("heading")).toHaveText("Quotes");
  await expect(tabBar.locator("a.active")).toHaveText("Quotes");
  await tabBar.locator("a", { hasText: "Clients" }).click();
  await expect(page.locator(".topbar-title").getByRole("heading")).toHaveText("Clients and sites");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);

  await tabBar.locator("a", { hasText: "Overview" }).click();
  await openDemoQuote(page);
  await expect(tabBar).toHaveCount(0);
  await expect(page.locator(".sticky-quote-summary")).toBeVisible();
});

// iPhone Home Screen app: the Portal's solid 12px band covers the top of the screen (so iOS never blurs the
// status bar). Nothing in the Estimate Desk may sit under it: not the header, the menu or the sticky tabs.
test("in the iPhone Home Screen app the header, menu and sticky tabs start below the top band", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "standalone", { get: () => true }));
  await openDesk(page, PHONE);
  await expect(page.locator("html")).toHaveClass(/jgc-ios-app/);
  const edges = () => page.evaluate(() => {
    const box = (selector) => { const element = document.querySelector(selector); return element ? element.getBoundingClientRect() : null; };
    const band = document.querySelector("body > .jgc-safe-area-top");
    return {
      bandBottom: band.getBoundingClientRect().bottom,
      bandColour: getComputedStyle(band).backgroundColor,
      topbarTop: box(".topbar").top,
      topbarBottom: box(".topbar").bottom,
      menuTop: box(".mobile-menu").top,
      brandTop: box(".brand-block").top,
      quoteTabsTop: box(".quote-tabs") && box(".quote-tabs").top
    };
  });

  let now = await edges();
  expect(now.bandBottom).toBe(12);
  expect(now.bandColour, "white like the header").toBe("rgb(255, 255, 255)");
  expect(now.topbarTop).toBeGreaterThanOrEqual(now.bandBottom);
  expect(now.menuTop, "the ☰ button is not cut off").toBeGreaterThanOrEqual(now.bandBottom);

  await page.getByRole("button", { name: "Company-wide" }).click();
  await page.evaluate(() => window.scrollTo(0, 600));
  now = await edges();
  expect(now.topbarTop, "the sticky header stops below the band").toBe(now.bandBottom);

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.locator("#estimate-navigation")).toHaveClass(/is-open/);
  await expect.poll(async () => (await edges()).brandTop).toBeGreaterThanOrEqual(12);
  expect((await edges()).bandColour, "dark green like the menu").toBe("rgb(6, 39, 31)");
  await page.locator(".sidebar-close").click();

  await page.getByRole("searchbox", { name: "Search estimates and jobs" }).fill("Lancaster");
  await page.locator(".overview-result-group > button").filter({ hasText: "JGC-Q-2026-0001" }).click();
  await expect(page.getByText("JGC-Q-2026-0001 · REV 0")).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 1400));
  await expect.poll(async () => { const e = await edges(); return e.quoteTabsTop >= e.topbarBottom - 1; }, { message: "quote tabs stick below the header" }).toBe(true);
});

test("outside the Home Screen app there is no band and the header sits at the very top", async ({ page }) => {
  await openDesk(page, PHONE);
  const top = await page.evaluate(() => ({ band: document.querySelector("body > .jgc-safe-area-top").getBoundingClientRect().height, topbar: document.querySelector(".topbar").getBoundingClientRect().top }));
  expect(top).toEqual({ band: 0, topbar: 0 });
});

test("computers never show the phone tab bar", async ({ page }) => {
  await openDesk(page, DESKTOP);
  await expect(page.locator(".desk-tabbar")).toBeHidden();
});
