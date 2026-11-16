(function () {
  "use strict";

  function jobIdentity(wo) {
    const number = String(wo.job_number || "").trim();
    const name = String(wo.job_name || "").trim();
    const id = String(wo.job_id || "").trim();
    return {
      key: number ? "number:" + number.toLowerCase() : id ? "id:" + id : name ? "name:" + name.toLowerCase() : "unassigned",
      label: [number, name].filter(Boolean).join(" - ") || "Job not specified"
    };
  }

  function group(rows) {
    const sorted = [...rows].sort((a, b) =>
      String(b.work_order_date || "").localeCompare(String(a.work_order_date || "")) ||
      String(b.wo_number || "").localeCompare(String(a.wo_number || ""), undefined, { numeric: true })
    );
    return window.JgcAdminHousekeeping.groupByMonth(sorted, (wo) => wo.work_order_date).map((month) => {
      const jobs = new Map();
      month.items.forEach((wo) => {
        const job = jobIdentity(wo);
        if (!jobs.has(job.key)) jobs.set(job.key, { ...job, items: [] });
        jobs.get(job.key).items.push(wo);
      });
      return { ...month, jobs: Array.from(jobs.values()).sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: "base" })) };
    });
  }

  window.JgcWorkOrderManagementGroups = Object.freeze({ group });
})();
