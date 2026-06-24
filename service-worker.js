const JGC_CACHE_NAME = "jgc-portal-v364";
const JGC_APP_SHELL = [
  "./",
  "./index.html",
  "./acknowledge.html",
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
  "./policies-announcements.html",
  "./equipment-vehicles.html",
  "./field-calculator.html",
  "./jobs.html",
  "./work-orders.html",
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
  "./reset-password.html",
  "./aerial-lifts.html",
  "./forklift.html",
  "./harness.html",
  "./hot-work-permit.html",
  "./jsa.html",
  "./jsa.html?v=361",
  "./tele-handler.html",
  "./styles.css?v=3",
  "./common.js?v=7",
  "./safety-acknowledgements.js?v=2",
  "./field-calculator.css?v=14",
  "./calculator-engine.js?v=25",
  "./calculator-functions.js?v=28",
  "./field-calculator.js?v=29",
  "./auth.js",
  "./inspection-records.js?v=7",
  "./manifest.json?v=4",
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
