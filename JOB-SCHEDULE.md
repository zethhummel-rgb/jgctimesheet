# Optional Job Schedule

Release 956 adds a Schedule tab to Estimator Jobs. Creating and using a job never requires a schedule. This is a project Gantt, with optional trade/responsibility names; it does not assign employees, send notifications, or change calendar appointments.

## Use

- Open a Job, choose Schedule, then Create schedule.
- Add activities with a phase, start and finish. Enter duration to calculate finish, or enter exact dates. Responsibility, progress, notes and finish-to-start links are optional.
- Working days means Monday to Friday. Holidays are not automatically excluded. Calendar days includes weekends and suits curing or weekend work.
- Edit schedule enters a draft. Open activity names to edit, drag bars to move, or drag the right edge to resize. Undo restores the last draft change.
- A linked activity starts after its predecessor finishes, plus optional calendar-day waiting time. Its duration stays constant; following linked activities move together. Unlinked activities keep their dates. Circular links are rejected.
- Save schedule records a revision. Wait for the existing All changes saved indicator. Download schedule PDF uses saved dates only. PDF uses 17 × 11 inch landscape pages and tiles long timelines and activity lists; notes and links appear in an appendix.
- Saved revisions preserve earlier issued dates. Loading previous dates creates a draft for a new revision. It does not overwrite the old record.

## Storage and access

`Job.schedule` is optional JSON within the existing `estimator_workspaces.payload`. The existing revision check and three-way merge protect saves. Competing edits to one schedule are atomic conflicts; the persistence validator also rejects stale retries and removed revision history. No new table, RPC, Storage bucket or production migration is needed.

The current Estimator gate and live workspace RLS allow approved administrators only. No estimate values are included in the Schedule PDF or draft export. This release does not add employee schedule access.

## Files

- `estimating-app/lib/job-schedule.ts`: task dates, working/calendar day calculations, links, revisions, persistence validation.
- `estimating-app/app/job-schedule.tsx` and `.css`: optional tab, draft editor, Gantt, pointer dragging, details and revision UI.
- `estimating-app/lib/job-schedule-pdf.ts`: branded PDF, repeated headers and date/row pagination.
- Existing integration: `estimate-desk.tsx`, `estimator-data.ts`, `estimator-state-sync.ts`, `src/portal-api.ts`.
- Tests: `smoke-tests/job-schedule.spec.js` plus existing Job control, persistence, access and PDF suites.

The user-supplied Cornwall Electric workbook/PDF informed the design. No customer schedule was imported into production or committed into this repository.
