const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");

const portalRoot = path.resolve(__dirname, "..");
const projectRef = "xnrljkkszoimegfivlya";
const supabaseOrigin = `https://${projectRef}.supabase.co`;
const fakeUser = {
  id: "00000000-0000-4000-8000-000000000095",
  aud: "authenticated",
  role: "authenticated",
  email: "po-style-test@johngordonconstruction.com",
  user_metadata: { display_name: "PO Style Test" }
};
const fakeProfile = {
  id: fakeUser.id,
  email: fakeUser.email,
  display_name: "PO Style Test",
  worker_key: "po style test",
  role: "admin",
  account_status: "approved"
};

function base64Url(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function createSession() {
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const accessToken = [
    base64Url({ alg: "HS256", typ: "JWT" }),
    base64Url({
      aud: "authenticated",
      exp: expiresAt,
      iat: Math.floor(Date.now() / 1000),
      role: "authenticated",
      sub: fakeUser.id,
      email: fakeUser.email
    }),
    "po-style-test-signature"
  ].join(".");
  return {
    access_token: accessToken,
    refresh_token: "po-style-test-refresh",
    expires_at: expiresAt,
    expires_in: 3600,
    token_type: "bearer",
    user: fakeUser
  };
}

async function installState(page) {
  const session = createSession();
  await page.addInitScript(({ authSession, profile, ref }) => {
    localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(authSession));
    localStorage.setItem("currentWorker", profile.worker_key);
    localStorage.setItem("currentWorkerDisplay", profile.display_name);
    localStorage.setItem("currentUserEmail", profile.email);
    localStorage.setItem("currentUserRole", profile.role);
    localStorage.setItem("currentAccountStatus", profile.account_status);
    localStorage.setItem("jgcStayLoggedIn", "true");
    sessionStorage.setItem("jgcActiveSession", "true");
  }, { authSession: session, profile: fakeProfile, ref: projectRef });

  await page.route(`${supabaseOrigin}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const accept = String(request.headers().accept || "");
    let body = "[]";
    if (url.pathname.startsWith("/auth/v1/user")) {
      body = JSON.stringify(fakeUser);
    } else if (url.pathname.startsWith("/auth/v1/token")) {
      body = JSON.stringify(session);
    } else if (url.pathname.includes("/rest/v1/profiles")) {
      body = accept.includes("application/vnd.pgrst.object")
        ? JSON.stringify(fakeProfile)
        : JSON.stringify([fakeProfile]);
    } else if (url.pathname.startsWith("/rest/v1/rpc/")) {
      body = accept.includes("application/vnd.pgrst.object") ? "{}" : "[]";
    } else if (accept.includes("application/vnd.pgrst.object")) {
      body = "{}";
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*", "Content-Range": "0-0/0" },
      body: request.method() === "HEAD" ? "" : body
    });
  });
}


for (const width of [390, 1440]) for (const theme of ['light','dark']) {
 test(`revoked PO devices keep employee and blocks together ${width} ${theme}`,async({page},info)=>{
  await page.setViewportSize({width,height:900});await installState(page);
  const devices=[{id:'current',profile_id:fakeUser.id,device_label:'Current phone',status:'active'},{id:'pending',profile_id:fakeUser.id,device_label:'Pending phone',status:'pending'},{id:'old',profile_id:fakeUser.id,device_label:'Old phone',status:'revoked'}];
  const blocks=[{device_id:'current',range_start:39000,range_end:39099,next_number:39005,status:'active'},{device_id:'old',range_start:38000,range_end:38099,next_number:38012,status:'revoked'}];
  const mutations=[];
  await page.route(`${supabaseOrigin}/rest/v1/**`,async route=>{
   const url=new URL(route.request().url());let data;
   if(url.pathname.endsWith('/digital_po_devices'))data=devices;
   else if(url.pathname.endsWith('/digital_po_number_blocks'))data=blocks;
   else if(url.pathname.endsWith('/rpc/digital_po_admin_revoke_device')||url.pathname.endsWith('/rpc/digital_po_admin_unrevoke_device')){
    const restoring=url.pathname.endsWith('unrevoke_device'),payload=route.request().postDataJSON();mutations.push(payload);const status=restoring?'active':'revoked';devices.find(d=>d.id===payload.p_device_id).status=status;blocks.filter(b=>b.device_id===payload.p_device_id).forEach(b=>b.status=status);data={};
   } else return route.fallback();
   return route.fulfill({json:data});
  });
  const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/purchase-orders-admin.html');await page.evaluate(theme=>applyJgcTheme(theme),theme);await page.locator('[data-admin-tab="devices"]').click();
  const body=page.locator('#poAdminDevicesBody');await expect(body).toContainText('Current phone');await expect(body).toContainText('Pending phone');await expect(body).not.toContainText('Old phone');
  await page.locator('[data-device-tab="revoked"]').click();await expect(body).toContainText('Old phone');await expect(body).toContainText('PO Style Test');await expect(body).toContainText('PO-38000 to PO-38099');await expect(body).not.toContainText('Current phone');await expect(body.locator('[data-assign-block]')).toHaveCount(0);
  await page.screenshot({path:info.outputPath(`revoked-${width}-${theme}.png`),fullPage:true});expect(await page.evaluate(()=>document.body.scrollWidth<=innerWidth+1)).toBe(true);
  page.once('dialog',d=>d.accept());await body.locator('[data-unrevoke-device="old"]').click();await expect(body).toContainText('No revoked PO devices.');
  await page.locator('[data-device-tab="current"]').click();await expect(body).toContainText('Old phone');await expect(body).toContainText('PO-38000 to PO-38099');
  page.once('dialog',d=>d.accept());await body.locator('[data-revoke-device="current"]').click();await expect(body).not.toContainText('Current phone');await expect(body).toContainText('Pending phone');
  await page.locator('[data-device-tab="revoked"]').click();await expect(body).toContainText('Current phone');await expect(body).toContainText('PO-39000 to PO-39099');
  await page.locator('[data-admin-tab="submitted"]').click();await page.locator('[data-admin-tab="devices"]').click();await expect(body).toContainText('Current phone');await expect(page.locator('[data-device-tab="revoked"]')).toHaveAttribute('aria-pressed','true');
  expect(mutations).toEqual([{p_device_id:'old',p_lease_days:30},{p_device_id:'current'}]);expect(errors).toEqual([]);
 });
}
