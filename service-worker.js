const JGC_RELEASE_ID = "845";
const JGC_CACHE_PREFIX = "jgc-portal-v";
const JGC_CACHE_NAME = JGC_CACHE_PREFIX + JGC_RELEASE_ID;
const JGC_APP_SHELL = [
  "./",
  "./index.html",
  "./acknowledge.html",
  "./equipment-inspection.html",
  "./vehicle-inspection.html",
  "./subcontractor.html",
  "./limited-access.html",
  "./limited-access.css?v=1",
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
  "./toolbox-report-actions.js?v=1",
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
  "./tele-handler.html",
  "./policies-admin.html",
  "./styles.css?v=3",
  "./admin.css?v=16",
  "./admin-shell-design-system.css?v=3",
  "./inspection-history-today.css?v=1",
  "./inspection-history-previous.css?v=1",
  "./safety-records-admin.css?v=2",
  "./admin-global-search.css?v=7",
  "./accounting-admin.css?v=6",
  "./jgc-design-system.css?v=8",
  "./estimator-theme.css?v=1",
  "./certificates-admin.css?v=1",
  "./certificates-embedded.css?v=1",
  "./equipment-admin.css?v=1",
  "./employee-access-admin.css?v=3",
  "./job-lists.css?v=11",
  "./permit-design-system.css?v=2",
  "./report-design-system.css?v=2",
  "./daily-site-report.css?v=1",
  "./jsa-report.css?v=1",
  "./toolbox-talks-report.css?v=1",
  "./incident-report.css?v=1",
  "./accident-report.css?v=1",
  "./employee-injury-report.css?v=1",
  "./reports-admin.css?v=1",
  "./timesheet-design-system.css?v=2",
  "./tasks-design-system.css?v=2",
  "./directory-design-system.css?v=2",
  "./jobs-design-system.css?v=3",
  "./schedule-design-system.css?v=4",
  "./work-orders-design-system.css?v=2",
  "./vacation-design-system.css?v=2",
  "./specialty-inspection-design-system.css?v=2",
  "./qr-inspection-design-system.css?v=2",
  "./equipment-qr-inspection.css?v=1",
  "./vehicle-qr-inspection.css?v=1",
  "./home-design-system.css?v=4",
  "./notification-settings-design-system.css?v=3",
  "./acknowledgement-design-system.css?v=2",
  "./login-design-system.css?v=3",
  "./common.js?v=40",
  "./admin-global-search.js?v=7",
  "./accounting-workbook.js?v=9",
  "./accounting-admin.js?v=10",
  "./employee-feature-access.js?v=3",
  "./employee-access-admin.js?v=4",
  "./job-lists.js?v=13",
  "./job-lists-admin.js?v=3",
  "./admin-housekeeping.js?v=1",
  "./shared-uploads.css?v=3",
  "./shared-uploads.js?v=3",
  "./offline-sync.js?v=2",
  "./admin-backups.js?v=3",
  "./admin-contacts.js?v=2",
  "./admin-vacation.js?v=4",
  "./admin-notices.js?v=3",
  "./admin-certificates.js?v=4",
  "./admin-inspections.js?v=4",
  "./admin-reports.js?v=3",
  "./admin-employee-profile.js?v=1",
  "./admin-jobs.js?v=7",
  "./admin-work-orders.js?v=3",
  "./admin-equipment.js?v=2",
  "./admin-timesheets.js?v=10",
  "./admin-summary.js?v=3",
  "./admin-core.js?v=6",
  "./diagnostics-admin.css?v=2",
  "./diagnostics-admin.js?v=2",
  "./purchase-orders.css?v=22",
  "./purchase-orders-pdf.js?v=2",
  "./purchase-orders.js?v=22",
  "./purchase-orders-admin.js?v=14",
  "./work-order-digital-pos.js?v=3",
  "./safety-signature-pad.css?v=1",
  "./safety-signature-pad.js?v=1",
  "./safety-acknowledgements.js?v=7",
  "./jsa-pdf.js?v=1",
  "./field-calculator.css?v=15",
  "./calculator-engine.js?v=25",
  "./calculator-functions.js?v=28",
  "./field-calculator.js?v=30",
  "./auth.js?v=7",
  "./inspection-records.js?v=11",
  "./inspection-mobile.css?v=3",
  "./inspection-mobile.js?v=6",
  "./manifest.json?v=7",
  "./vendor/supabase-js.min.js?v=1",
  "./vendor/tus.min.js?v=1",
  "./vendor/exceljs.min.js?v=1",
  "./vendor/jszip.min.js?v=1",
  "./vendor/jspdf.umd.min.js?v=1",
  "./vendor/lucide.min.js",
  "./estimating/assets/index-D5bg2Aoz.js",
  "./estimating/assets/index-Cq6qcbvm.css",
  "./estimating/assets/es-DfNDvGdY.js",
  "./estimating/assets/pdf-DjU5Xkxn.js",
  "./estimating/assets/src-BGIqZ8Vv.js",
  "./estimating/assets/proposal-pdf-D3KZIgFU.js",
  "./estimating/assets/purchase-order-pdf-Dg0-xmVu.js",
  "./estimating/assets/quote-backup-pdf-DOsRpBvz.js",
  "./estimating/assets/index-BXasRDaq.js",
  "./estimating/assets/es-D_CF-AMp.js",
  "./estimating/assets/pdf-tsk1kJ7a.js",
  "./estimating/assets/src-Dg0NQiH_.js",
  "./estimating/assets/proposal-pdf-D0fiUnHt.js",
  "./estimating/assets/purchase-order-pdf-BaXGk6yV.js",
  "./estimating/assets/quote-backup-pdf-DeRmxmpu.js",
  "./estimating/assets/index-x0v69QTF.js",
  "./estimating/assets/index-PvTVewfb.css",
  "./estimating/assets/es-CDS0acVr.js",
  "./estimating/assets/pdf-Cn95CSww.js",
  "./estimating/assets/src-CgmJP66g.js",
  "./estimating/assets/proposal-pdf-B0hLnAtz.js",
  "./estimating/assets/purchase-order-pdf-DhRMpQ5u.js",
  "./estimating/assets/quote-backup-pdf-Cb5ODrxr.js",
  "./estimating/assets/index-CotW7wdg.js",
  "./estimating/assets/index-CGoL2ogD.css",
  "./estimating/assets/es-B8HSbBC-.js",
  "./estimating/assets/pdf-CeSzYUcn.js",
  "./estimating/assets/src-l1rnY2I6.js",
  "./estimating/assets/proposal-pdf-gQ6yoXhu.js",
  "./estimating/assets/purchase-order-pdf-D8N0f9E_.js",
  "./estimating/assets/quote-backup-pdf-PrmwnrII.js",
  "./estimating/assets/index-CR9JU4Ju.js",
  "./estimating/assets/index-Cbqwhm-3.css",
  "./estimating/assets/es-DV_xeIBW.js",
  "./estimating/assets/pdf-DT4ISb1r.js",
  "./estimating/assets/src-DPvqSf3B.js",
  "./estimating/assets/proposal-pdf-_eEgp25r.js",
  "./estimating/assets/purchase-order-pdf-BecqiZBK.js",
  "./estimating/assets/quote-backup-pdf-CxEVPaW2.js",
  "./estimating/assets/index-DZBJjn2f.js",
  "./estimating/assets/index-CJIg6uPY.css",
  "./estimating/assets/es-BFsECWFO.js",
  "./estimating/assets/pdf-DUiL6fyP.js",
  "./estimating/assets/src-BSgnj78Y.js",
  "./estimating/assets/proposal-pdf-D4Lhs4zM.js",
  "./estimating/assets/purchase-order-pdf-CTIUi3Ap.js",
  "./estimating/assets/quote-backup-pdf-CjNxE8IP.js",
  "./estimating/jgc-letterhead-logo.jpg",
  "./estimating/jgc-logo-transparent.png",
  "./logo.webp",
  "./login-background.webp",
  "./jgc-login-qr.png",
  "./jgc-login-qr-print.png",
  "./icon-180.png?v=4",
  "./icon-192.png?v=4",
  "./icon-512.png?v=4"
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

function cacheJgcAppShellAsset(cache, url) {
  const request = new Request(url, { cache: "reload" });

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
      .then((cache) => Promise.all(JGC_APP_SHELL.map((url) => cacheJgcAppShellAsset(cache, url))))
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

self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);

  if (url.hostname.includes("supabase.co") || url.hostname.includes("script.google.com")) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          storeJgcResponse(request, response);
          return response;
        })
        .catch(() => caches.match(request, { ignoreSearch: true }).then((cached) => cached || caches.match("./index.html")))
    );
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

  const targetUrl = new URL(event.notification.data && event.notification.data.url || "./home.html", self.location.origin).href;

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
