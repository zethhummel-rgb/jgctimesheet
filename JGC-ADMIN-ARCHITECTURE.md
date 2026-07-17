# JGC Admin Architecture

The Admin portal is being split gradually so each release remains testable and the existing interface keeps the same behavior and appearance.

## Current Structure

- `admin.html` owns the Admin page markup and existing JavaScript behavior.
- `admin.css` owns the Admin page-level styles that previously lived in the document head.
- `admin-backups.js` owns the backup command, local inspection history, ZIP/JSON inspection, and restore-readiness display helpers.
- `admin-contacts.js` owns Contacts plus Subcontractors/Suppliers company and contact management.
- `admin-vacation.js` owns Vacation Requests calendar rendering, approvals, denials, decision notices, Google Calendar synchronization, and deletion.
- `admin-notices.js` owns announcements, toolbox talks, policies, acknowledgement displays, signed document URLs, and announcement email delivery.
- `admin-certificates.js` owns certificate status and expiry helpers, signed file URLs, expiry notices, certificate lists, the training matrix, uploads, and deletion.
- `admin-inspections.js` owns inspection list rendering, submitted-detail views, vehicle inspection print views, deletion, and related notification cleanup.
- `admin-reports.js` owns report subtab behavior, report-table rendering, and JSA, toolbox talk, accident, and injury acknowledgement summaries.
- Shared visual rules continue to come from `styles.css`, `jgc-design-system.css`, and the feature design-system files already linked by `admin.html`.
- Report and PDF styles generated inside JavaScript templates remain embedded with their generators.

## Extraction Rules

1. Move one stable boundary at a time.
2. Preserve stylesheet and script load order.
3. Keep existing global functions available while inline handlers still call them.
4. Do not move generated report, print, or PDF template styles into page CSS.
5. Add every new release asset to the service-worker app shell.
6. Advance `JGC_RELEASE_ID` for every deployable change.
7. Run `run-jgc-release-check.bat` before handoff or deployment.

## Planned JavaScript Modules

Future extractions should use the existing Admin tab boundaries:

- `admin-core.js`: authentication, tab routing, shared state, and common Admin helpers.
- `admin-summary.js`: summary search, schedule, announcements, and dashboard data.
- `admin-jobs.js`: job dashboard and job import/management behavior.
- `admin-timesheets.js`: timesheet lists, editors, and PDF actions.
- `admin-inspections.js`: inspection lists, submitted-detail viewing, vehicle print views, and deletion. This extraction is complete.
- `admin-equipment.js`: equipment, vehicles, lift documents, and QR management.
- `admin-work-orders.js`: work-order lists and the embedded editor.
- `admin-contacts.js`: subcontractor, supplier, and contact administration. This extraction is complete.
- `admin-vacation.js`: vacation calendar and request administration. This extraction is complete.
- `admin-notices.js`: announcements, toolbox talks, and policy administration. This extraction is complete.
- `admin-certificates.js`: certificate status, expiry notifications, training matrix, upload, and deletion. This extraction is complete.
- `admin-reports.js`: report subtab behavior, report-table rendering, and safety acknowledgement summaries. This extraction is complete.
- `admin-backups.js`: backup inspection and restore-preparation tools. This extraction is complete.

The next extraction should start with a lower-risk, self-contained tab module. High-traffic modules such as Summary, Timesheets, Equipment, and Work Orders should remain in `admin.html` until the shared module loader and smoke checks have proven stable.
