# Portal job entry — release 890

## Behaviour

- Approved administrators create jobs from Jobs or the Portal Summary shortcut.
- Make into job opens the same review form with the finished quote filled in.
- Client, job name, job type and project manager are required. Contract jobs also require the customer selling price before tax.
- Job date is assigned in Toronto time by the database. Numbers use the date's two-digit year and a three-digit sequence. A full yearly range fails safely instead of issuing a duplicate.
- The database locks the shared workspace, checks its revision, and saves the canonical job, private estimating details, client changes, quote conversion and request receipt in one transaction.
- Opening, cancelling and failed validation do not allocate a number. Repeating a successful request returns its original job. Converted quotes cannot be converted again and are opened through their job.
- Employees receive active operational job details and document links. Prices, estimates and internal notes remain in the administrator-only workspace.
- Jobs refresh through the existing shared job-list notification and polling mechanism.
- Accounting downloads include manual job values, PO/WO reference, subcontractor flag and the creation date. Historical download versions remain unchanged.
- Excel upload is disabled but its code is retained. The Jobs download is at the bottom; Accounting remains the main download location.

## Database migration and evidence

Applied migration: `20260918174359_portal_job_entry.sql`.

`smoke-tests/job-entry-local-db.cjs` runs against an isolated PGlite install supplied through `JGC_PGLITE_MODULE`. It tests transactional rollback, retries, year rollover, conflicting requests and access rules.

`smoke-tests/job-entry-database-check.sql` performs synthetic administrator, employee and anonymous checks inside a rolled-back transaction. The deployed check passed; follow-up verification found zero retained synthetic jobs and zero consumed creation receipts.

Browser coverage includes desktop/phone creation, missing fields, quote prefill/conversion, repeated clicks, request retry, financial display, keyboard access, Summary navigation and accounting export fields. Import-specific browser tests are explicitly disabled with the upload feature; parser and rollback API tests remain available.

## Release validation result

The 530-case browser suite completed with 505 immediate passes and 21 failures caused by stale UI/fixture expectations. Those 21 cases were updated for the rollout and passed focused rechecks, for 526 passing cases in total. Four cases were skipped: three disabled Excel-import browser cases and one optional private-workbook comparison without its local reference file. Retained import parser/API coverage passed.

TypeScript, the production build, credential scanning and the release asset checks passed. The database checks left no synthetic production jobs or consumed numbers. No real customer job was created to test the release.

The isolated release verifier passed all 12 checks. All 37 release files match both approved local copies by hash. The whole deployment-mirror check also reports 32 pre-existing differences outside this release (older CSS/JavaScript and verifier files); those unrelated local files were preserved. This does not affect the isolated GitHub Pages build.

## Rollback

Revert the release's application changes if needed. The additive database function and receipts can remain; never delete created jobs or receipts to roll back the interface.

To restore Excel upload deliberately, enable `EXCEL_JOB_IMPORT_ENABLED` in the API bridge and restore the retained legacy controls/guards in `admin.html` and `admin-jobs.js`. Review imports before applying them; do not reset job history or request receipts.
