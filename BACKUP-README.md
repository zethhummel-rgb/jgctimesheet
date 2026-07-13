# JGC Portal Backup

The backup runs locally on Zeth's Windows account. It exports portal files, every database table/view discovered through the Supabase Data API, and every live Supabase Storage bucket.

## One-time credential setup

Run this command from the portal folder:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\backup-jgc-portal.ps1" -ConfigureCredential
```

Enter the Supabase project URL and an `sb_secret_...` key when prompted. The key input is hidden. Windows DPAPI encrypts the key for the current Windows account and stores the protected record at:

```text
%LOCALAPPDATA%\JGC Portal Backup\credentials.json
```

The encrypted credential is outside the website and Git folders. It is not copied into backups, manifests, reports, logs, or GitHub. The scheduled task must run as the same Windows user that configured the credential.

For a temporary test, the script also accepts process-only `JGC_SUPABASE_URL` and `JGC_SUPABASE_SECRET_KEY` environment variables. Never place these values in a `.bat`, `.ps1`, website file, command argument, or Git repository.

Do not recreate `backup-secrets.json`. It is an obsolete plaintext credential file and the repaired script refuses to use it.

## Run a backup

Double-click `run-jgc-backup-now.bat`, or run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\backup-jgc-portal.ps1"
```

The existing 90-day retention policy is preserved. Successful archives are written to `JGC Portal Backups` in the company OneDrive folder.

## Pass criteria

A backup is `PASSED` only when:

- Supabase authentication and schema discovery pass before the ZIP is created.
- Every required or discovered database table/view exports with verified pagination and row counts.
- Empty database tables are identified as `EMPTY`, not confused with failed exports.
- Every live Storage bucket is listed and every object downloads with its original bucket/path structure.
- Portal files are copied without credentials or local secret files.
- The completed ZIP is reopened and its manifest, JSON files, inventories, counts, and file sizes validate.

Any required database export failure marks the backup `FAILED`. An authentication failure stops before a ZIP is created.

## Restore readiness

Each ZIP contains `restore-readiness.json`, `backup-summary.txt`, the OpenAPI schema snapshot, source SQL/setup files, table JSON files, Storage file inventories, checksums, and a post-backup validation report.

Restoration is intentionally manual and controlled. Recreate and verify the Supabase schema, functions, triggers, RLS policies, and Storage buckets in a non-production project first. Then import parent tables before dependent rows and upload Storage objects using their preserved paths. Credentials are never included and must be created again for the restored project.
