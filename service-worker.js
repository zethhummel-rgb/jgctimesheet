const JGC_RELEASE_ID = "633";
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
  "./accounts.html",
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
  "./admin.css?v=1",
  "./jgc-design-system.css?v=5",
  "./job-lists.css?v=2",
  "./permit-design-system.css?v=1",
  "./report-design-system.css?v=1",
  "./timesheet-design-system.css?v=1",
  "./tasks-design-system.css?v=1",
  "./policy-design-system.css?v=1",
  "./directory-design-system.css?v=1",
  "./jobs-design-system.css?v=1",
  "./schedule-design-system.css?v=1",
  "./specialty-inspection-design-system.css?v=1",
  "./qr-inspection-design-system.css?v=1",
  "./home-design-system.css?v=1",
  "./field-calculator-design-system.css?v=1",
  "./notification-settings-design-system.css?v=1",
  "./acknowledgement-design-system.css?v=1",
  "./reset-password-design-system.css?v=1",
  "./login-design-system.css?v=1",
  "./subcontractor-design-system.css?v=1",
  "./common.js?v=32",
  "./job-lists.js?v=2",
  "./job-lists-admin.js?v=2",
  "./admin-housekeeping.js?v=1",
  "./shared-uploads.css?v=3",
  "./shared-uploads.js?v=3",
  "./offline-sync.js?v=2",
  "./admin-backups.js?v=3",
  "./admin-contacts.js?v=1",
  "./admin-vacation.js?v=2",
  "./admin-notices.js?v=1",
  "./admin-certificates.js?v=3",
  "./admin-inspections.js?v=4",
  "./admin-reports.js?v=2",
  "./admin-employee-profile.js?v=1",
  "./admin-jobs.js?v=2",
  "./admin-work-orders.js?v=2",
  "./admin-equipment.js?v=1",
  "./admin-timesheets.js?v=4",
  "./admin-summary.js?v=1",
  "./admin-core.js?v=3",
  "./diagnostics-admin.css?v=1",
  "./diagnostics-admin.js?v=2",
  "./purchase-orders.css?v=17",
  "./purchase-orders-pdf.js?v=2",
  "./purchase-orders.js?v=18",
  "./purchase-orders-admin.js?v=12",
  "./work-order-digital-pos.js?v=3",
  "./safety-acknowledgements.js?v=4",
  "./field-calculator.css?v=14",
  "./calculator-engine.js?v=25",
  "./calculator-functions.js?v=28",
  "./field-calculator.js?v=30",
  "./auth.js?v=7",
  "./inspection-records.js?v=10",
  "./inspection-mobile.css?v=3",
  "./inspection-mobile.js?v=6",
  "./manifest.json?v=7",
  "./vendor/supabase-js.min.js?v=1",
  "./vendor/tus.min.js?v=1",
  "./vendor/exceljs.min.js?v=1",
  "./vendor/jszip.min.js?v=1",
  "./vendor/jspdf.umd.min.js?v=1",
  "./vendor/lucide.min.js",
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
