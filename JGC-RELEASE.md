# JGC Portal Release Safety

Run `run-jgc-release-check.bat` before pushing portal changes to GitHub. You can launch the copy in either the working `index.html` folder or the `GitHub\jgctimesheet` folder; the checker locates and compares the paired folders automatically. A successful check confirms:

- root JavaScript files and inline page scripts parse correctly;
- local HTML asset references point to existing files;
- versioned asset references are consistent across pages;
- every portal page is represented in the service-worker app shell;
- service-worker entries exist and are not duplicated;
- every cached portal page opens in Chromium without an uncaught JavaScript error;
- login controls, admin tabs, PO tabs, and the mobile More menu respond correctly;
- the service worker installs and controls a portal page in a real browser;
- the shared design-system version matches the cached version; and
- release files in the working folder match the `GitHub\jgctimesheet` mirror.

The browser checks use a local static server and a fake approved-admin session. Supabase, Google Script, and email requests are intercepted, so the tests do not read or change production data. The checker does not modify portal files. It exits with a failure status when a release problem is found, making the result suitable for a future automated deployment or Git hook.

## One-Time Browser Setup

From the portal folder, run:

```powershell
npm install
npm run smoke:install
```

After setup, `run-jgc-release-check.bat` runs both the static release verifier and the browser smoke tests. To run only the browser checks, launch `run-jgc-smoke-tests.bat`. For visible browser troubleshooting, run `npm run smoke:headed`.

The browser test page list comes from `JGC_APP_SHELL` in `service-worker.js`. Adding a page to the app shell automatically adds it to the page-opening smoke test. Focused actions live in `smoke-tests/portal.smoke.spec.js` and should be expanded when a new workflow introduces an important tab or command.

## Service Worker Rules

`JGC_RELEASE_ID` in `service-worker.js` is the single release-level cache number. Advance it whenever deployable portal code, page markup, or shared assets change.

Individual `?v=` values identify revisions of specific assets. Every page referencing the same asset must use the same value. The release checker reports mixed values.

A new service worker now activates only after every app-shell file downloads successfully. If a deployed file is missing, the new worker fails installation and the previously working worker remains active.

Old cache cleanup is limited to caches beginning with `jgc-portal-v`, so unrelated browser caches on the same origin are not removed.
