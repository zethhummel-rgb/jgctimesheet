# Digital Purchase Orders: Go-Live Notes

The Digital Purchase Order schema, RLS policies, database functions, audit triggers, private temporary receipt bucket, five-minute email cron job, and `send-digital-po-email` Edge Function are already deployed to Supabase project `xnrljkkszoimegfivlya`.

Digital PO numbers begin at `PO-30000`. Database constraints and the admin page reject any number block below 30000. A number is assigned on the first draft save and is never reused. Purchase Orders are cancelled, never deleted.

## One-Time Email Setup

Add these Edge Function secrets in the Supabase dashboard before sending the first live PO:

- `RESEND_API_KEY`: the production Resend API key.
- `RESEND_FROM_EMAIL`: a verified sender, for example `Purchase Orders <purchaseorders@johngordonconstruction.com>`.
- `PO_TO_EMAIL`: optional. It defaults to `darlene@johngordonconstruction.com`.

Supabase supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`; do not add those manually.

The worker runs every five minutes. Submitted POs remain queued if delivery fails, are visible as failures in PO Admin, and can be retried. Receipt photos stay in the private `digital-po-temp` bucket only until confirmed email delivery and cleanup.

## First Employee Setup

1. Open Accounts and choose **Allow PO Creation** for an approved employee.
2. Have that employee open Purchase Orders while online and choose **Register This Device**.
3. Open PO Admin, select **Devices and Number Blocks**, and assign the pending device a block. The first suggested block is `30000-30499`.
4. Have the employee sync once while online. The device then has a 30-day offline authorization lease and can issue only numbers from its assigned block.

The employee-sharing selector uses the approved Work Order employee list. Sharing a PO does not give the recipient permission to create unrelated POs; that permission is controlled only from Accounts.

## Offline Behavior

Active jobs, approved Work Order employees, suppliers, drafts, assigned POs, device authorization, and the local number cursor are cached in IndexedDB. An offline draft syncs when a connection returns. A device cannot allocate new numbers after its authorization lease expires or its number block is exhausted; an admin must renew or assign another block while online.

## Backup Behavior

The portal backup includes all permanent Digital PO database records, items, Work Order links, audit history, device/block records, and email outbox state. The temporary receipt bucket is intentionally excluded because files there are short-lived delivery attachments rather than permanent records.
