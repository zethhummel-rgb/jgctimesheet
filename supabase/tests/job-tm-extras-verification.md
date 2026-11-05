# T&M Extras database verification

Date: 2026-11-05
Migration: `20261105192414_jgc_job_tm_extras.sql`
Regression script: `supabase/tests/job-tm-extras-regression.sql`

The proposed migration and synthetic regression fixtures were executed together in a transaction and rolled back. No migration deployment occurred during this verification.

## Passed regression groups

1. Anonymous RPC and direct client table access denied.
2. Per-job X1/X2 numbering and idempotent create retry.
3. Worker choices, admin-only management/totals, cross-job and ownership checks, submitted WO protection.
4. Live manual/timesheet totals, submitted split, closed extra preservation, label snapshots, reassignment and removal.
5. Whole-day source attribution; first-entry and legacy profile mapping; repeated WO dedup; zero-hour expected worker.
6. Ambiguous base/extra and two-extra WOs stay unallocated; corrected job/date/worker references do not misassign.
7. Captured/provisional source dedup; missing-rate hours and separate manual unpriced hours.
8. Cost/hours/missing-rate partitions exactly match existing RPC grouping/rounding; effective dates/night premiums preserved.
9. Authoritative total parity across 360 official and synthetic jobs in the combined regression run.

## Existing-data parity

A separate rollback transaction compared every existing official job against `get_estimator_job_labour_actuals()`, aggregating its already-rounded worker/status groups:

| Check | Actual result |
| --- | ---: |
| Official jobs checked | 356 |
| Hours mismatches | 0 |
| Loaded labour cost mismatches | 0 |
| Missing-rate hours mismatches | 0 |

Synthetic checks also independently calculate expected cost using effective rate changes, night premium and the existing 40% burden. Allocated buckets reconcile exactly to the existing RPC and contain no negative values.

## Rollback confirmation

| Check | Actual result |
| --- | --- |
| Proposed extras table absent | true |
| Synthetic jobs remaining | 0 |
| Synthetic future payroll rates remaining | 0 |

## Interpretation

- Extra hour totals use current saved WO labour, including manual hours. They can differ from authoritative payroll hours.
- Labour costs partition the existing accounting/current-timesheet cost total; they never add WO hours to payroll costs.
- One clear worker/job/date association assigns cost to its extra. Repeated WOs for the same extra do not duplicate payroll cost. Contradictory original/extra or multiple-extra associations remain unallocated.
- Corrected job, date and known worker identity must agree before a source ID can attribute cost.
- Manual hours on extra WOs are reported separately as unpriced. No name-based payroll matching or invented cost is used.
- Closed extras remain available to their already-linked WOs. Saved labels on existing WOs are preserved. Submitted or locked associations cannot be changed.
- Number allocation is serialized with an official-job row lock and unique constraints; the tests verify sequential numbering and retry idempotency. Concurrent sessions were reviewed structurally, not load-tested.

## Re-running

The SQL regression script requires this migration to be present, an approved admin, two approved workers (at least one with a legacy WO-worker link), and an existing payroll capture. It inserts synthetic jobs and future-dated test entries/rates, then always rolls the transaction back. To validate before deployment, concatenate the migration with the regression body inside one transaction, as done for this receipt.


## Post-deployment verification

After deployment of migration **20261105192414**, the same regression script was run against the installed objects. This later run did not recreate or alter schema; only synthetic fixture data was inserted inside its rolled-back transaction.

| Check | Actual result |
| --- | --- |
| Installed migration registered | true |
| Extras table present with row-level security enabled | true |
| All nine regression groups | passed |
| Installed function bodies matching reviewed migration | 9 / 9 |
| Function security modes and empty search paths matching expected | 9 / 9 |
| Anonymous or PUBLIC execution on extras functions | none |
| Staff direct access to extras table | denied |
| Anonymous direct access to extras table | denied |
| Synthetic jobs remaining after rollback | 0 |
| Synthetic future rates remaining after rollback | 0 |

Approved staff can execute the list RPC. Administrative save/report RPCs remain protected by their admin checks, and ordinary-worker denial was exercised again in the installed-function regression run. The costing/resolution helpers and trigger function are not directly callable by staff.

A fresh post-deployment comparison of **all 356 existing official jobs** against the unchanged `get_estimator_job_labour_actuals()` returned **0 hours mismatches, 0 loaded-cost mismatches and 0 missing-rate-hours mismatches**. The combined synthetic regression run again checked 360 jobs and passed.

The earlier rollback confirmation above describes the pre-deployment test; the extras table is now intentionally installed. No test fixtures remained after either phase.
