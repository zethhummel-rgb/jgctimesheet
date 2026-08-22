# JGC Portal Codex Handoff

Updated: August 2, 2026

## Instructions For The New Codex Task

Continue working on the existing JGC Portal. Do not create a replacement project, a new repository, or a separate implementation.

Use these existing folders:

- Primary working folder: `C:\Users\Zeth\OneDrive - JOHN GORDON CONSTRUCTION INC\Documents\index.html`
- Deployment mirror: `C:\Users\Zeth\OneDrive - JOHN GORDON CONSTRUCTION INC\Documents\index.html\GitHub\jgctimesheet`
- GitHub repository: `https://github.com/zethhummel-rgb/jgctimesheet.git`
- Production branch: `main`

For every completed code change:

1. Inspect the current files and Git state before editing.
2. Work in the primary folder and preserve all unrelated user changes.
3. Mirror every changed deployable file to the matching path under `GitHub\jgctimesheet`.
4. Advance `JGC_RELEASE_ID` in `service-worker.js` for deployable page, JavaScript, CSS, or asset changes.
5. Keep shared `?v=` asset versions consistent on every page that references the changed asset.
6. Run `run-jgc-release-check.bat` before publishing. Run focused Playwright tests while developing.
7. Stage only the files belonging to the current task. Do not stage the entire dirty tree.
8. Commit the verified change with a clear message and push it to GitHub `main`.
9. Report the commit SHA and push result to the user.

The user explicitly wants Codex to commit and push completed work. If a push is rejected because GitHub is ahead, fetch and integrate carefully. Never use `git reset --hard`, force-push, or discard local changes.

## Critical Git State

The primary folder is not a clean checkout. At the time of this handoff:

- Local branch: `main`
- Local HEAD: `39f09e0 Organize admin safety records`
- Git reports local `main` as `ahead 4, behind 1216` relative to `origin/main`.
- The primary folder contains many modified and untracked files representing ongoing portal work.
- Do not pull, merge, rebase, reset, or broadly restore this working folder until its changes have been audited.
- Do not assume a file is disposable because it is untracked.

The current GitHub tip known at handoff is:

- `3892c1b Fix safety report template syntax`
- Before it: `e2dcb60 Unify JSA PDF exports`
- Before it: `619575f Improve JSA report viewing`
- Before it: `98c7cf4 Limit inspection management actions`

Recent verified publishing used a clean worktree at:

`C:\Users\Zeth\AppData\Local\Temp\jgc-jsa-signoff-publish-20260731`

That worktree was on `codex/jsa-signoff-flow`, tracking the production history. Check whether it still exists and is clean before using it. A safe publishing pattern is to prepare and test the exact task files in a clean worktree based on the latest `origin/main`, then commit only those files. Never replace the primary working folder with the clean worktree.

## Product And Architecture

The JGC Portal is a static, installable PWA hosted on GitHub Pages. It uses plain HTML, CSS, and JavaScript with Supabase as the backend.

Core services:

- GitHub Pages hosts the static portal.
- Supabase provides Auth, Postgres, RLS, Storage, RPC/database functions, Edge Functions, and scheduled operations.
- Existing email delivery runs through Supabase and the established Google Apps Script workflow. It does not use Resend.
- The service worker provides app-shell caching and offline operation.
- IndexedDB/local queues support offline PO and other sync workflows.
- Playwright provides repeatable browser smoke tests.

Shared frontend files:

- `common.js`: authentication/session helpers, shared navigation, notification bell, mobile navigation, pull-to-refresh, shared utilities, and design-system loading.
- `styles.css`: legacy/shared portal styling.
- `jgc-design-system.css`: opt-in shared design tokens and `jgc-*` components.
- `service-worker.js`: release identifier, app-shell files, caching, offline behavior, and update lifecycle.
- `manifest.json`: PWA metadata.
- `offline-sync.js`: offline synchronization support.
- `shared-uploads.js` and `shared-uploads.css`: common upload validation, progress, retry, preview, errors, and signed-link behavior.
- `auth.js`: authentication behavior.

Read these documents before broad structural work:

- `JGC-DESIGN-SYSTEM.md`
- `JGC-ADMIN-ARCHITECTURE.md`
- `JGC-RELEASE.md`
- `JGC-PORTAL-FULL-AUDIT-2026-07-18.md`
- `BACKUP-README.md`

## Admin Architecture

`admin.html` owns the admin shell and loads feature modules in order. The previous giant inline admin implementation has been split into ownership modules:

- `admin-core.js`: auth, shared state, routing, lazy loading, initialization, and common event wiring.
- `admin-summary.js`: global search, summary tiles, calendar, schedule, notifications, and Google synchronization.
- `admin-jobs.js`: Job Dashboard, job import, active/inactive jobs, and job-level WO/PO navigation.
- `admin-timesheets.js`: live/submitted timesheets, manual entries, PDF/email, resubmission, editing, and deletion.
- `admin-inspections.js`: inspections, submitted details, vehicle print views, and related cleanup.
- `admin-reports.js`: safety/report subtabs, report views, JSA and Toolbox Talk history, and acknowledgements.
- `admin-equipment.js`: vehicles/equipment, maintenance, expiry, QR codes, lift manuals, yearly reports, and Storage.
- `admin-work-orders.js`: WO lists, embedded editor, approved labour workers, linked PO counts, status handling, and deletion.
- `admin-vacation.js`: vacation calendar, approvals/denials, notices, Google sync, and deletion.
- `admin-certificates.js`: certificates, training matrix, expiry, upload, signed links, and deletion.
- `admin-contacts.js`: subcontractors, suppliers, companies, and contacts.
- `admin-notices.js`: announcements, policies, Toolbox Talk library, acknowledgement displays, and related email actions.
- `admin-employee-profile.js`: employee profile administration and sick-day entry.
- `admin-backups.js`: backup launch, ZIP/JSON inspection, restore readiness, and backup history.
- `admin-housekeeping.js`: archive/collapse behavior for old records.

Standalone admin pages intentionally remain separate to keep `admin.html` manageable:

- `accounts.html`
- `purchase-orders-admin.html` / `purchase-orders-admin.js`
- `certificates-admin.html`
- `job-lists-admin.html` / `job-lists-admin.js`
- `employee-access-admin.html` / `employee-access-admin.js`
- `diagnostics-admin.html` / `diagnostics-admin.js`
- `policies-admin.html`
- `notification-settings.html`

Admin navigation is generated centrally from `JGC_ADMIN_NAV_ITEMS` in `common.js`. Do not copy a second admin navigation into individual pages.

## Finished Major Workflows

### Shared Design And Mobile PWA

- A shared `jgc-*` design system is loaded across the portal without replacing feature-specific layouts.
- Primary page logos, admin tabs, top bars, bell icon, safe-area spacing, and mobile sticky navigation were standardized.
- Mobile quick links are Home, Timesheets, PO, WO, Inspections, and More.
- Pull-to-refresh is supported in the installed PWA with a visible pull-down area and a deliberately longer trigger distance.
- The design migration is documented through Step 27 in `JGC-DESIGN-SYSTEM.md`.
- Existing feature styling is intentionally preserved unless a page is explicitly migrated and visually tested.

### Purchase Orders

- Digital PO numbers begin at `PO-30000` to avoid paper-book overlap.
- A PO number is shown as soon as a new PO starts so it can be given to a supplier immediately.
- Normal users cancel POs; they do not delete them. Admin-only deletion exists for controlled testing/cleanup.
- Pending submission stays editable until final submission.
- Final automatic submission/email is scheduled for the next day at 8:00 AM, with an admin early-submit option.
- PO sharing/assignment was removed because it confused ownership. Do not reintroduce it.
- Creator and last editor are recorded.
- Manual job entry is supported, and a manual job name is valid without a job number.
- Job Notes can be viewed while preparing a matching PO. Items are added individually; there is intentionally no Add All button because notes may contain equipment as well as materials.
- Job Note quantity values feed the PO quantity field.
- Darlene is included in PO email delivery.
- Device leases renew automatically when the device returns online.
- Number blocks support offline issuing. Non-admin accounts are limited to one active block/device allocation; admin accounts may have two active blocks for a phone and desktop.
- Server state should override stale local `Pending Sync` state after synchronization.

Primary files: `purchase-orders.html`, `purchase-orders.js`, `purchase-orders.css`, `purchase-orders-pdf.js`, `purchase-orders-admin.html`, `purchase-orders-admin.js`, `work-order-digital-pos.js`, and the digital PO migrations/functions under `supabase`.

### Work Orders

- WO dates use the local Toronto calendar date rather than UTC date slicing.
- Digital POs match by job/date and can be selected before the WO exists.
- Selecting a matching digital PO is intended to be enough; it links when the WO is saved/submitted without a separate link command.
- Admin WO lists show linked PO counts.
- Submitted WOs are lazy loaded.
- The admin editor uses normal page scrolling, not an internal editor scrollbar.
- The duplicate WO-number workflow has been investigated; continue to verify that number generation checks existing records before save.

Primary files: `work-orders.html`, `admin-work-orders.js`, `work-order-digital-pos.js`, and WO migrations/Edge Functions under `supabase`.

### Job Notes

- The feature is named **Job Notes**, not Lists.
- It has its own employee page and its own admin page under Admin Tools.
- Notes are grouped into compact job folders, then compact note rows.
- Notes support checklist items with large round check controls, quantities, tagged employees, multiple reminders, and material/equipment use.
- Any employee may view and check items. Tagged employees share editing/control and receive reminders.
- Reminders generate bell/push notifications only for tagged employees; expired reminders disappear.
- Autosave occurs at meaningful checkpoints, not every keystroke.
- Manual Save & Close returns to the main Job Notes page.
- Checking the final item does not make the open editor disappear. Completion is applied when the user closes/leaves the note.
- Compact note rows must show note name, creator, date, Open, and permitted Delete action.
- Push notification deduplication was addressed; one reminder should generate one notification per intended recipient/device path.

Current implementation uses the historically named `job-lists.html`, `job-lists.js`, and `job-lists.css`. Do not rename files casually because many links, caches, and tests rely on them.

### Timesheets

- Weekly PDF output is grouped by job, with columns for Sunday through Saturday.
- Day and Night shifts are separate rows; Night rows use a light grey full-row background.
- Rows should be ordered by the first day containing hours, following the Sunday-through-Saturday workweek.
- The old right-side Notes column was removed and a Notes section was added below the table.
- Weekly submission prompts the employee for a note.
- Admin final submissions are grouped by employee and lazy loaded.
- Admin resubmission sends the PDF through the same established recipients, including Darlene.

Primary files: `timesheet.html`, `admin-timesheets.js`, and timesheet-related Supabase SQL.

### Safety Records, JSAs, Reports, And Toolbox Talks

- Admin Inspections/Reports/Permits were consolidated conceptually under Safety Records and categorized/lazy loaded.
- Daily reports, JSAs, and near misses are grouped by job.
- Accidents and employee injuries are grouped by employee.
- Toolbox Talk history is grouped by talk name.
- Daily reports and JSAs have View/Edit/PDF behavior for authorized owners/admins.
- JSA `Page` and `Of` fields were removed.
- JSA approved-employee selection adds the employee immediately without an extra Add Employee click.
- JSA sign-off supports QR code, shared-device Employee Signature, and Creator Sign Off.
- A sign-off method must be selected and completed before the final JSA Submit control appears.
- Employees not initially listed may still review and acknowledge an active JSA when they arrive onsite.
- Shared-device and creator signing do not send account acknowledgement prompts.
- Signatures and acknowledgement metadata are stored and rendered in JSA PDFs.
- `jsa-pdf.js` is the shared JSA PDF renderer. Admin and employee PDF actions must use the same layout.
- Creators/admins get management actions. Other employees get View, PDF, and Email only.
- Toolbox Talk report creation appears above the library, uses a talk selector, and exposes the selected source PDF.
- Duplicate submission of the same Toolbox Talk for the same date/session is blocked.
- Toolbox Talk completion is stored in the portal and intentionally does not send an email.

Primary files: `jsa.html`, `jsa-pdf.js`, `toolbox-talks.html`, `toolbox-report-actions.js`, `acknowledge.html`, `safety-acknowledgements.js`, `safety-signature-pad.js`, `admin-reports.js`, `todays-inspections.html`, and `inspection-records.js`.

### Equipment And Lift Documents

- Lift manuals and yearly inspection reports can be uploaded as PDFs.
- Both appear in collapsed Lift Documents sections on QR inspection pages.
- Storage is private and documents are opened through narrowly scoped signed links.
- Lift inspection result tiles use clearly different selected colors so Pass/Defect/N/A choices are obvious.

Primary files: `equipment-vehicles.html`, `admin-equipment.js`, `equipment-inspection.html`, `aerial-lifts.html`, related design CSS, and equipment/lift Storage migrations.

### Accounts And Employee Feature Access

- Accounts support Approved, Inactive, and Limited Access states.
- Limited Access allows a former employee to access only their own certificates, timesheets, inspections, and reports. It does not expose schedules or company-wide data.
- Inactive employees are collapsed separately so active account screens remain readable.
- Employee Feature Access is a standalone admin page under Admin Tools.
- Feature eligibility comes from actual active accounts and per-feature checkboxes.
- New accounts should appear automatically; deactivated accounts should be removed from selectable feature access.
- Manual names are not allowed for Work Order labour eligibility because those users cannot submit their hours.

Primary files: `accounts.html`, `employee-access-admin.html`, `employee-access-admin.js`, `employee-access-admin.css`, `employee-feature-access.js`, `limited-access.html`, and related migrations.

### Jobs And Scheduling

- Excel job import includes jobs from 2025 forward.
- Unhighlighted rows are Active.
- Highlighted non-red rows are Inactive.
- Red-highlighted rows are cancelled and are not uploaded.
- The old two-month deletion behavior was removed; historical jobs remain available.
- Admin job list uses Active and Inactive tabs, with Active open by default and Inactive collapsed/closed.
- The schedule calendar supports job, title, location, times, notes, employee tagging, and Google synchronization.
- Employee selections are controlled by Employee Feature Access rather than a hidden duplicate list.

Primary files: `job-lists-admin.html`, `job-lists-admin.js`, `admin-jobs.js`, `schedule.html`, `schedule-design-system.css`, `admin-summary.js`, and schedule migrations/functions.

### Diagnostics, Backups, And Security

- `diagnostics-admin.html` is linked from Admin Tools only, not duplicated as an admin navigation tab.
- Diagnostics shows failed syncs, email/PDF failures, storage-link errors, backup results, recent saves, and browser errors.
- Real diagnostic issues create an admin bell notification. Historical/resolved entries remain distinguishable.
- False PO PDF errors were removed from diagnostics.
- Backup tooling was expanded to include timesheets, profiles, job lists, and expected portal data.
- Scheduled local backup requires the Windows computer to be awake. A missed Sunday backup while the laptop was off was expected behavior.
- Supabase anonymous access was tightened for sensitive tables while preserving required public QR/JSA acknowledgement flows.
- RLS and Storage policies must remain enabled. Admin-only actions must be enforced server-side, not only hidden in the UI.

Primary files: `diagnostics-admin.*`, `backup-jgc-portal.ps1`, `run-jgc-backup-now.bat`, `admin-backups.js`, `BACKUP-README.md`, and security migrations under `supabase\migrations`.

## Current Supabase Structure

Supabase migrations are under `supabase\migrations`. Recent important migrations include:

- `20260718133602_lock_down_sensitive_delete_policies.sql`
- `20260718174932_lock_down_anonymous_table_access.sql`
- `20260718180550_validate_anonymous_safety_submissions.sql`
- `20260720093000_limited_access_accounts.sql`
- `20260720113000_daily_site_report_owner_access.sql`
- `20260720161000_prevent_duplicate_toolbox_talk_reports.sql`
- `20260723110000_digital_po_manual_job_number_optional.sql`
- `20260723150000_job_list_multiple_reminders.sql`
- `20260724113000_limit_digital_po_devices_per_account.sql`
- `20260730110000_employee_feature_access.sql`
- `20260730160000_sync_employee_feature_access_accounts.sql`
- `20260731100000_block_manual_work_order_access.sql`
- `20260731140000_safety_acknowledgement_signatures.sql`
- `20260731150000_current_user_safety_acknowledgement.sql`

Supabase Edge Functions currently include:

- `auto-submit-work-orders`
- `jgc-calendar-feed`
- `send-digital-po-email`
- `send-push-notification`
- `send-schedule-reminders`

Before assuming a migration is live, compare local migration files with the production Supabase migration state. Several late-July migration files are currently untracked in the primary working folder even though related frontend code exists.

## Verification And Release Procedure

The main release command is:

```powershell
.\run-jgc-release-check.bat
```

The focused browser suite is:

```powershell
npm run smoke
```

The release checker validates:

- JavaScript and inline-script parsing.
- Local asset references.
- Shared asset version consistency.
- Service-worker app-shell completeness.
- Page opening without uncaught JavaScript errors.
- Key tabs and controls.
- Service-worker registration/control.
- Exact mirror equality between the primary folder and `GitHub\jgctimesheet`.

The clean publishing copy at commit `3892c1b` passed all 47 smoke tests. The primary dirty folder must be retested after its pending changes are reconciled.

The last critical syntax bug fixed was in `todays-inspections.html`: a template expression had a missing empty-string branch. If Diagnostics shows old `Missing } in template expression` or `Unexpected token` entries from July 31, those are historical browser reports and may be resolved after confirming the deployed build is newer than `3892c1b`.

## Known Remaining Work And Risks

1. Reconcile the primary folder, deployment mirror, and `origin/main`. The primary folder contains newer work but its branch history is far behind GitHub.
2. Audit every modified/untracked primary file before choosing what belongs in production. Do not mass-copy or mass-stage.
3. Confirm whether the late-July Supabase migrations have been applied in production.
4. Confirm the nested deployment mirror contains new shared files such as `jsa-pdf.js`, employee feature-access assets, and safety acknowledgement migrations.
5. Run the full release checker against the exact files intended for the next deployment.
6. Verify recent business-critical workflows against production Supabase: JSA signatures, Toolbox Talk dedupe, Employee Feature Access, limited accounts, PO device limits, PO stale-sync reconciliation, WO number generation, and Job Notes reminders.
7. Resolve historical Diagnostics entries only after confirming the underlying deployed issue is fixed.
8. Continue expanding focused smoke tests whenever a new critical button, page, or workflow is added.

## Decisions That Must Not Be Reversed

- Do not replace the static PWA or move it to a new framework without explicit approval.
- Do not create a second repository or work in a different project folder.
- Do not overwrite, reset, or revert unrelated dirty files.
- Do not commit every changed file merely because the working tree is dirty.
- Do not edit only one copy of a deployable file; keep the primary folder and `GitHub\jgctimesheet` mirror aligned.
- Do not remove offline support or PO number blocks.
- Do not change PO numbering below 30000.
- Do not reintroduce PO sharing/assignment.
- Do not give regular employees a PO Delete action; use Cancel.
- Do not make Toolbox Talk submission send email.
- Do not switch email delivery to Resend or require JGC Google account authorization.
- Do not expose a Supabase service-role key or privileged credentials in browser code.
- Do not weaken RLS or broad anonymous access to make a feature work. Preserve narrowly scoped public acknowledgement RPCs instead.
- Do not delete or make audit history client-editable.
- Do not merge standalone admin pages back into the large `admin.html` implementation.
- Do not duplicate top/admin/mobile navigation in page files; use `common.js`.
- Do not globally restyle legacy tables/forms. Shared design classes are opt-in and existing feature geometry must remain intact.
- Do not remove required QR/shared-device acknowledgement access for non-account workers.
- Do not auto-complete and remove a Job Note while its editor is still open.
- Do not add a Job Notes `Add All` to PO command.
- Do not use UTC date slicing for user-facing work dates; use the local Toronto date.

## Working Style Expected By The User

- Read and understand the existing implementation before changing it.
- Implement requests end to end rather than stopping at a proposal.
- Preserve the established green JGC visual language and mobile ergonomics.
- Test desktop and mobile behavior.
- Explain errors in plain language.
- Automatically mirror, verify, commit, and push completed work.
- If a release fails, make a new corrective commit or safely revert the specific bad commit. Never rewrite shared history casually.

## First Actions In The New Task

Run these read-only checks before changing anything:

```powershell
git status --short --branch
git log -8 --oneline --decorate
git log origin/main -8 --oneline --decorate
git diff --stat
git diff -- GitHub/jgctimesheet
```

Then read this handoff plus the architecture, design, and release documents. Identify the exact files for the user's newest request, inspect both copies, and state which version is newer before editing. Keep the scope narrow, run focused tests, run the release checker, and publish only the verified task files.

