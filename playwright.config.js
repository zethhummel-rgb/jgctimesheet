const { defineConfig, devices } = require("@playwright/test");

const smokePort = Number(process.env.JGC_SMOKE_PORT || 41738);
const baseURL = `http://127.0.0.1:${smokePort}`;

module.exports = defineConfig({
  testDir: "./smoke-tests",
  timeout: 20_000,
  expect: {
    timeout: 5_000
  },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["line"]],
  use: {
    baseURL,
    serviceWorkers: "block",
    screenshot: "only-on-failure",
    trace: "retain-on-failure"
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"]
      }
    }
  ]
});
