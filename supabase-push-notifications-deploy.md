# JGC Portal Push Notifications Setup

Run these steps after the website files are deployed.

## 1. Run the SQL

Open Supabase SQL Editor and run:

```sql
-- paste contents of supabase-push-notifications-setup.sql
```

This creates:

- `push_subscriptions`
- `push_delivery_log`
- RLS policies for employees to manage their own device subscriptions

## 2. Generate VAPID keys

Generate one VAPID key pair. Keep the private key secret.

One option:

```powershell
npx web-push generate-vapid-keys
```

You will get:

- Public Key
- Private Key

## 3. Add Supabase Edge Function secrets

In Supabase Dashboard:

Edge Functions > Secrets

Add:

```text
JGC_VAPID_PUBLIC_KEY=your_public_key
JGC_VAPID_PRIVATE_KEY=your_private_key
JGC_VAPID_SUBJECT=mailto:zeth@johngordonconstruction.com
```

## 4. Put the public key in the website

In `common.js`, replace:

```js
const JGC_PUSH_VAPID_PUBLIC_KEY = "REPLACE_WITH_JGC_VAPID_PUBLIC_KEY";
```

with your VAPID public key.

Do not put the private key in any website file.

## 5. Deploy the Edge Function

Deploy:

```powershell
supabase functions deploy send-push-notification
```

## 6. Test

1. Open the portal.
2. Open the bell.
3. Press `Enable Push`.
4. Allow notifications.
5. Create a test notification, such as a WO hours request.

The bell remains the source of truth. Push is only the phone/desktop alert.
