(function() {
  "use strict";

  const states = window.__jgcSyncStates = window.__jgcSyncStates || {};
  let onlineMessageTimer = 0;
  let indicator = null;
  let indicatorText = null;

  function normalizeState(source, detail) {
    const value = detail || {};
    return {
      source: String(source || "portal"),
      pending: Math.max(0, Number(value.pending || 0)),
      status: String(value.status || "idle"),
      message: String(value.message || ""),
      updatedAt: new Date().toISOString()
    };
  }

  function getSummary() {
    const entries = Object.values(states);
    return {
      pending: entries.reduce((total, item) => total + Math.max(0, Number(item && item.pending || 0)), 0),
      syncing: entries.some((item) => item && item.status === "syncing"),
      error: entries.find((item) => item && item.status === "error" && item.message)
    };
  }

  function ensureIndicator() {
    if (indicator || !document.body) {
      return;
    }

    const style = document.createElement("style");
    style.textContent = `
      .jgc-offline-status {
        position: fixed;
        right: 12px;
        bottom: calc(env(safe-area-inset-bottom, 0px) + 12px);
        z-index: 10025;
        display: none;
        align-items: center;
        min-height: 34px;
        max-width: calc(100vw - 24px);
        padding: 7px 11px;
        color: #ffffff;
        background: #205d35;
        border: 1px solid rgba(255, 255, 255, 0.28);
        border-radius: 6px;
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.28);
        font-size: 14px;
        font-weight: 700;
        letter-spacing: 0;
        pointer-events: none;
      }

      .jgc-offline-status.is-visible { display: inline-flex; }
      .jgc-offline-status.is-warning { background: #74550d; }
      .jgc-offline-status.is-error { background: #a52a22; }

      @media (max-width: 800px) {
        .jgc-offline-status {
          right: 10px;
          bottom: calc(env(safe-area-inset-bottom, 0px) + 82px);
        }
      }
    `;
    document.head.appendChild(style);

    indicator = document.createElement("div");
    indicator.className = "jgc-offline-status";
    indicator.setAttribute("role", "status");
    indicator.setAttribute("aria-live", "polite");
    indicatorText = document.createElement("span");
    indicator.appendChild(indicatorText);
    document.body.appendChild(indicator);
  }

  function render(messageOverride) {
    ensureIndicator();
    if (!indicator || !indicatorText) {
      return;
    }

    const summary = getSummary();
    indicator.className = "jgc-offline-status";

    if (navigator.onLine === false) {
      indicatorText.textContent = summary.pending
        ? "Offline - " + summary.pending + " waiting to sync"
        : "Offline";
      indicator.classList.add("is-visible", "is-warning");
      return;
    }

    if (summary.syncing) {
      indicatorText.textContent = "Syncing saved work...";
      indicator.classList.add("is-visible");
      return;
    }

    if (summary.error) {
      indicatorText.textContent = summary.error.message || "Some saved work is still waiting to sync";
      indicator.classList.add("is-visible", "is-error");
      return;
    }

    if (summary.pending) {
      indicatorText.textContent = summary.pending + " item" + (summary.pending === 1 ? "" : "s") + " waiting to sync";
      indicator.classList.add("is-visible", "is-warning");
      return;
    }

    if (messageOverride) {
      indicatorText.textContent = messageOverride;
      indicator.classList.add("is-visible");
    }
  }

  function report(source, detail) {
    const normalized = normalizeState(source, detail);
    states[normalized.source] = normalized;
    render();
  }

  window.reportJgcSyncState = report;
  window.getJgcSyncState = function() {
    return JSON.parse(JSON.stringify(states));
  };

  window.addEventListener("jgc:sync-state", function(event) {
    const detail = event.detail || {};
    report(detail.source, detail);
  });

  window.addEventListener("offline", function() {
    window.clearTimeout(onlineMessageTimer);
    render();
  });

  window.addEventListener("online", function() {
    render("Back online");
    window.clearTimeout(onlineMessageTimer);
    onlineMessageTimer = window.setTimeout(function() {
      render();
    }, 1800);
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function() {
      render();
    }, { once: true });
  } else {
    render();
  }
})();
