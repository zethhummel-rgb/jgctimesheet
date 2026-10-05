# Job Board — release 974

Every existing job gains a Job Board tab. The office prints or downloads its QR
poster, reviews site documents, grants restricted access to existing client
accounts, and opens the collapsed Activity log. The public QR page uses the
Portal design system on phones and desktops in light and dark themes.

## Workflow

1. Open a job's **Job Board** tab and post its QR poster on site.
2. Visitors enter their name, company and email. Existing staff and client
   accounts can sign in with their Portal account. Signed-in client actions use
   the verified account identity; anonymous visitor details are self-reported.
3. Visitors can read published public documents. Approved JGC staff and client
   accounts explicitly granted access can read published restricted documents.
4. Staff upload PDFs or JPEG/PNG/WebP photos using the document category list,
   or choose **Create a form** to open an existing JSA, toolbox talk, daily site
   report, incident/accident/injury report, permit or inspection.
5. QR-created forms prefill the job. Saving a form attaches a report snapshot
   to that exact job for office review. Daily report photos attach separately.
6. The office reviews each new item and chooses whether to publish it publicly
   or restrict it. Items categorized as accidents/incidents and saved incident,
   accident and injury reports stay restricted even after recategorization.
7. Each published item offers viewing, downloading and an **Email link** action.
   Email link opens the device's mail app with a permanent document link; it
   does not send mail or attach a file automatically.

The document categories are H&S documentation, site-specific safety, JGC
policies, JSAs, toolbox talks, accident/incident reports, daily reports/photos,
permits, inspections and other reports. Today's JSA uses the Toronto date;
previous JSAs remain searchable in history.

## Proposed production backend change

Apply [job-board-setup.sql](../supabase/job-board-setup.sql) followed by
[job-board-sources.sql](../supabase/job-board-sources.sql) in one migration.
These add five dedicated tables: `job_boards`, `job_board_documents`,
`job_board_viewers`, `job_board_visitor_sessions`, and `job_board_activity`.
All have RLS enabled and no direct anonymous or authenticated table access.
Scoped RPCs enforce current profile status, job identity, source ownership,
visitor session binding, office review and explicit restricted access.

The migration creates one private `job-board-files` Storage bucket, limited to
20 MB per file and PDF/JPEG/PNG/WebP. Storage policies protect only this new
bucket, including guards against broad inherited policies and replacement of
stored originals. Existing report tables and buckets keep their permissions.

Deploy `jgc-job-board-document` from
[index.ts](../supabase/functions/jgc-job-board-document/index.ts) and
[handler.ts](../supabase/functions/jgc-job-board-document/handler.ts).
Its public entry uses `verify_jwt: false` because identified visitors can read
published public documents. The handler always authorizes the exact document
through the caller-scoped RPC before using server credentials to sign its
private file for 120 seconds. Those credentials stay in the Edge environment.
Saved report snapshots are converted into PDF by the browser.

Office creation verifies the stable Estimator job ID against the current
Portal job; Estimator costs are never returned to the QR page. The office can
disable visitor access or replace a QR link, invalidating prior visitor sessions.

## Activity and connection recovery

The office log records visitor/account sign-in, identified board openings,
document view/download/email-link requests, uploads, review and access changes.
Times come from the database. It reports requested actions; it does not assert
that a physical QR scan occurred or that an email was delivered.

Report attachment failures keep a small queue of source/job/actor IDs on the
device. Returning to the board or reconnecting retries only the current actor's
items. Existing offline inspection queues retain the job ID and canonical
worker. A source's first attachment is an immutable snapshot; editing the
original report does not silently change a published snapshot.

File retries reuse their reserved object path. If Storage saved a file but its
confirmation was lost, validated finalization recovers it without another copy.
Daily photo retries retain the selected photo bytes while the form stays open.

## Release verification

The candidate is built from remote main commit
`6ab7f587f9ff48bfec00c424e7d1082f3bce97cb`, live release 973, on branch
`codex/job-board-974`. It has an isolated worktree. Historical build assets and
unrelated primary-checkout changes are preserved.

Receipts are kept outside the repository under
`JGC-AI-COORDINATION/receipts/974-job-board`: release verifier, local database
security tests, Edge tests, UI/form integration, decoded QR checks, rendered PDF
QA, credential/file audit and Portal regression results.

Production backend application and release 974 publication remain pending
specific approval under the shared coordination protocol.
