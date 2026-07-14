const JGC_CACHE_NAME = "jgc-portal-v496";
const JGC_APP_SHELL = [
  "./",
  "./index.html",
  "./acknowledge.html",
  "./equipment-inspection.html",
  "./vehicle-inspection.html",
  "./subcontractor.html",
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
  "./permits.html",
  "./confined-space-permit.html",
  "./excavation-permit.html",
  "./reports.html",
  "./accident-report.html",
  "./employee-injury-report.html",
  "./toolbox-talks.html",
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
  "./jsa.html?v=361",
  "./tele-handler.html",
  "./styles.css?v=3",
  "./common.js?v=21",
  "./common.js?v=22",
  "./purchase-orders.css?v=5",
  "./purchase-orders-pdf.js?v=1",
  "./purchase-orders.js?v=5",
  "./purchase-orders-admin.js?v=1",
  "./work-order-digital-pos.js?v=1",
  "./safety-acknowledgements.js?v=3",
  "./field-calculator.css?v=14",
  "./calculator-engine.js?v=25",
  "./calculator-functions.js?v=28",
  "./field-calculator.js?v=29",
  "./auth.js?v=6",
  "./inspection-records.js?v=7",
  "./inspection-mobile.css?v=2",
  "./inspection-mobile.js?v=4",
  "./manifest.json?v=5",
  "./vendor/supabase-js.min.js?v=1",
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

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(JGC_CACHE_NAME)
      .then((cache) => Promise.all(
        JGC_APP_SHELL.map((url) => {
          const request = new Request(url, { cache: "reload" });
          return fetch(request)
            .then((response) => {
              if (response && response.ok) {
                return cache.put(url, response);
              }
              return Promise.resolve();
            })
            .catch(() => Promise.resolve());
        })
      ))
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
      .then((keys) => Promise.all(keys.filter((key) => key !== JGC_CACHE_NAME).map((key) => caches.delete(key))))
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
          const copy = response.clone();
          caches.open(JGC_CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match("./index.html")))
    );
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) {
          fetch(request, { cache: "reload" }).then((response) => {
            const copy = response.clone();
            caches.open(JGC_CACHE_NAME).then((cache) => cache.put(request, copy));
          }).catch(() => {});
          return cached;
        }

        return fetch(request, { cache: "reload" }).then((response) => {
          const copy = response.clone();
          caches.open(JGC_CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        });
      })
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      const copy = response.clone();
      caches.open(JGC_CACHE_NAME).then((cache) => cache.put(request, copy));
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
