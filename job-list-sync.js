(function () {
  "use strict";
  const key = "jgc-job-list-revision";
  const listeners = new Set();
  function refresh() {
    if (document.visibilityState === "hidden") return;
    listeners.forEach((listener) => listener());
  }
  window.JGCJobListSync = {
    watch(callback) {
      let running = false;
      let lastRun = 0;
      const listener = async () => {
        if (running || Date.now() - lastRun < 1000) return;
        running = true;
        lastRun = Date.now();
        try { await callback(); }
        catch { /* Keep the current list and retry at the next refresh. */ }
        finally { running = false; }
      };
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
  // Share only an invalidation timestamp, never job data or estimating costs.
  window.addEventListener("jgc-jobs-saved", () => {
    try { localStorage.setItem(key, String(Date.now())); } catch { /* Focus/polling still refresh. */ }
    refresh();
  });
  window.addEventListener("storage", (event) => { if (event.key === key) refresh(); });
  window.addEventListener("focus", refresh);
  window.addEventListener("pageshow", refresh);
  window.addEventListener("online", refresh);
  document.addEventListener("visibilitychange", refresh);
  // Imports on other devices are picked up without requiring a page reload.
  window.setInterval(refresh, 60000);
})();
