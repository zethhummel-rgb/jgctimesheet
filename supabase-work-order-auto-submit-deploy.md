# Work Order Auto Submit Setup

This enables true background Work Order submission after the following Monday at 8:00 AM America/Toronto.

## 1. Deploy the Edge Function

Deploy `supabase/functions/auto-submit-work-orders`.

CLI option:

```powershell
supabase login
supabase link --project-ref xnrljkkszoimegfivlya
supabase functions deploy auto-submit-work-orders
```

Dashboard option:

Open Supabase Dashboard, go to Edge Functions, and deploy a function named:

```text
auto-submit-work-orders
```

using the code in:

```text
supabase/functions/auto-submit-work-orders/index.ts
```

## 2. Optional Function Secrets

The function has built-in defaults for the current JGC email script and recipients. You can override them in Supabase Edge Function secrets:

```text
WORK_ORDER_EMAIL_SCRIPT_URL
WORK_ORDER_EMAIL_RECIPIENTS
WORK_ORDER_AUTO_SUBMIT_LIMIT
```

`WORK_ORDER_EMAIL_RECIPIENTS` should be comma-separated.

## 3. Run The Scheduler SQL

Run this file in Supabase SQL Editor:

```text
supabase-work-order-auto-submit-setup.sql
```

It schedules the function every 15 minutes. The function itself only submits WOs after their Monday 8:00 AM gate.

## 4. Test Manually

After deployment, invoke the function once from the Supabase Dashboard or with:

```powershell
Invoke-RestMethod `
  -Uri "https://xnrljkkszoimegfivlya.supabase.co/functions/v1/auto-submit-work-orders" `
  -Method Post `
  -Headers @{
    "Authorization" = "Bearer YOUR_PUBLISHABLE_KEY"
    "apikey" = "YOUR_PUBLISHABLE_KEY"
    "Content-Type" = "application/json"
  } `
  -Body "{}"
```

The response reports how many WOs were checked, submitted, waiting, or skipped.
