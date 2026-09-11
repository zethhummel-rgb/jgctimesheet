const { test, expect } = require("@playwright/test");

async function openNewQuote(page) {
  await page.goto("/estimating/index.html?dev=1");
  await page.getByRole("button", { name: "New quote", exact: true }).click();
  await expect(page.getByRole("tab", { name: /Details/ })).toBeVisible();
}

async function choosePickerOption(page, label) {
  const results = page.locator(".saved-data-results");
  await expect(results).toBeVisible();
  await results.getByRole("option").filter({ hasText: label }).first().click();
}

async function currentQuoteNumber(page) {
  const identity = await page.locator(".quote-identity .eyebrow").first().textContent();
  const match = identity && identity.match(/JGC-Q-\d{4}-\d{4}/);
  expect(match).toBeTruthy();
  return match[0];
}

test("new clients can be added from quote setup and reused on the next quote", async ({ page }) => {
  await page.setViewportSize({ width: 1365, height: 900 });
  await openNewQuote(page);

  const clientPicker = page.getByRole("combobox", { name: "Client" });
  await clientPicker.fill("Acme Quote Client");
  await page.getByRole("button", { name: "＋ Add new Client: Acme Quote Client" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Add new client" })).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: /Client name/ })).toHaveValue("Acme Quote Client");
  await dialog.getByRole("textbox", { name: "Attention name" }).fill("Avery Buyer");
  await dialog.getByRole("textbox", { name: "Role / department" }).fill("Facilities");
  await dialog.getByRole("textbox", { name: "Phone" }).fill("16135551234");
  await expect(dialog.getByRole("textbox", { name: "Phone" })).toHaveValue("1-613-555-1234");
  await dialog.getByRole("textbox", { name: "Extension" }).fill("246");
  await dialog.getByRole("textbox", { name: "Email" }).fill("avery@example.com");
  await dialog.getByRole("textbox", { name: "Site name" }).fill("Acme Plant 4");
  await dialog.getByRole("textbox", { name: "Address" }).fill("400 Industrial Road");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toHaveCount(0);

  await expect(clientPicker).toHaveValue("Acme Quote Client");
  await expect(page.getByRole("combobox", { name: "Attention contact" })).toHaveValue("Avery Buyer");
  await expect(page.getByRole("combobox", { name: "Site name" })).toHaveValue("Acme Plant 4");
  await expect(page.getByRole("textbox", { name: "Address" })).toHaveValue("400 Industrial Road");

  await page.getByRole("button", { name: "Clients", exact: true }).click();
  const card = page.locator(".entity-card").filter({ hasText: "Acme Quote Client" });
  await expect(card).toContainText("Acme Plant 4");
  await expect(card).toContainText("Avery Buyer");
  await expect(card.getByRole("button", { name: "Copy avery@example.com" })).toBeVisible();

  await page.getByRole("button", { name: "New quote", exact: true }).click();
  const nextClientPicker = page.getByRole("combobox", { name: "Client" });
  await nextClientPicker.fill("Acme Quote Client");
  await choosePickerOption(page, "Acme Quote Client");
  const sitePicker = page.getByRole("combobox", { name: "Site name" });
  await sitePicker.fill("Acme Plant 4");
  await choosePickerOption(page, "Acme Plant 4");
  await expect(page.getByRole("textbox", { name: "Address" })).toHaveValue("400 Industrial Road");
  const attentionPicker = page.getByRole("combobox", { name: "Attention contact" });
  await attentionPicker.fill("Avery Buyer");
  await choosePickerOption(page, "Avery Buyer");
  await expect(attentionPicker).toHaveValue("Avery Buyer");
});

test("existing clients can receive new sites and attention contacts from quote setup", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openNewQuote(page);

  const clientPicker = page.getByRole("combobox", { name: "Client" });
  await clientPicker.fill("BGIS");
  await choosePickerOption(page, "BGIS");

  const sitePicker = page.getByRole("combobox", { name: "Site name" });
  await sitePicker.fill("D&D Carling");
  await page.getByRole("button", { name: "＋ Add new site: D&D Carling" }).click();
  let dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Add site" })).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: /Client name/ })).toHaveValue("BGIS — demo only");
  await dialog.getByRole("textbox", { name: "Address" }).fill("60 Moodie");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(sitePicker).toHaveValue("D&D Carling");
  await expect(page.getByRole("textbox", { name: "Address" })).toHaveValue("60 Moodie");

  const attentionPicker = page.getByRole("combobox", { name: "Attention contact" });
  await attentionPicker.fill("Morgan Contact");
  await page.getByRole("button", { name: "＋ Add new attention: Morgan Contact" }).click();
  dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Add attention" })).toBeVisible();
  await dialog.getByRole("textbox", { name: "Role / department" }).fill("Operations");
  await dialog.getByRole("textbox", { name: "Email" }).fill("morgan@example.com");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(attentionPicker).toHaveValue("Morgan Contact");

  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("button", { name: "Clients", exact: true }).click();
  const card = page.locator(".entity-card").filter({ hasText: "BGIS" });
  await expect(card).toContainText("D&D Carling");
  await expect(card).toContainText("60 Moodie");
  await expect(card).toContainText("Morgan Contact");
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
});

test("untouched blank quotes close without consuming the next quote number", async ({ page }) => {
  await page.setViewportSize({ width: 1365, height: 900 });
  await openNewQuote(page);
  const firstNumber = await currentQuoteNumber(page);

  await page.locator(".back-button").click();
  await expect(page.locator(".quote-identity")).toHaveCount(0);

  await page.getByRole("button", { name: "New quote", exact: true }).click();
  await expect.poll(() => currentQuoteNumber(page)).toBe(firstNumber);
});
