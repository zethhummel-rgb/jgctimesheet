const JGC_RELEASE_ID = "1014";
const JGC_CACHE_PREFIX = "jgc-portal-v";
const JGC_CACHE_NAME = JGC_CACHE_PREFIX + JGC_RELEASE_ID;
const JGC_APP_SHELL = [
  "./employee-contacts.js?v=1",
  "./employee-contacts.css?v=1",
  "./jsa-workers.js?v=3",
  "./jsa-workers.css?v=1",
  "./jsa-worker-editor.js?v=1",
  "./job-board-context.js?v=2",
  "./job-board-report-pdf.js?v=5",
  "./job-board.css?v=11",
  "./job-board.html",
  "./job-board.js?v=18",
  "./job-board-email.js?v=1",
  "./vendor/qrcode.min.js?v=1",
  "./estimating/jgc-warranty-logo-v1.png",
  "./estimating/jgc-warranty-signature-v1.png",
  "./estimating/supplier-import/pdf.worker.min.mjs",
  "./portal-readability.css?v=2",
  "./safety-report-tools.js?v=1",
  "./safety-report-tools.css?v=1",
  "./employee-injury-report.js?v=4",
  "./accident-report.js?v=4",
  "./job-list-sync.js?v=1",
  "./",
  "./index.html",
  "./acknowledge.html",
  "./equipment-inspection.html",
  "./vehicle-inspection.html",
  "./subcontractor.html",
  "./limited-access.html",
  "./limited-access.css?v=2",
  "./home.html",
  "./timesheet.html",
  "./inspections.html",
  "./daily-site-report.html",
  "./todays-inspections.html",
  "./previous-inspections.html",
  "./certificates-admin.html",
  "./certificates.html",
  "./vacation-request.html",
  "./schedule.html",
  "./tasks.html",
  "./tasks.html?embedded=1&admin=1",
  "./contacts.html",
  "./subcontractors-suppliers.html",
  "./policies-announcements.html",
  "./equipment-vehicles.html",
  "./field-calculator.html",
  "./jobs.html",
  "./work-orders.html",
  "./purchase-orders.html",
  "./purchase-orders-admin.html",
  "./accounting-admin.html",
  "./employee-access-admin.html",
  "./job-lists.html",
  "./job-lists-admin.html",
  "./diagnostics-admin.html",
  "./permits.html",
  "./confined-space-permit.html",
  "./excavation-permit.html",
  "./reports.html",
  "./accident-report.html",
  "./employee-injury-report.html",
  "./toolbox-talks.html",
  "./toolbox-report-actions.js?v=2",
  "./incident-report.html",
  "./admin.html",
  "./estimating/index.html",
  "./accounts.html",
  "./accounts-admin.css?v=1",
  "./notification-settings.html",
  "./reset-password.html",
  "./aerial-lifts.html",
  "./forklift.html",
  "./harness.html",
  "./hot-work-permit.html",
  "./jsa.html",
  "./prepared-jsas.html",
  "./prepared-jsas.js?v=2",
  "./jsa-library-admin.html",
  "./jsa-library-admin.js?v=2",
  "./jsa-library-admin.css?v=3",
  "./employee-writeups.html",
  "./employee-writeups.js?v=2",
  "./employee-writeups-admin.html",
  "./employee-writeups-admin.js?v=2",
  "./employee-writeups-shared.js?v=2",
  "./employee-writeups.css?v=4",
  "./jsa-editor.js?v=4",
  "./jsa-presets.js?v=3",
  "./tele-handler.html",
  "./policies-admin.html",
  "./styles.css?v=3",
  "./admin.css?v=19",
  "./admin-dashboard.css?v=7",
  "./admin-dashboard.js?v=7",
  "./admin-dashboard-grid.js?v=1",
  "./admin-shell-design-system.css?v=6",
  "./inspection-history-today.css?v=2",
  "./inspection-history-previous.css?v=4",
  "./inspection-record-cards.css?v=2",
  "./safety-records-admin.css?v=3",
  "./admin-global-search.css?v=10",
  "./accounting-admin.css?v=9",
  "./jgc-design-system.css?v=14",
  "./estimator-theme.css?v=1",
  "./certificates-admin.css?v=1",
  "./certificates-embedded.css?v=1",
  "./equipment-admin.css?v=3",
  "./employee-access-admin.css?v=3",
  "./job-lists.css?v=12",
  "./permit-design-system.css?v=2",
  "./report-design-system.css?v=2",
  "./daily-site-report.css?v=1",
  "./jsa-report.css?v=4",
  "./toolbox-talks-report.css?v=1",
  "./incident-report.css?v=2",
  "./accident-report.css?v=2",
  "./employee-injury-report.css?v=3",
  "./reports-admin.css?v=3",
  "./timesheet-design-system.css?v=7",
  "./tasks-design-system.css?v=2",
  "./directory-design-system.css?v=2",
  "./jobs-design-system.css?v=4",
  "./schedule-design-system.css?v=7",
  "./schedule-ui.js?v=1",
  "./work-orders-design-system.css?v=4",
  "./work-order-pdf-branding.js?v=1",
  "./vacation-design-system.css?v=2",
  "./specialty-inspection-design-system.css?v=4",
  "./qr-inspection-design-system.css?v=2",
  "./equipment-qr-inspection.css?v=1",
  "./vehicle-qr-inspection.css?v=1",
  "./home-design-system.css?v=8",
  "./notification-settings-design-system.css?v=4",
  "./acknowledgement-design-system.css?v=3",
  "./login-design-system.css?v=12",
  "./common.js?v=82",
  "./admin-global-search.js?v=11",
  "./accounting-workbook.js?v=9",
  "./accounting-admin.js?v=14",
  "./employee-feature-access.js?v=3",
  "./employee-access-admin.js?v=4",
  "./job-lists.js?v=16",
  "./job-lists-admin.js?v=3",
  "./admin-housekeeping.js?v=1",
  "./shared-uploads.css?v=3",
  "./shared-uploads.js?v=3",
  "./offline-sync.js?v=3",
  "./admin-backups.js?v=3",
  "./admin-contacts.js?v=3",
  "./admin-vacation.js?v=4",
  "./admin-notices.js?v=4",
  "./admin-certificates.js?v=4",
  "./admin-inspections.js?v=4",
  "./admin-reports.js?v=5",
  "./admin-employee-profile.js?v=1",
  "./admin-work-orders.js?v=4",
  "./admin-equipment.js?v=2",
  "./admin-timesheets.js?v=11",
  "./admin-summary.js?v=10",
  "./admin-core.js?v=8",
  "./diagnostics-admin.css?v=2",
  "./diagnostics-admin.js?v=2",
  "./purchase-orders.css?v=23",
  "./purchase-orders-pdf.js?v=2",
  "./purchase-orders.js?v=27",
  "./purchase-orders-admin.js?v=14",
  "./work-order-digital-pos.js?v=3",
  "./safety-signature-pad.css?v=4",
  "./safety-signature-pad.js?v=4",
  "./safety-acknowledgements.js?v=9",
  "./jsa-pdf.js?v=5",
  "./field-calculator.css?v=18",
  "./calculator-engine.js?v=25",
  "./calculator-functions.js?v=28",
  "./field-calculator.js?v=32",
  "./auth.js?v=10",
  "./login-session.js?v=2",
  "./inspection-records.js?v=17",
  "./inspection-mobile.css?v=3",
  "./inspection-mobile.js?v=6",
  "./manifest.json?v=7",
  "./vendor/supabase-js.min.js?v=1",
  "./vendor/tus.min.js?v=1",
  "./vendor/exceljs.min.js?v=1",
  "./vendor/jszip.min.js?v=1",
  "./vendor/jspdf.umd.min.js?v=1",
  "./vendor/lucide.min.js",
  "./estimating/jgc-letterhead-logo.jpg",
  "./estimating/jgc-logo-transparent.png",
  "./logo.webp",
  "./login-background.webp",
  "./jgc-login-qr.png",
  "./jgc-login-qr-print.png",
  "./icon-180.png?v=4",
  "./icon-192.png?v=4",
  "./icon-512.png?v=4",
  "./estimating/assets/browser-C8xa4u8Z.js",
  "./estimating/assets/document-worker-C8H39dLV.js",
  "./estimating/assets/drawing-pdf-yLVy8x2z.js",
  "./estimating/assets/es-CCS5xjwS.js",
  "./estimating/assets/index-BW5snuq_.css",
  "./estimating/assets/index-U9rhE2vn.js",
  "./estimating/assets/job-accounting-workbook-nafjXhd6.js",
  "./estimating/assets/job-schedule-pdf-NiPCbVO8.js",
  "./estimating/assets/job-warranty-pdf-n-TM74RG.js",
  "./estimating/assets/pdf-Bs__3tTL.js",
  "./estimating/assets/pdf-cU_t5T48.js",
  "./estimating/assets/proposal-pdf-BTZR32C7.js",
  "./estimating/assets/purchase-order-pdf-CjGGQzpn.js",
  "./estimating/assets/quote-backup-pdf-IJxRzt-A.js",
  "./estimating/assets/rfi-pdf-C6-15RtA.js",
  "./estimating/assets/src-BOJxVVCU.js"
];

function isJgcCacheableResponse(response) {
  return Boolean(response && (response.ok || response.type === "opaque"));
}

function storeJgcResponse(request, response) {
  if (!isJgcCacheableResponse(response)) {
    return Promise.resolve();
  }

  const copy = response.clone();
  return caches
    .open(JGC_CACHE_NAME)
    .then((cache) => cache.put(request, copy))
    .catch(() => {});
}

async function cacheJgcAppShellAsset(cache, url) {
  const request = new Request(url, { cache: "reload" });
  // Content-hashed build files are immutable. Copy them across release caches
  // instead of downloading the same large historical bundles on every update.
  if (/\/estimating\/assets\/[^/]+-[A-Za-z0-9_-]{8}\.(?:js|css)$/.test(new URL(url, self.location.href).pathname)) {
    const existing = await caches.match(request);
    if (existing && existing.ok) return cache.put(url, existing);
  }

  return fetch(request).then((response) => {
    if (!response || !response.ok) {
      const status = response ? response.status : "no response";
      throw new Error(`JGC app shell could not cache ${url} (${status}).`);
    }

    return cache.put(url, response);
  });
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(JGC_CACHE_NAME)
      .then(async (cache) => {
        let next = 0;
        // Limit competing downloads on weak signal. Only this release's assets are listed.
        const download = async () => {
          while (next < JGC_APP_SHELL.length) await cacheJgcAppShellAsset(cache, JGC_APP_SHELL[next++]);
        };
        await Promise.all(Array.from({ length: 4 }, download));
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith(JGC_CACHE_PREFIX) && key !== JGC_CACHE_NAME)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

const JGC_NAVIGATION_WAIT_MS = 3000;

function getJgcNavigationResponse(event) {
  const request = event.request;
  const network = fetch(request).then(async (response) => {
    if (!response.ok) throw new Error("Page request failed");
    const pageUrl = new URL(request.url); pageUrl.search = ""; pageUrl.hash = "";
    await storeJgcResponse(pageUrl.href, response);
    return response;
  });
  // Keep the refresh alive after returning a saved screen; no API responses are cached.
  event.waitUntil(network.then(() => {}, () => {}));
  return caches.open(JGC_CACHE_NAME).then(async (cache) => {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (!cached) {
      return network.catch(async () => (await cache.match("./index.html")) || Response.error());
    }
    let timer;
    try {
      return await Promise.race([
        network.catch(() => cached),
        new Promise((resolve) => { timer = setTimeout(() => resolve(cached), JGC_NAVIGATION_WAIT_MS); })
      ]);
    } finally { clearTimeout(timer); }
  });
}

self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);

  if (url.hostname.includes("supabase.co") || url.hostname.includes("script.google.com")) {
    return;
  }

  if (request.mode === "navigate" && url.origin === self.location.origin) {
    event.respondWith(getJgcNavigationResponse(event));
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) {
          fetch(request, { cache: "reload" }).then((response) => {
            storeJgcResponse(request, response);
          }).catch(() => {});
          return cached;
        }

        return fetch(request, { cache: "reload" }).then((response) => {
          storeJgcResponse(request, response);
          return response;
        });
      })
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      storeJgcResponse(request, response);
      return response;
    }))
  );
});

self.addEventListener("push", (event) => {
  let payload = {};

  try {
    payload = event.data ? event.data.json() : {};
  } catch (error) {
    payload = {
      title: "JGC Portal",
      body: event.data ? event.data.text() : "New portal notification"
    };
  }

  const title = payload.title || "JGC Portal";
  const options = {
    body: payload.body || payload.message || "New portal notification",
    icon: payload.icon || "./icon-192.png?v=4",
    badge: payload.badge || "./icon-180.png?v=4",
    tag: payload.tag || payload.notification_id || "jgc-portal-notification",
    data: {
      url: payload.url || payload.link_url || "./home.html",
      notification_id: payload.notification_id || ""
    },
    renotify: true
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  // Only open a Portal page from a notification, never another site or a javascript:/data: address.
  let targetUrl = new URL("home.html", self.registration.scope).href;
  try {
    const requested = new URL(event.notification.data && event.notification.data.url || "home.html", self.registration.scope);
    if (requested.origin === self.location.origin) {
      targetUrl = requested.href;
    }
  } catch (error) {
    // Keep the Home page.
  }

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client && client.url === targetUrl) {
          return client.focus();
        }
      }

      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }

      return null;
    })
  );
});
