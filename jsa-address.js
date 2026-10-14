(function () {
  "use strict";
  const project = document.getElementById("jsaField1"), address = document.getElementById("jsaField2");
  if (!project || !address) return;
  let restoring = false, lastAutomaticAddress = null;
  window.JgcJsaAddress = { setRestoring(value) { restoring = Boolean(value); } };
  async function fillAddress(force = false) {
    if (restoring || address.disabled || typeof getJgcProjectJobOptions !== "function") return;
    const selected = project.value;
    const jobs = await getJgcProjectJobOptions();
    if (restoring || address.disabled || selected !== project.value) return;
    const job = jobs.find(item => getJgcProjectJobDisplay(item) === selected);
    if (job && (force || !address.value.trim() || address.value === lastAutomaticAddress)) {
      address.value = String(job.address || "").trim();
      lastAutomaticAddress = address.value;
      address.dispatchEvent(new Event("change", { bubbles: true }));
    } else if (!job && force && address.value === lastAutomaticAddress) {
      address.value = ""; lastAutomaticAddress = null;
      address.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }
  address.addEventListener("input", () => { lastAutomaticAddress = null; });
  project.addEventListener("change", () => { void fillAddress().catch(() => {}); });
  document.addEventListener("change", event => {
    if (event.target.id === "jsaField1Select") void fillAddress(true).catch(() => {});
  });
  if (project.value.trim()) void fillAddress().catch(() => {});
}());
