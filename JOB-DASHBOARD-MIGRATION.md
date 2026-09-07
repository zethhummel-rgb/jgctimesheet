# Job Dashboard migration safety map

The Estimate Desk Jobs area now manages the same official Portal job directory. This is an interface migration, not a replacement database. The legacy Job Dashboard and employee Jobs page remain available.

## Preserved job identity

| Consumer | Shared identity / behaviour retained |
| --- | --- |
| Employee Jobs and form job pickers | Official job number and name; active jobs only; explicitly shared document link |
| Timesheets | Existing job-number/name snapshots; submitted accounting entries retain official job UUID |
| Digital POs and offline PO queue | Official job UUID and number/name snapshots; no job deletion or renumbering |
| Work Orders | Official UUID plus snapshots; existing WO editor and PO links remain unchanged |
| Accounting/payroll | Official UUID and historical snapshots; no payroll or export formula changes |
| Schedule and Summary calendar | Existing job UUID and schedule fields; start/target dates remain on the shared jobs record |
| Job Notes, tasks and safety/report forms | Existing canonical references and stored number/name snapshots remain intact |
| Estimate Desk | Existing estimating job IDs, accepted quote snapshots, costs, POs, CCNs and shop-drawing history are preserved |

Official jobs without quotes receive a stable directory entry. They do not receive invented quotes, contract values or margins. Linking an accepted quote to one of these entries reuses its ID and keeps its job history. An existing official UUID is never silently reassigned to a different job that happens to have the same number.

## Features available in Estimate Desk

- All official jobs, including imported, unquoted, T&M and inactive jobs; searchable by job number/name, client, location, PM and type.
- Official job details, dates, active/inactive controls, private document links and explicit employee sharing/removal.
- Excel job-list import using the existing A–E/F/H/K layout, year-tab rules and highlight conventions.
- Existing quote-based cost tracking, subcontractor POs, changes and shop drawings.
- Operational digital POs, Work Order paper-PO references, Work Orders, daily reports, inspection summaries, equipment and vehicles.
- Weekly/employee/job-type hours, people onsite per day, current-month employee totals and separately identified Work Order-only labour.
- T&M opens Statistics first. Explicit tab choices remain in effect until another job is opened.

Record actions use the original Portal editors/viewers. Inspection summaries remain read-only, matching the legacy dashboard; no unsupported record links are fabricated.

## Excel import safeguards

The workbook is read locally and is not uploaded as a stored file. Preview performs no writes. Confirmation is required, missing-job deactivation is opt-in, and quote-linked jobs missing from a workbook are protected. Duplicate job numbers, incomplete formula results and invalid records block import.

Apply rechecks the preview against current records, then makes one database upsert using the unique official job number. Only import-managed fields are supplied; IDs, customer/address, schedule and document fields are retained. No jobs are deleted. A successful import followed by a refresh failure is not offered as an unsaved operation to retry.

The legacy “Delete Uploaded Jobs” action is deliberately not reproduced: it deletes the entire job master, not just an upload. Use active/inactive controls instead. The legacy dashboard itself has not been removed or altered in this release.

## Cost and permissions boundaries

PO references/commitments do not automatically become actual costs. Work Order-only labour is displayed separately for reconciliation, not added again to timesheet totals, payroll or loaded job costs. Employee payroll rates remain private. Existing database permissions are retained; job-management actions require a freshly verified approved administrator. No schema or access-policy changes are required.

## Verification scope

Release 853: the final complete browser suite passed 353/353 tests; TypeScript, the production build and 12/12 clean-release checks passed. Local OneDrive folders have unrelated pre-existing differences and are not treated as the release source.

Regression coverage includes the complete official directory, pagination, canonical IDs, status failures, quote-to-existing-job linking, stale-statistics responses, importer preview/confirmation/stale-state failures, metadata retention, operational record links and phone layouts. All simulated mutations use test fixtures, not production data. The live jobs schema and foreign keys were checked read-only before release.

Readability checks cover the directory, Excel preview, every job tab and the PO editor at desktop and phone widths: 1,642 text, input-value and mobile-label samples across 16 states. All sampled contrast meets 4.5:1 for normal text (3:1 for large text), helper text is at least 11px, and no page overflow or vertical text clipping was detected. Disabled actions stay legible. The visual review includes dark-green financial totals and the forecast input.

The regression run also exposed an existing delayed new-line autofocus that could redirect typing into the description. The guarded focus now respects a user's subsequent field selection, with deterministic tests for both the interruption and the normal initial autofocus.

Future work: replace the Excel-upload source with a Portal-managed job-list download for Accounting. This release intentionally keeps upload and does not change that accounting workflow.
