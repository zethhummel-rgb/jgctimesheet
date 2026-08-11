(function (global) {
  "use strict";

  const FEATURES = Object.freeze([
    { key: "work_orders", label: "Work Orders", description: "Work Order labour and crew selectors" },
    { key: "schedule", label: "Schedule", description: "Admin and employee schedule tagging" },
    { key: "jsa", label: "JSA", description: "Approved employee sign-off selector" },
    { key: "toolbox_talks", label: "Toolbox Talks", description: "Presenter and crew selectors" },
    { key: "job_notes", label: "Job Notes", description: "Employees who can be tagged on shared notes" },
    { key: "tasks", label: "Tasks", description: "Task assignment selector" },
    { key: "accounting", label: "Accounting", description: "Admin payroll review and Excel exports" }
  ]);

  const FEATURE_KEYS = Object.freeze(FEATURES.map(function (feature) {
    return feature.key;
  }));

  const PORTAL_ACCOUNT_REQUIRED_FEATURES = Object.freeze([
    "work_orders",
    "accounting"
  ]);

  function isWorkerEligibleForFeature(worker, featureKey, profile) {
    if (!worker || worker.approved === false) {
      return false;
    }

    if (PORTAL_ACCOUNT_REQUIRED_FEATURES.includes(featureKey) && !worker.profile_id) {
      return false;
    }

    if (featureKey === "accounting") {
      return Boolean(
        profile
        && String(profile.role || "").toLowerCase() === "admin"
        && String(profile.account_status || "").toLowerCase() === "approved"
      );
    }

    return true;
  }

  function filterWorkers(workers, accessRows, featureKey, options) {
    const source = Array.isArray(workers) ? workers : [];
    const approved = source.filter(function (worker) {
      return isWorkerEligibleForFeature(worker, featureKey);
    });
    const settings = options || {};

    if (settings.accessError) {
      return approved;
    }

    const enabledWorkerIds = new Set(
      (Array.isArray(accessRows) ? accessRows : [])
        .filter(function (row) {
          return row && row.feature_key === featureKey && row.enabled !== false;
        })
        .map(function (row) {
          return String(row.worker_id || "");
        })
        .filter(Boolean)
    );

    return approved.filter(function (worker) {
      return enabledWorkerIds.has(String(worker.id || ""));
    });
  }

  async function loadWorkersForFeature(client, featureKey, options) {
    if (!client || !FEATURE_KEYS.includes(featureKey)) {
      return {
        data: [],
        error: new Error("A valid employee feature and Supabase client are required.")
      };
    }

    const settings = options || {};
    const select = settings.select || "id,profile_id,display_name,worker_key,approved";
    const results = await Promise.all([
      client
        .from("work_order_labour_workers")
        .select(select)
        .eq("approved", true)
        .order("display_name", { ascending: true }),
      client
        .from("employee_feature_access")
        .select("worker_id,feature_key,enabled")
        .eq("feature_key", featureKey)
        .eq("enabled", true)
    ]);

    const workerResult = results[0] || { data: [], error: null };
    const accessResult = results[1] || { data: [], error: null };

    if (workerResult.error) {
      return {
        data: [],
        error: workerResult.error,
        accessError: accessResult.error || null
      };
    }

    if (accessResult.error) {
      console.warn("Employee feature access could not be loaded; using the approved employee directory.", accessResult.error);
    }

    return {
      data: filterWorkers(workerResult.data, accessResult.data, featureKey, {
        accessError: accessResult.error
      }),
      error: null,
      accessError: accessResult.error || null,
      fallback: Boolean(accessResult.error)
    };
  }

  global.JGCEmployeeFeatureAccess = Object.freeze({
    FEATURES: FEATURES,
    FEATURE_KEYS: FEATURE_KEYS,
    PORTAL_ACCOUNT_REQUIRED_FEATURES: PORTAL_ACCOUNT_REQUIRED_FEATURES,
    isWorkerEligibleForFeature: isWorkerEligibleForFeature,
    filterWorkers: filterWorkers,
    loadWorkersForFeature: loadWorkersForFeature
  });
})(window);
