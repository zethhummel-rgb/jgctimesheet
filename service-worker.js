const JGC_CACHE_NAME = "jgc-portal-v54";
const JGC_APP_SHELL = [
  "./",
  "./index.html",
  "./home.html",
  "./timesheet.html",
  "./inspections.html",
  "./daily-site-report.html",
  "./todays-inspections.html",
  "./previous-inspections.html",
  "./certificates.html",
  "./vacation-request.html",
  "./contacts.html",
  "./policies-announcements.html",
  "./equipment-vehicles.html",
  "./admin.html",
  "./accounts.html",
  "./reset-password.html",
  "./aerial-lifts.html",
  "./forklift.html",
  "./harness.html",
  "./hot-work-permit.html",
  "./jsa.html",
  "./tele-handler.html",
  "./styles.css?v=2",
  "./common.js?v=2",
  "./auth.js",
  "./inspection-records.js",
  "./manifest.json?v=3",
  "./logo.png",
  "./login-background.jpeg",
  "./icon-180.png?v=3",
  "./icon-192.png?v=3",
  "./icon-512.png?v=3"
];

function patchAdminJobsDelete(html) {
  if (!html.includes("clearJobsExcelFile()") || html.includes("deleteImportedJobs()")) {
    return html;
  }

  const patchedHtml = html.replace(
    '<button class="delete-button" type="button" onclick="clearJobsExcelFile()">Delete File</button>',
    '<button class="delete-button" type="button" onclick="deleteImportedJobs()">Delete Uploaded Jobs</button>'
  );

  const script = `
<script>
async function deleteImportedJobs() {
  const fileInput = document.getElementById("jobsExcelFile");
  const status = document.getElementById("jobsImportStatus");
  const confirmed = confirm("Delete all imported jobs from the portal? This will clear the jobs dropdown until a new Excel file is imported.");

  if (!confirmed) {
    return;
  }

  if (status) {
    status.textContent = "Deleting imported jobs...";
  }

  const client = typeof supabaseClient !== "undefined" ? supabaseClient : createJgcSupabaseClient();
  const result = await client
    .from("jobs")
    .delete()
    .not("id", "is", null);

  if (result.error) {
    if (status) {
      status.textContent = "Imported jobs could not be deleted: " + result.error.message;
    }
    return;
  }

  if (typeof jobs !== "undefined") {
    jobs = [];
  }

  if (fileInput) {
    fileInput.value = "";
  }

  if (typeof renderJobsManagement === "function") {
    renderJobsManagement();
  }

  if (status) {
    status.textContent = "All imported jobs were deleted.";
  }
}
</script>
`;

  return patchedHtml.replace("</body>", script + "\n</body>");
}

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
          if (url.pathname.endsWith("/admin.html")) {
            return response.text().then((html) => {
              const patchedResponse = new Response(patchAdminJobsDelete(html), {
                status: response.status,
                statusText: response.statusText,
                headers: response.headers
              });
              const copy = patchedResponse.clone();
              caches.open(JGC_CACHE_NAME).then((cache) => cache.put(request, copy));
              return patchedResponse;
            });
          }

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
