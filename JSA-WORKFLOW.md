# JSA input, preparation and PDF workflow

## Daily JSA

The existing QR Code, Employee Signature and Creator Sign Off choices remain in place. The existing signature pad, public/account acknowledgement RPCs, notification helpers, late-worker flow and final-submit gate are unchanged. Task rows stack on phones and keep the existing three-cell saved-record format.

The construction library contains 20 editable starter activities. Search matches task names, hazards and controls/PPE. Select the relevant hazards and controls, insert a task, then tailor its text to actual site conditions. Multiple hazards and controls remain separate lines. Insertion does not change the library or other JSAs.

The starters are planning prompts, not complete site procedures or a substitute for competent review, required permits or training. Their organization follows [CCOHS job safety analysis guidance](https://www.ccohs.ca/oshanswers/hsprograms/job-haz.html) and the [hierarchy of controls](https://www.ccohs.ca/oshanswers/hsprograms/hazard/hierarchy_controls.html). Task-specific prompts are JGC-editable starter content, not quotations or a claim of compliance.

## Prepared JSAs

Open **Admin → Safety Records → Prepared JSAs**, or **Prepare a JSA for later** on the JSA form.

1. Enter the planned work date, job details, tasks, hazards and controls. Select intended approved employees and/or manual subcontractor names.
2. **Save draft** stores an admin-only record. **Download PDF** and **Print** save first and clearly mark the copy **Prepared / Draft — Not Assigned**. Partial drafts may be saved/exported.
3. Before issuing, review the date, crew and site conditions. **Activate & Assign** reveals the existing sign-off choices. Choosing a method commits activation.
4. QR mode uses the existing account notifications; shared-device and creator modes retain their existing no-account-prompt behavior. Submit stays gated by the existing sign-off completion rules.
5. The issued record appears in existing JSA history. The Prepared JSAs library also retains an **Active / Assigned** entry that reopens the existing record. Reopening alone does not notify or activate again.

Prepared JSAs are stored separately in `jsa_preparations`. They do not create inspection rows, acknowledgement rows, delivery jobs or notifications. Approved admins can read them; all mutations go through guarded RPCs. Save revision checks prevent overwriting another administrator's changes. Activation locks the draft and atomically creates one inspection plus pending acknowledgement rows. Retries return the same issued record and preserve any signatures already collected. Activated drafts cannot be edited as drafts.

## PDF compatibility

All existing JSA PDF download entry points use `JgcJsaPdf`. Branding, page numbering, compact acknowledgements and wrapped/paginated task text apply to both old and new records. The layout uses existing acknowledgement data without changing its status or signature strokes. Prepared exports never present intended crew as signed or acknowledged.

## Verification

- `smoke-tests/jsa-prepared-local-db.cjs` runs against an isolated PGlite/Postgres runtime: admin/employee/anonymous access, stale saves, no early assignments, activation rollback, duplicate activation and signed-data preservation.
- JSA browser tests in `smoke-tests/portal.smoke.spec.js` cover editable presets, both themes on phones, saved draft/list/reopen, existing signature flow, required-field prompts, prepared/active PDFs and long controls across pages. Existing JSA and acknowledgement tests remain active.
- Production verification checks RLS/grants, the absence of draft notification triggers and unchanged hashes of existing acknowledgement/signature functions. Synthetic workflow tests do not issue JSAs to real crews.

Migration: `20260923010940_prepared_jsas.sql`. Frontend release: 903.
