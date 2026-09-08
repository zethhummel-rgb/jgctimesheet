const { test, expect } = require("@playwright/test");
const { randomUUID } = require("crypto");
const { fixture, helpers, load } = require("./fixtures/job-accounting-fixture");
const { jobAccountingResponse } = load("estimating-app/src/job-accounting-api.ts", { "../lib/job-accounting-export": helpers });
function client(options = {}) {
  const tables = { profiles: [{ role: options.role ?? "admin", account_status: options.status ?? "approved" }], job_accounting_exports: [], job_accounting_export_downloads: [] }, calls = [];
  const api = { tables, calls, preview: fixture(), auth: { getUser: async () => ({ data: { user: { id: "admin-user" } } }) }, rpc: async () => ({ data: api.preview, error: null }), from(table) {
    const filters = []; let value, single = false, range = null, insert = false;
    const chain = { select() { return chain; }, eq(column, v) { filters.push((r) => r[column] === v); return chain; }, order() { return chain; }, range(a, b) { range = [a, b]; return chain; }, insert(v) { insert = true; value = v; return chain; }, single() { single = true; return chain; }, maybeSingle() { single = true; return chain; }, then(resolve, reject) { return execute().then(resolve, reject); } };
    async function execute() {
      calls.push({ table, insert });
      if (insert) {
        if (options.failSave && table === "job_accounting_exports") return { data: null, error: { message: "Database unavailable" } };
        if (tables[table].some((r) => r.id === value.id)) return { data: null, error: { code: "23505", message: "Duplicate" } };
        const row = { ...value, exported_at: "2026-09-08T12:00:00Z" }; tables[table].push(row);
        return { data: single ? row : null, error: null };
      }
      let rows = tables[table].filter((r) => table === "profiles" || filters.every((fn) => fn(r)));
      const count = rows.length;
      if (range) rows = rows.slice(range[0], range[1] + 1);
      return { data: single ? rows[0] ?? null : rows, count, error: null };
    }
    return chain;
  } };
  return api;
}
async function send(c, body, query = "", method) {
  const r = await jobAccountingResponse(c, new Request(`https://example.test/api/job-accounting-export${query}`, body ? { method: method ?? "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } } : { method: method ?? "GET" }));
  return { status: r.status, body: await r.json() };
}
async function payload(c) {
  const bytes = new TextEncoder().encode("PK\u0003\u0004Synthetic workbook");
  return { action: "save", id: randomUUID(), preview: structuredClone(c.preview), fileBase64: helpers.accountingBytesToBase64(bytes), fileSha256: await helpers.accountingFileHash(bytes) };
}
test("accounting endpoint denies ordinary employees and inactive admins before reading history", async () => {
  for (const options of [{ role: "employee" }, { status: "inactive" }]) {
    const c = client(options); expect((await send(c)).status).toBe(403);
    expect(c.calls.some((r) => r.table !== "profiles")).toBe(false);
  }
});
test("save is idempotent and a re-download logs a request without writing jobs or making another version", async () => {
  const c = client(), body = await payload(c);
  expect((await send(c, body)).status).toBe(201);
  const second = await send(c, body);
  expect(second.body.reused).toBe(true); expect(c.tables.job_accounting_exports).toHaveLength(1);
  const download = { action: "download", exportId: body.id, requestId: randomUUID() };
  expect((await send(c, download)).body.record.file_base64).toBe(body.fileBase64);
  expect((await send(c, download)).status).toBe(200);
  expect(c.tables.job_accounting_export_downloads).toHaveLength(1);
  expect(c.calls.every((r) => ["profiles", "job_accounting_exports", "job_accounting_export_downloads"].includes(r.table))).toBe(true);
});
test("stale preview and mismatched checksum fail without saving", async () => {
  const c = client(), body = await payload(c); c.preview.version = 2;
  expect((await send(c, body)).status).toBe(409);
  c.preview.version = 1; body.fileSha256 = "b".repeat(64);
  expect((await send(c, body)).status).toBe(400);
  expect(c.tables.job_accounting_exports).toEqual([]);
});
test("failed save advances neither history nor the colour snapshot", async () => {
  const c = client({ failSave: true }), before = JSON.stringify(c.preview);
  expect((await send(c, await payload(c))).status).toBe(500);
  expect(c.tables.job_accounting_exports).toEqual([]); expect(JSON.stringify(c.preview)).toBe(before);
});
test("metadata listing never includes file contents and unsupported mutations are rejected", async () => {
  const c = client();
  expect((await send(c, {}, "", "PATCH")).status).toBe(405);
  expect((await send(c, undefined, "?id=not-a-version")).status).toBe(400);
  expect((await send(c)).body).toMatchObject({ history: [], count: 0 });
});
