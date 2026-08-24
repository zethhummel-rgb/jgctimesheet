const { test, expect } = require("@playwright/test");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const portalRoot = path.resolve(__dirname, "..");
const adminCorePath = path.join(portalRoot, "admin-core.js");

function loadRetryHelpers() {
  const source = fs.readFileSync(adminCorePath, "utf8");
  const start = source.indexOf("const ADMIN_QUERY_RETRY_DELAYS_MS");
  const end = source.indexOf("\nfunction renderSubcontractorActivity", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);

  const logs = [];
  const context = {
    Promise,
    Error,
    TypeError,
    setTimeout(callback) {
      callback();
      return 1;
    },
    logAdminLoadError(label, error) {
      if (!error?.adminLoadLogged) {
        logs.push({ label, error });
      }
    }
  };

  vm.createContext(context);
  vm.runInContext(
    source.slice(start, end) +
      "\n;globalThis.retryHelpers = { isTransientAdminNetworkError, runAdminQueries };",
    context
  );

  return { helpers: context.retryHelpers, logs, source };
}

test("temporary Admin network failures retry twice and recover without an alert", async () => {
  const { helpers, logs } = loadRetryHelpers();
  let attempts = 0;

  const results = await helpers.runAdminQueries([
    {
      label: "jobs",
      query() {
        attempts += 1;
        if (attempts < 3) {
          throw new TypeError("Load failed");
        }
        return { data: [{ job_number: "26074" }], error: null };
      }
    }
  ]);

  expect(attempts).toBe(3);
  expect(results[0].data).toEqual([{ job_number: "26074" }]);
  expect(results.adminFailures).toHaveLength(0);
  expect(logs).toHaveLength(0);
});

test("persistent temporary failures log only after all three attempts", async () => {
  const { helpers, logs } = loadRetryHelpers();
  let attempts = 0;

  const results = await helpers.runAdminQueries(
    [
      {
        label: "submitted timesheets",
        query() {
          attempts += 1;
          return { data: null, error: new TypeError("Load failed") };
        }
      }
    ],
    { allowPartial: true }
  );

  expect(attempts).toBe(3);
  expect(results.adminFailures).toHaveLength(1);
  expect(logs).toHaveLength(1);
  expect(logs[0].label).toBe("submitted timesheets");
});

test("database permission failures are not retried and leave the batch incomplete", async () => {
  const { helpers, logs } = loadRetryHelpers();
  let attempts = 0;
  let caughtError = null;

  try {
    await helpers.runAdminQueries([
      {
        label: "jobs",
        query() {
          attempts += 1;
          return { data: null, error: { code: "42501", message: "permission denied" } };
        }
      }
    ]);
  } catch (error) {
    caughtError = error;
  }

  expect(caughtError).toMatchObject({
    name: "AdminDataLoadError",
    adminLoadLogged: true,
    adminLoadLabel: "jobs"
  });

  expect(attempts).toBe(1);
  expect(logs).toHaveLength(1);
});

test("failed lazy sections remain retryable and reconnect recovery is registered", () => {
  const { source } = loadRetryHelpers();

  expect(source).toContain("adminTabDataFailed.add(tab)");
  expect(source).toContain("adminTabDataFailed.delete(tab)");
  expect(source).toContain("safetyRecordsSubtabDataFailed.add(requestedSubtab)");
  expect(source).toContain('window.addEventListener("online", retryFailedAdminLoadsAfterReconnect)');
  expect(source).not.toMatch(/\.finally\(\(\) => \{\s*adminTabDataLoaded\.add\(tab\)/);
  expect(source).not.toMatch(/\.finally\(\(\) => \{\s*safetyRecordsSubtabDataLoaded\.add\(requestedSubtab\)/);
});
