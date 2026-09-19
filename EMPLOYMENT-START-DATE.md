# Employment Start Date — release 891

Administrators can save Employment Start Date in Accounts or Employee Profile. Both edit the existing `profiles.hire_date`, so previously entered hire dates remain authoritative.

New accounts default to today's Toronto date. Administrators should correct that date to the actual start date when needed. Existing blank dates are deliberately left blank and keep the previous full-week expectations; no historical hire dates are guessed.

Accounting only expects weekday coverage on or after the start date. Entirely earlier weeks do not create missing-submission warnings or block Final & Lock. A Wednesday starter needs Wednesday through Friday. Weekend starts without required weekdays or entered time do not create an empty submission requirement. Actual entries and submitted payroll history are retained.

The employee and administrator timesheet submission checks use the same boundary. Automatic holiday entries and Accounting leave auto-fill do not create entries before employment. The database rejects pre-start auto-fill and still requires all remaining weekdays before archiving a week. Employees cannot edit their employment date under existing profile access policies.

## Validation

- 27 focused Accounting/Accounts/start-date checks pass, including a corrected confirmation-dialog fixture followed by a passing recheck.
- 50 broader Accounting, timesheet, cached-page and admin-shell regression checks pass.
- Phone and desktop Accounts save/reload screenshots reviewed.
- Release verifier: 12 passed, no warnings or failures in the isolated release checkout.
- Migration `20260918181809_employee_employment_start_date.sql` applied and verified. Local database tests and a deployed rolled-back transaction cover defaults, retained unknown dates, partial weeks, invalid pre-start days, incomplete weeks, employee access denial and rollback. No test archives or changed employee dates remain.

## Release safeguards

Only audited release files are synchronized into the two approved local copies, with backups before replacement. Pre-existing differences in unrelated local files are preserved. The batch check uses an obsolete mirror when run from the nested worktree; the explicit-root verifier and focused browser checks are the applicable release results.

Rollback should revert the application changes and restore the prior auto-fill function if necessary. Preserve actual employee dates, payroll submissions and locked periods. The new-account date default may remain or be deliberately dropped without rewriting any employee data.
