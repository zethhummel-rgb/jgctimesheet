
const { test, expect } = require("@playwright/test");
const { directoryState, serveDirectory, openDirectoryJob } = require("./fixtures/job-readability-fixture");

for (const width of [390, 1366]) {
  for (const action of ["Close Project", "Close — Discuss Invoice"]) {
    test("closed date shows after " + action + " and clears on reopening at " + width, async ({ page }, testInfo) => {
      const state = directoryState();
      const captures = await serveDirectory(page, state);
      await page.setViewportSize({ width, height: 960 });
      await openDirectoryJob(page, "26901");
      await expect(page.getByText(/Date closed:/)).toHaveCount(0);
      page.once("dialog", d => d.accept());
      await page.getByRole("button", { name: action + " — job 26901", exact: true }).click();
      await expect(page.getByText(/Date closed:/)).toContainText("Sep");
      await expect(page.getByText(/Date closed:/)).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2)).toBe(false);
      await page.screenshot({ path: testInfo.outputPath("date-closed.png"), fullPage: false });
      await page.getByRole("button", { name: "Make active — job 26901", exact: true }).click();
      await expect(page.getByText(/Date closed:/)).toHaveCount(0);
      expect(captures.jobInfo.map(c => c.body.active)).toEqual([false, true]);
      expect(captures.unexpectedRequests).toEqual([]);
    });
  }
}
test("older closed job without a recorded closure date stays blank", async ({ page }) => {
  const state = directoryState();
  Object.assign(state.jobs[0], { status: "Archived", portalActive: false, closedAt: "" });
  await serveDirectory(page, state);
  await openDirectoryJob(page, "26901");
  await expect(page.getByRole("button", { name: "Make active — job 26901", exact: true })).toBeVisible();
  await expect(page.getByText(/Date closed:/)).toHaveCount(0);
});
