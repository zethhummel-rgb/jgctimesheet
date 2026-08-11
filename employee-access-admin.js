(function () {
  "use strict";

  const featureApi = window.JGCEmployeeFeatureAccess;
  const state = {
    client: null,
    user: null,
    profile: null,
    workers: [],
    accessRows: [],
    profiles: []
  };
  const elements = {};

  function byId(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function normalizeWorkerName(value) {
    return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
  }

  function showNotice(message, type) {
    elements.notice.textContent = String(message || "");
    elements.notice.hidden = !message;
    elements.notice.classList.toggle("jgc-notice--danger", type === "error");
    if (type === "error") {
      elements.notice.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  function refreshIcons() {
    if (window.lucide && typeof window.lucide.createIcons === "function") {
      window.lucide.createIcons();
    }
  }

  function profileForWorker(worker) {
    return state.profiles.find(function (profile) {
      return worker.profile_id && profile.id === worker.profile_id;
    }) || {};
  }

  function isEligibleWorker(worker) {
    const profile = profileForWorker(worker);
    if (worker.profile_id) {
      return profile.account_status === "approved";
    }
    return worker.approved !== false;
  }

  function featureEligible(worker, featureKey) {
    return featureApi.isWorkerEligibleForFeature(worker, featureKey, profileForWorker(worker));
  }

  function accessEnabled(worker, featureKey) {
    if (!featureEligible(worker, featureKey)) {
      return false;
    }

    const row = state.accessRows.find(function (accessRow) {
      return accessRow.worker_id === worker.id && accessRow.feature_key === featureKey;
    });
    return row ? row.enabled !== false : featureKey !== "accounting";
  }

  function renderHeader() {
    elements.header.innerHTML = "<th>Employee</th>"
      + featureApi.FEATURES.map(function (feature) {
        return '<th class="employee-access-feature-head"><span>' + escapeHtml(feature.label)
          + '</span><small>' + escapeHtml(feature.description) + "</small></th>";
      }).join("");
  }

  function renderRows() {
    const query = String(elements.search.value || "").trim().toLowerCase();
    const eligibleWorkers = state.workers.filter(isEligibleWorker);
    const workers = eligibleWorkers.filter(function (worker) {
      const profile = profileForWorker(worker);
      return !query || [
        worker.display_name,
        worker.worker_key,
        profile.email
      ].join(" ").toLowerCase().includes(query);
    });

    elements.accountCount.textContent = eligibleWorkers.filter(function (worker) {
      return Boolean(worker.profile_id);
    }).length;
    elements.manualCount.textContent = eligibleWorkers.filter(function (worker) {
      return !worker.profile_id;
    }).length;

    if (!workers.length) {
      elements.rows.innerHTML = '<tr><td colspan="' + (featureApi.FEATURES.length + 1)
        + '" class="jgc-empty-state">No matching employees found.</td></tr>';
      return;
    }

    elements.rows.innerHTML = workers.map(function (worker) {
      const profile = profileForWorker(worker);
      const source = worker.profile_id ? (profile.email || "Portal account") : "Manual employee";
      const editButton = worker.profile_id ? "" :
        '<button class="jgc-button jgc-button--secondary employee-access-edit" type="button" data-edit-worker="'
        + escapeHtml(worker.id) + '">Edit Name</button>';
      return '<tr class="employee-access-row">'
        + '<td class="employee-access-person"><strong>' + escapeHtml(worker.display_name || worker.worker_key || "Employee")
        + '</strong><small>' + escapeHtml(source) + '</small>'
        + editButton + "</td>"
        + featureApi.FEATURES.map(function (feature) {
          const eligible = featureEligible(worker, feature.key);
          const requirementText = "Account required";
          const unavailableTitle = feature.key === "accounting"
            ? "A portal account is required before this employee can be included in Accounting."
            : "A portal account is required for Work Orders.";
          const requirement = eligible ? "" : '<small class="employee-access-requirement">'
            + requirementText + "</small>";
          return '<td class="' + (eligible ? "" : "employee-access-unavailable") + '"><input class="employee-access-check" type="checkbox" aria-label="'
            + escapeHtml(feature.label) + '" data-worker-feature="' + escapeHtml(worker.id)
            + '" data-feature-key="' + escapeHtml(feature.key) + '"'
            + (accessEnabled(worker, feature.key) ? " checked" : "")
            + (eligible ? "" : ' disabled title="' + unavailableTitle + '"')
            + ">" + requirement + "</td>";
        }).join("")
        + "</tr>";
    }).join("");
  }

  async function refreshData(message) {
    const results = await Promise.all([
      state.client.from("work_order_labour_workers").select("*").order("display_name", { ascending: true }),
      state.client.from("employee_feature_access").select("worker_id,feature_key,enabled,updated_at"),
      state.client.from("profiles").select("id,email,display_name,worker_key,role,account_status")
    ]);
    const failed = results.find(function (result) {
      return result.error;
    });

    if (failed) {
      showNotice("Employee access could not be loaded: " + failed.error.message, "error");
      return;
    }

    state.workers = results[0].data || [];
    state.accessRows = results[1].data || [];
    state.profiles = results[2].data || [];
    renderRows();
    if (message) {
      showNotice(message);
    }
  }

  async function updateFeature(workerId, featureKey, enabled) {
    const worker = state.workers.find(function (row) {
      return row.id === workerId;
    });
    if (enabled && !featureEligible(worker, featureKey)) {
      renderRows();
      showNotice(
        featureKey === "accounting"
          ? "A portal account is required before this employee can be included in Accounting."
          : "A portal account is required before this employee can be selected on Work Orders.",
        "error"
      );
      return;
    }

    const result = await state.client
      .from("employee_feature_access")
      .upsert({
        worker_id: workerId,
        feature_key: featureKey,
        enabled: enabled,
        updated_by: state.user.id,
        updated_at: new Date().toISOString()
      }, {
        onConflict: "worker_id,feature_key"
      });

    if (result.error) {
      await refreshData();
      showNotice("Page access could not be updated: " + result.error.message, "error");
      return;
    }

    const existing = state.accessRows.find(function (row) {
      return row.worker_id === workerId && row.feature_key === featureKey;
    });
    if (existing) {
      existing.enabled = enabled;
    } else {
      state.accessRows.push({ worker_id: workerId, feature_key: featureKey, enabled: enabled });
    }
    showNotice("Employee page access updated.");
  }

  async function addEmployee() {
    const displayName = String(elements.newName.value || "").trim();
    if (!displayName) {
      showNotice("Enter an employee name first.", "error");
      return;
    }

    const result = await state.client
      .from("work_order_labour_workers")
      .upsert({
        display_name: displayName,
        worker_key: normalizeWorkerName(displayName),
        approved: true,
        updated_at: new Date().toISOString()
      }, {
        onConflict: "worker_key"
      });

    if (result.error) {
      showNotice("Employee could not be added: " + result.error.message, "error");
      return;
    }

    elements.newName.value = "";
    await refreshData(displayName + " was added and enabled for all employee selectors.");
  }

  async function editWorker(workerId) {
    const worker = state.workers.find(function (row) {
      return row.id === workerId;
    });
    if (!worker) {
      return;
    }

    const nextName = window.prompt("Update employee name:", worker.display_name || "");
    if (nextName == null) {
      return;
    }

    const displayName = nextName.trim();
    if (!displayName) {
      showNotice("Employee name cannot be blank.", "error");
      return;
    }

    const payload = {
      display_name: displayName,
      updated_at: new Date().toISOString()
    };
    if (!worker.profile_id) {
      payload.worker_key = normalizeWorkerName(displayName);
    }

    const result = await state.client
      .from("work_order_labour_workers")
      .update(payload)
      .eq("id", workerId);

    if (result.error) {
      showNotice("Employee name could not be updated: " + result.error.message, "error");
      return;
    }

    await refreshData("Employee name updated.");
  }

  function bindEvents() {
    elements.refresh.addEventListener("click", function () {
      refreshData("Employee access refreshed.");
    });
    elements.add.addEventListener("click", addEmployee);
    elements.newName.addEventListener("keydown", function (event) {
      if (event.key === "Enter") {
        event.preventDefault();
        addEmployee();
      }
    });
    elements.search.addEventListener("input", renderRows);
    elements.rows.addEventListener("change", function (event) {
      const featureInput = event.target.closest("[data-worker-feature]");
      if (featureInput) {
        updateFeature(
          featureInput.dataset.workerFeature,
          featureInput.dataset.featureKey,
          featureInput.checked
        );
      }
    });
    elements.rows.addEventListener("click", function (event) {
      const editButton = event.target.closest("[data-edit-worker]");
      if (editButton) {
        editWorker(editButton.dataset.editWorker);
      }
    });
  }

  async function init() {
    if (!featureApi) {
      return;
    }

    elements.currentUser = byId("employeeAccessCurrentUser");
    elements.notice = byId("employeeAccessNotice");
    elements.refresh = byId("employeeAccessRefresh");
    elements.add = byId("employeeAccessAdd");
    elements.newName = byId("employeeAccessNewName");
    elements.search = byId("employeeAccessSearch");
    elements.header = byId("employeeAccessHeader");
    elements.rows = byId("employeeAccessRows");
    elements.accountCount = byId("employeeAccessAccountCount");
    elements.manualCount = byId("employeeAccessManualCount");

    renderHeader();
    bindEvents();
    refreshIcons();

    state.client = typeof createJgcSupabaseClient === "function"
      ? createJgcSupabaseClient()
      : null;
    if (!state.client) {
      showNotice("Supabase is not available.", "error");
      return;
    }

    const userResult = await state.client.auth.getUser();
    state.user = userResult.data && userResult.data.user;
    if (!state.user) {
      window.location.href = "index.html";
      return;
    }

    const profileResult = await state.client
      .from("profiles")
      .select("id,email,display_name,worker_key,role,account_status")
      .eq("id", state.user.id)
      .single();
    state.profile = profileResult.data;

    if (profileResult.error || !state.profile || String(state.profile.role || "").toLowerCase() !== "admin") {
      window.location.href = "home.html";
      return;
    }

    elements.currentUser.textContent = "Signed in as: "
      + (state.profile.display_name || state.profile.worker_key || state.profile.email || "Admin");
    await refreshData();
  }

  init();
})();
