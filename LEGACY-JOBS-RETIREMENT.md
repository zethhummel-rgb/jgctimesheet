# Legacy admin Jobs retirement audit

Baseline and rollback source: commit 2f009ad839d6c59d58fcadb5d1474a4b09248d74. All retired files and sections are preserved in Git history; this is isolated worktree codex/job-details-and-navigation. No job rows, work orders, POs, timesheets, quotes or permissions are deleted.

## Dependencies examined

All top-level deployed JavaScript and HTML were scanned for every declared legacy function. External references are listed below. The employee jobs.html declares its OWN getJobDocumentHref and does not load admin-jobs.js. Its restricted directory remains available.

{
  "renderJobDashboardOptions": [
    "admin-core.js:526",
    "admin-core.js:794"
  ],
  "openJobDashboardOptions": [
    "admin.html:282"
  ],
  "handleJobDashboardSearchInput": [
    "admin.html:282"
  ],
  "handleJobDashboardSearchKeydown": [
    "admin.html:282"
  ],
  "closeJobDashboardRecordModal": [
    "admin.html:292",
    "admin.html:299"
  ],
  "getJobDocumentHref": [
    "jobs.html:61",
    "jobs.html:109"
  ],
  "renderJobDashboard": [
    "admin-core.js:527",
    "admin-core.js:795",
    "admin-work-orders.js:431"
  ],
  "renderJobsManagement": [
    "admin-core.js:573",
    "admin-core.js:796"
  ],
  "loadJobsManagement": [
    "admin-core.js:445",
    "admin.html:287",
    "admin.html:939"
  ],
  "importJobsFromExcel": [
    "admin.html:937"
  ],
  "deleteImportedJobs": [
    "admin.html:938"
  ]
}

## Replacement coverage

- Official jobs load through paginated portal-api.ts into Estimator Jobs, including inactive jobs.
- Job statistics in portal-api.ts and JobStatisticsPanel cover timesheets, work orders, digital/paper POs, reports, inspections and equipment. Existing estimator-job-control-centre browser coverage exercises this.
- Project Details and Documents replace metadata/document editing.
- New Job and Estimator status actions replace admin job mutations.
- Excel rollback importer remains in estimating-app/src/portal-api.ts behind EXCEL_JOB_IMPORT_ENABLED=false.
- Admin navigation, Summary tiles/search and spyglass results point to Estimator.
- Old admin tab URLs remain compatibility redirects; they are not active legacy screens.
- Employee lookup and employee select controls remain intact, with no estimate/value access.

## Verified for release 901 (September 22, 2026)

- TypeScript and Vite production build passed.
- 64 focused Estimator browser checks passed: metadata, reference persistence and clearing, accepted-history preservation, statistics, status changes, alias filtering, and mobile layouts.
- 169 portal/browser checks passed: employee-safe fields, both search surfaces, old-route redirects, cached pages, service worker, and light/dark readability.
- After the final CSS readability adjustment, all 11 affected layout and reference tests passed again. Desktop and phone screenshots were visually inspected.
- Release verifier: 12 passed, zero warnings/failures against an isolated clean mirror; unrelated local files were preserved.
- No deployed references to retired admin functions remain. The only jobDashboard references are compatibility redirects.
- Credential-pattern scan passed for the 76 task paths. No private data, credentials or backups are included.
- Production migration job_customer_reference_corrections applied successfully. Read-back confirmed the new expression, unchanged SECURITY INVOKER/ACL, and accounting snapshot coverage of every job. Missing, corrected and explicitly cleared synthetic references passed.
- Customer references remain in the existing protected Estimator workspace; no employee-facing columns or permissions were added. Accepted quote snapshots and previously generated accounting versions remain historical records.
- Header completion date uses the existing target-completion field; no additional actual-completion date or status automation was introduced.

Three local task files were confirmed as exact older Git versions before synchronization (admin-core.js, admin-global-search.js, admin-work-orders.js). Their prior contents will be backed up; unrelated local changes are outside this release.
