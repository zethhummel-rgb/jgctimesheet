# JGC Portal Full Technical Audit

**Audit date:** July 18, 2026  
**Environment:** JGC Portal static PWA, GitHub Pages, Supabase, Google Apps Script  
**Production URL:** https://zethhummel-rgb.github.io/jgctimesheet/  
**Supabase project:** `xnrljkkszoimegfivlya` (`ACTIVE_HEALTHY`, `us-east-2`, PostgreSQL 17.6)  
**Audit mode:** Read-only. No portal behavior, database rows, policies, functions, or deployment files were changed.

## Executive Summary

The portal's client application is currently healthy. All 45 HTML pages are present in the offline shell, all local references resolve, JavaScript syntax passes, all 19 browser smoke tests pass, the calculator tests pass, the service worker installs and controls the app, and the deployed GitHub Pages app-shell matches the local release after normalizing Windows line endings.

The latest backup is also healthy and includes the data that was previously suspected to be missing: timesheets, employee profiles, jobs, work orders, purchase orders, and all configured persistent Storage buckets.

The most important problems are not page-loading failures. They are live Supabase authorization weaknesses. RLS is enabled on all 55 public tables, but numerous live policies are broad enough to permit anonymous reads, inserts, updates, or deletes. Several Storage buckets also permit public object mutation. The public Supabase key in the browser is expected and is not itself a secret; these permissive policies are what make that public key dangerous.

### Post-audit remediation: anonymous table access

On July 18, 2026, migrations `lock_down_anonymous_table_access` and `validate_anonymous_safety_submissions` addressed the anonymous table-access findings in this report. Anonymous read/update/delete access was removed from timesheets, submitted weeks, certificates, stored inspection history, accident/injury/incident history, toolbox assignments/reports/attendance, and safety acknowledgement rows. Authenticated grants and equivalent authenticated policies were retained.

The intended subcontractor workflows now retain only validated insert access. Anonymous users may read active toolbox-talk metadata, but not reports or attendance history. The JSA/toolbox QR acknowledgement workflow remains available through its token-validating database functions; both an invalid-token rejection and a valid existing QR-token lookup were verified under the `anon` role after the migration. Supabase's security advisor reports no remaining always-true anonymous RLS policies in this set. Storage-policy remediation remains a separate outstanding action.

## Priority Findings

| Priority | Finding | Result |
|---|---|---|
| **Critical** | Anonymous timesheet access | The live policies permit anonymous reads and writes against `timesheet_entries`, including deletion, and broad access to `previous_timesheet_weeks`. There are currently 21 timesheet entries and 37 submitted-week records. |
| **Critical** | Anonymous safety-record access | Accident, incident, injury, toolbox-talk, acknowledgement, and inspection policies include broad public reads and/or writes. Most safety report tables are currently empty, but the exposure will apply as soon as records are added. |
| **Critical** | Public Storage mutation | `incident-photos` and `toolbox-talks` permit public select/insert/update/delete and have no file-size or MIME restrictions. `profile-photos` lets authenticated users modify paths not limited to their own account. |
| **High** | Certificates are effectively exposed | The certificate metadata table allows anonymous reads/inserts, while the private certificate bucket permits anonymous object reads/uploads through policy. Because object paths can be discovered from table data, private-bucket status alone does not protect the PDFs. There are 30 certificate rows and about 8.3 MB of files. |
| **High** | Work-order permissions are not least privilege | Approved authenticated users can broadly manage all work orders and child rows. This does not limit changes to the creator, assigned employee, or an admin. |
| **High** | Public legacy email function | Live Edge Function `send-timesheet-email` has `verify_jwt=false`, is absent from the local function source, and still uses Resend. It is not referenced by the current browser code, but remains callable and conflicts with the intended Google Script email architecture. |
| **High** | Database restore source is incomplete | Supabase contains roughly 74 applied migrations, while the local `supabase/migrations` directory contains only 11 files. Top-level setup SQL helps, but it is not a chronological, replayable migration history. A new project cannot yet be recreated confidently from Git alone. |
| **Medium** | Edge Function source drift | `jgc-calendar-feed` differs between live and local source; `send-timesheet-email` exists only live; `send-push-notification` matches live locally but GitHub contains an older implementation. |
| **Medium** | Publicly executable security-definer functions | The advisor reports 17 anonymous and 42 authenticated grants on security-definer functions. Many function bodies perform their own `auth.uid()` or role checks, so this is not 59 proven bypasses, but unnecessary execute grants increase risk and should be removed. |
| **Medium** | Offline holes in three pages | `admin.html`, `todays-inspections.html`, and `previous-inspections.html` load QR/PDF libraries directly from a CDN. Equipment QR generation also calls `api.qrserver.com`. Those features are not reliably available offline. |
| **Medium** | Google email connectors cannot be safely live-tested in an audit | Three Google Apps Script endpoints are configured consistently in source. Smoke tests verify client wiring with mocks. A production invocation was intentionally not made because it could send real email or change workflow state. |
| **Medium** | Local Git metadata is stale | Local `HEAD` and `origin/main` point to `8ca5245...`, while current GitHub `main` is `37737d6...`. This makes local `git status` show 165 misleading changes even though the deployed source is nearly aligned. |
| **Low** | Password leak protection is disabled | Supabase Auth leaked-password protection is not enabled. |
| **Low** | No application Content Security Policy | No CSP was found in the portal HTML. GitHub Pages controls its platform headers, but the app does not restrict script, connection, frame, or image origins itself. |

## Verified Passes

### Local release and runtime

- Release ID: `601`
- App shell: 116 entries representing 114 unique local files
- Offline payload: 6.24 MB
- Missing app-shell files: 0
- Duplicate app-shell entries: 0
- Broken local HTML/script/style/image references: 0
- Version-reference inconsistencies: 0
- Standalone JavaScript syntax: 34 files passed
- Inline JavaScript syntax: 40 scripts passed
- Browser smoke tests: 19 of 19 passed in Chromium
- Calculator unit tests: passed
- Source-to-`GitHub/jgctimesheet` release mirror check: passed for the 126 release files checked by the release script

The smoke suite covers page opening without uncaught JavaScript crashes, required assets, service-worker install/control, login controls, admin navigation, lazy admin sections, inspection and vacation categories, employee directories, work-order lazy loading, purchase-order controls, and the mobile More menu.

### Production deployment

- GitHub Pages root: HTTP 200 at `/jgctimesheet/`
- Production service worker: HTTP 200
- Local release: `601`
- Production release: `601`
- Production app-shell comparison: 114 of 114 files substantively match local after normalizing CRLF/LF line endings
- Production Supabase project: `ACTIVE_HEALTHY`
- Sampled recent Edge Function, Auth, API, Storage, and PostgreSQL logs did not show a current platform outage
- Sampled last 100 Edge Function responses were HTTP 200

### Backups

Latest backup inspected:

`JGC Portal Backups/jgc-portal-backup-2026-07-17_21-01-00.zip`

- Website export: passed, 173 files
- Database export: passed, 55 of 55 tables, 0 failed
- Database rows: 1,283
- Storage export: passed, 94 objects, 44,530,643 bytes
- ZIP validation: passed, 344 entries
- Timesheet data present: 21 live entries and 37 previous submitted weeks
- Profiles present: 10
- Jobs present: 289
- Work orders present: 39
- Digital purchase orders present: 6
- Restore status: `READY_WITH_MANUAL_SCHEMA_AND_IMPORT_STEPS`

The Diagnostics message `No backup result recorded` does not mean the backup failed. The PowerShell backup process does not currently write its result into `portal_diagnostics`; the backup ZIP and manifest are the authoritative evidence.

## Page Coverage

Every HTML page below is in the release inventory, resolves its local dependencies, and opened in the browser smoke environment without a fatal JavaScript error.

### Authentication and public entry pages

| Page | Result |
|---|---|
| `index.html` | Pass |
| `reset-password.html` | Pass |
| `acknowledge.html` | Pass |
| `subcontractor.html` | Pass |

### Employee and operational pages

| Page | Result | Page | Result |
|---|---|---|---|
| `home.html` | Pass | `timesheet.html` | Pass |
| `inspections.html` | Pass | `todays-inspections.html` | Pass |
| `previous-inspections.html` | Pass | `certificates.html` | Pass |
| `vacation-request.html` | Pass | `schedule.html` | Pass |
| `tasks.html` | Pass | `contacts.html` | Pass |
| `subcontractors-suppliers.html` | Pass | `policies-announcements.html` | Pass |
| `equipment-vehicles.html` | Pass | `field-calculator.html` | Pass |
| `jobs.html` | Pass | `work-orders.html` | Pass |
| `purchase-orders.html` | Pass | `permits.html` | Pass |
| `confined-space-permit.html` | Pass | `excavation-permit.html` | Pass |
| `reports.html` | Pass | `daily-site-report.html` | Pass |
| `accident-report.html` | Pass | `employee-injury-report.html` | Pass |
| `incident-report.html` | Pass | `toolbox-talks.html` | Pass |
| `aerial-lifts.html` | Pass | `forklift.html` | Pass |
| `harness.html` | Pass | `hot-work-permit.html` | Pass |
| `jsa.html` | Pass | `tele-handler.html` | Pass |
| `equipment-inspection.html` | Pass | `vehicle-inspection.html` | Pass |
| `notification-settings.html` | Pass |  |  |

### Admin pages

| Page | Result |
|---|---|
| `admin.html` | Pass |
| `accounts.html` | Pass |
| `certificates-admin.html` | Pass |
| `policies-admin.html` | Pass |
| `purchase-orders-admin.html` | Pass |
| `diagnostics-admin.html` | Pass |

These page results prove that the client can load and wire its controls. The smoke environment mocks Supabase and Google Script responses; live policy and connector results are reported separately below.

## File and Repository Inventory

### Local source inventory

- Total source/release files discovered: 183 with the normal inventory; 185 when hidden release-control files are included
- HTML: 45
- JavaScript: 42
- SQL: 42
- CSS: 25
- Markdown: 7 before this report
- TypeScript: 5
- PNG: 5
- PowerShell: 3
- Batch: 3
- Other release/config assets: JSON, YAML, WebP, and text files

Largest maintainability/performance hotspots:

| File | Approximate size |
|---|---:|
| `login-background.webp` | 1.27 MB |
| `vendor/exceljs.min.js` | 926 KB |
| `vendor/lucide.min.js` | 399 KB |
| `vendor/jspdf.umd.min.js` | 356 KB |
| `vendor/supabase-js.min.js` | 199 KB |
| `timesheet.html` | 172 KB |
| `common.js` | 156 KB |
| `logo.webp` | 153 KB |
| `work-orders.html` | 130 KB |
| `home.html` | 111 KB |
| `admin-summary.js` | 107 KB |

Large files are not necessarily broken, but `common.js`, `timesheet.html`, and `work-orders.html` remain high-blast-radius modules. Continue splitting only along tested module boundaries.

### Local versus current GitHub main

- Local Git commit/ref: `8ca5245b0cf486a266ddd0701470d58a9828ede2`
- Current GitHub main: `37737d639c404c8eec7de64266d2e1a11ca9528f`
- Shared files compared with normalized line endings: 184
- Shared files with matching contents: 183
- Shared source difference: `supabase/functions/send-push-notification/index.ts`
- Local-only file: `supabase-notifications-dedupe-fix.sql`
- Remote-only obsolete image files: `login-background.jpeg`, `logo.png`
- All 114 deployable app-shell files match production

Recommended operational correction: fetch GitHub before using local `git status` to decide what still needs committing. Do not blindly commit the apparent 165-entry change list against the stale local reference.

## Supabase Database Review

### Shape and health

- Public tables: 55
- Tables with RLS enabled: 55
- Client-referenced tables found statically: 53
- Tables not directly referenced by client code: `toolbox_talk_assignments`, `work_order_labour_timesheet_links` (they may still be used by server-side functions/triggers)
- RPC names referenced by the client: 38
- Security Advisor findings: 97 total (96 warnings, 1 informational)
- Performance Advisor findings: 191 total (109 warnings, 82 informational)

RLS being enabled is a pass only at the first layer. A policy such as `USING (true)` or `WITH CHECK (true)` can still expose the entire table.

### Confirmed broad anonymous table access

| Area | Live access requiring correction |
|---|---|
| Timesheets | `timesheet_entries`: public select/insert/update/delete. `previous_timesheet_weeks`: public select/insert/delete. |
| Certificates | Public select and insert on certificate metadata. |
| Inspections | Broad public select/insert/update on `inspection_records`. |
| Incident reports | Public select/insert/update. |
| Accident and injury reports | Public select/insert; acknowledgement tables also permit broad public select/insert/update. |
| Toolbox talks | Public select/insert/update on talks, assignments, reports, and attendance; attendance also permits public delete. |

The July 18 delete-policy migration removed anonymous delete from certificates, inspection records, and toolbox assignments. It did not remove the broader public access listed above, and it did not remove anonymous delete from timesheet data or toolbox attendance.

### Security Advisor categories

| Advisor category | Count | Interpretation |
|---|---:|---|
| RLS enabled with no policy | 1 | `digital_po_email_outbox`; this appears intentional for service-role-only processing. |
| Mutable function search path | 6 | Set explicit `search_path` on the remaining trigger/helper functions. |
| Extension in public schema | 1 | `pg_net`; move when practical. |
| RLS policy always true | 29 | Confirmed broad policy surface; includes the critical findings above. |
| Anonymous security-definer function executable | 17 | Revoke grants not needed by public clients. |
| Authenticated security-definer function executable | 42 | Narrow grants to the intended roles/functions. |
| Leaked password protection disabled | 1 | Enable in Auth settings. |

Relevant Supabase guidance:

- RLS: https://supabase.com/docs/guides/database/postgres/row-level-security
- Permissive policies: https://supabase.com/docs/guides/database/database-linter?lint=0024_permissive_rls_policy
- Security-definer grants: https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable
- Function search path: https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable
- Password protection: https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection

### Performance Advisor categories

| Category | Count | Recommended handling |
|---|---:|---|
| Unindexed foreign keys | 37 | Add indexes first on high-traffic parent/child lookups. |
| Auth calls re-evaluated per row in RLS | 47 | Replace repeated `auth.uid()` evaluation with the recommended init-plan pattern. |
| Multiple permissive policies | 62 | Consolidate while fixing authorization semantics. |
| Unused indexes | 45 | Review, but do not bulk-delete; usage statistics may be young or reset. |

Performance guidance:

- Unindexed foreign keys: https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys
- RLS init-plan optimization: https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan

## Storage Review

| Bucket | Visibility / limits | Result |
|---|---|---|
| `announcements` | Private, 10 MB, PDF | Pass; scoped policies |
| `certificates` | Private, 10 MB, PDF/JPEG/PNG | **Fail; anonymous metadata/object access is too broad** |
| `digital-po-temp` | Private, 12 MB, PDF/JPEG/PNG/WebP | Pass; temporary workflow bucket |
| `equipment-documents` | Private, 25 MB, PDF | Pass; signed-link workflow present |
| `incident-photos` | Private flag, no MIME/size limit | **Fail; public select/insert/update/delete policies** |
| `policies` | Private, 10 MB, PDF | Pass; scoped policies |
| `profile-photos` | Public, no MIME/size limit | **Needs correction; authenticated users are not restricted to their own path** |
| `toolbox-talks` | Private flag, no MIME/size limit | **Fail; public select/insert/update/delete policies** |

Private bucket metadata is not sufficient when `storage.objects` policies permit public access. See Supabase Storage access control: https://supabase.com/docs/guides/storage/security/access-control

## Edge Functions and Scheduled Jobs

### Live Edge Functions

| Function | JWT setting | Source state | Audit result |
|---|---|---|---|
| `send-timesheet-email` v8 | `verify_jwt=false` | Missing locally | **High:** stale Resend function; secure or remove |
| `send-schedule-reminders` v12 | `verify_jwt=false` | Local/live match | Public invocation surface; add a scheduler secret or JWT gate |
| `jgc-calendar-feed` v11 | `verify_jwt=false` | Live differs from local | Uses a feed token internally; reconcile source |
| `auto-submit-work-orders` v7 | `verify_jwt=true` | Local/live match | Pass |
| `send-push-notification` v3 | `verify_jwt=true` | Local/live match; GitHub older | Function is healthy; commit current source |
| `send-digital-po-email` v13 | `verify_jwt=false` | Local/live match | User/admin paths validate auth internally; worker path remains public |

`verify_jwt=false` is not automatically a vulnerability when a function validates its own secret or user token. The table above accounts for those internal checks.

### Cron jobs

Three active cron jobs run successfully:

1. Schedule reminders every 15 minutes
2. Work-order auto-submit every 15 minutes
3. Digital PO email worker every 5 minutes

The work-order and PO jobs read URL/key material from Vault. The reminder job embeds a public/publishable key in its command; that key is not secret, but moving all job configuration to Vault would be cleaner.

## External Connectors

### Google Apps Script

Three configured script endpoints were found:

1. General operational email endpoint used by announcements, certificates, equipment, reports, schedule, inspections, vacation, toolbox talks, and work orders
2. Dedicated timesheet email endpoint
3. Google Calendar synchronization endpoint

The endpoint references are consistent across source files. Client request construction passes syntax and smoke tests. A production request was not sent during this audit because it could send actual company email or alter calendar/workflow state. A complete end-to-end test should use an agreed test recipient, test schedule item, and test timesheet.

### Third-party libraries and QR service

Most core libraries are bundled locally with CDN fallback: Supabase JS, jsPDF on PO pages, Lucide, ExcelJS, JSZip, and TUS. This is good for offline use.

Remaining direct online dependencies:

- `admin.html`: QRCode library from jsDelivr
- `todays-inspections.html`: jsPDF and QRCode from jsDelivr
- `previous-inspections.html`: jsPDF from jsDelivr
- `admin-equipment.js`: QR image generation through `api.qrserver.com`

Bundle QRCode locally and switch the inspection pages to the existing local jsPDF bundle to close these offline gaps.

## PWA and Offline Review

- Manifest exists and resolves
- Service worker registers and controls the portal
- All 45 HTML pages are included in the app shell
- All local app-shell resources exist
- Offline payload is internally consistent
- Mobile navigation smoke test passes
- Pull-to-refresh and service-worker update paths are syntactically and behaviorally covered by the smoke suite

Offline limitation: browser smoke tests cannot simulate every iOS installed-PWA lifecycle edge case. The direct CDN/QR dependencies listed above are confirmed offline gaps even though the pages themselves remain cached.

## Settings and Secret Review

- No Supabase service-role key, Resend API key, private VAPID key, or Google credential was found hardcoded in portal source
- Supabase's browser publishable key is expected to be public and must be protected by correct RLS/Storage policies
- Edge secrets are referenced through environment variables or Vault where expected
- Credentials are excluded from backups
- Auth leaked-password protection is disabled and should be enabled
- No app-level CSP was found

## Recommended Remediation Order

1. **Immediately lock down anonymous table policies.** Start with timesheets, certificate metadata, incident/accident/injury records, inspection records, and toolbox-talk tables. Preserve required QR/public submission workflows with narrow insert-only policies and server-side validation.
2. **Immediately lock down Storage.** Remove public mutation from `incident-photos` and `toolbox-talks`; restrict profile photos to an `auth.uid()` folder; add MIME and size limits; review anonymous certificate access.
3. **Restrict work-order mutations.** Use admin, creator, assignee, or explicit workflow predicates instead of all-approved-user access.
4. **Audit and revoke function grants.** Revoke anonymous/authenticated execute grants where RPCs are not intended for those roles; keep internal role checks as defense in depth.
5. **Remove or secure `send-timesheet-email`.** It is stale, public, uses the wrong provider, and is absent from source control.
6. **Create a database baseline.** Export a verified schema baseline including tables, policies, grants, functions, triggers, cron, and Storage policies; then keep every future change as a migration.
7. **Reconcile Edge Function source.** Commit the current push function, pull the live calendar-feed change into source, and remove live-only code.
8. **Refresh local Git refs.** Fetch current `main` before judging working-tree changes or pushing.
9. **Close offline library gaps.** Bundle QRCode and use the local jsPDF file on inspection pages; replace the external QR image API with local generation.
10. **Run a restore drill.** Restore the latest ZIP into a disposable Supabase project and document every manual step. A successful export is not yet proof of a successful full restore.
11. **Enable leaked-password protection and add a CSP.** Apply a tested CSP gradually because the portal currently uses inline scripts.
12. **Address performance advisors after authorization is correct.** Index high-use foreign keys and optimize RLS expressions; do not mass-delete unused indexes without measuring.

## Testing Limitations

- Browser smoke tests use mocked Supabase and Google Script responses to avoid modifying production.
- No real email, push notification, calendar write, PO send, WO submit, file upload, record deletion, or policy mutation was performed.
- Google Apps Script execution logs and source projects were not available to this workspace, so those endpoints were verified by static wiring rather than a live send.
- The backup was structurally inspected and validated, but not restored into a separate Supabase project during this audit.
- Security findings reflect live policies and grants visible on July 18, 2026. Re-run the advisors after every remediation migration.

## Overall Assessment

| Area | Rating |
|---|---|
| Client pages and navigation | **Healthy** |
| Production deployment parity | **Healthy** |
| PWA shell and local offline assets | **Healthy with three feature-level gaps** |
| Supabase service health | **Healthy** |
| Database authorization | **Critical remediation required** |
| Storage authorization | **Critical remediation required** |
| Edge/cron operations | **Operating, with source/auth cleanup required** |
| Backups | **Passing; restore drill still required** |
| Source control reproducibility | **Needs reconciliation** |
| Performance | **Acceptable at current scale; advisor cleanup recommended** |

The portal is not bricked and its main operational paths are loading correctly. The next release should prioritize RLS and Storage remediation before adding further features, because the current browser publishable key can exercise permissions that are broader than intended.
