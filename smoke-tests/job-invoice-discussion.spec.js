const { test, expect } = require("@playwright/test");
const { directoryState, serveDirectory, openDirectoryJob } = require("./fixtures/job-readability-fixture");

for (const width of [390, 1366]) {
  test(`close for discussion, blue list/tiles without a ready-to-invoice action at ${width}px`, async ({ page }, testInfo) => {
    const state = directoryState(), originalQuote = JSON.stringify(state.quotes);
    const captures = await serveDirectory(page, state);
    await page.setViewportSize({ width, height: 960 });
    await openDirectoryJob(page, "26901");
    const close = page.getByRole("button", { name: "Close — Discuss Invoice — job 26901", exact: true });
    await expect(close).toBeVisible();
    page.once("dialog", async dialog => {
      expect(dialog.message()).toContain("Later downloads show yellow");
      await dialog.dismiss();
    });
    await close.click();
    expect(captures.jobInfo).toHaveLength(0);
    page.once("dialog", dialog => dialog.accept());
    await close.click();
    await expect(page.locator(".job-topline .status-pill")).toHaveText("Discuss invoice");
    expect(captures.jobInfo[0].body).toMatchObject({ active: false, invoiceReview: true });
    await page.getByRole("button", { name: "← All jobs", exact: true }).click();
    await page.getByLabel("Search jobs", { exact: true }).fill("26901");
    const row = page.locator(".jobs-table tbody tr");
    await expect(row).toHaveCount(1);
    await expect(row).toHaveClass(/job-invoice-review/);
    // Keep the compact directory's existing two actions and row density.
    await expect(row.locator(".job-status-actions button")).toHaveCount(2);
    for (const theme of ["light", "dark"]) {
      await page.evaluate(theme => window.applyJgcTheme(theme), theme);
      const backgrounds = await row.locator("td").evaluateAll(cells => cells.filter(c => c.checkVisibility()).map(c => getComputedStyle(c).backgroundColor));
      expect(backgrounds.length).toBeGreaterThan(0);
      backgrounds.forEach(color => expect(["rgb(219, 234, 254)", "rgb(191, 219, 254)"]).toContain(color));
      const contrast = await row.evaluate(element => {
        const luminance = value => {
          const c = value.match(/[\d.]+/g).slice(0,3).map(Number).map(x => x/255).map(x => x<=.04045 ? x/12.92 : ((x+.055)/1.055)**2.4);
          return .2126*c[0]+.7152*c[1]+.0722*c[2];
        };
        return [...element.querySelectorAll("td > strong, td > small, .back-button")].map(e => {
          const bg = luminance(getComputedStyle(e.closest("td")).backgroundColor);
          const fg = luminance(getComputedStyle(e).color);
          return (Math.max(fg,bg)+.05)/(Math.min(fg,bg)+.05);
        });
      });
      expect(Math.min(...contrast)).toBeGreaterThanOrEqual(4.5);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2)).toBe(false);
      await page.screenshot({ path: testInfo.outputPath(`blue-${theme}-${width}.png`), fullPage: true });
    }
    await page.getByRole("button", { name: "Tiles", exact: true }).click();
    await expect(page.locator(".job-tile.job-invoice-review")).toHaveCount(1);
    await page.locator(".job-tile-open").click();
    await expect(page.getByRole("button", { name: /Mark ready to invoice/ })).toHaveCount(0);
    await expect(page.locator(".job-topline .status-pill")).toHaveText("Discuss invoice");
    await page.getByRole("button", { name: "Make active — job 26901", exact: true }).click();
    await expect(page.locator(".job-topline .status-pill")).toHaveText("Active");
    expect(captures.jobInfo.at(-1).body).toMatchObject({ active: true });
    await expect(page.getByRole("button", { name: "Close — Discuss Invoice — job 26901", exact: true })).toBeVisible();
    expect(JSON.stringify(state.quotes)).toBe(originalQuote);
    expect(captures.unexpectedRequests).toEqual([]);
  });
}

test("failed discussion close does not show blue or hide the active job", async ({ page }) => {
  const captures = await serveDirectory(page, directoryState(), { failJobInfo: true });
  await openDirectoryJob(page, "26903");
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "Close — Discuss Invoice — job 26903", exact: true }).click();
  await expect(page.locator(".job-topline .status-pill")).toHaveText("Active");
  await expect(page.getByText("Canonical job update rejected for this test")).toBeVisible();
  expect(captures.writes).toEqual([]);
});

test("loading a saved blue job preserves its flag and reopening clears it", async ({ page }) => {
  const state = directoryState();
  Object.assign(state.jobs[0], { status: "Archived", portalActive: false, invoiceReviewAt: "2026-09-08T18:00:00Z" });
  const captures = await serveDirectory(page, state);
  await openDirectoryJob(page, "26901");
  await expect(page.locator(".job-topline .status-pill")).toHaveText("Discuss invoice");
  await page.getByRole("button", { name: "Make active — job 26901", exact: true }).click();
  await expect(page.locator(".job-topline .status-pill")).toHaveText("Active");
  expect(captures.jobInfo[0].body).toMatchObject({ active: true });
});
