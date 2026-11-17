(function () {
  "use strict";
  const search = document.getElementById("jsaJobSearch");
  const results = document.getElementById("jsaJobSearchResults");
  const project = document.getElementById("jsaField1");
  if (!search || !results || !project) return;

  let jobs = [];
  let ready = false;
  let request = 0;
  const select = () => document.getElementById("jsaField1Select");

  function close() {
    results.hidden = true;
    results.classList.remove("open");
    search.setAttribute("aria-expanded", "false");
  }

  function render() {
    const words = search.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length || search.disabled || project.disabled || project.readOnly || select()?.disabled) return close();
    const matches = jobs.filter(job => words.every(word => getJgcJobSearchText(job).includes(word)));
    results.innerHTML = !ready || !select()
      ? '<div class="jgc-job-dropdown__empty">Loading jobs…</div>'
      : matches.length
        ? matches.map(job => getJgcJobOptionHtml(job, 'data-jsa-job-index="' + jobs.indexOf(job) + '"')).join("")
        : '<div class="jgc-job-dropdown__empty">No matching jobs. You can browse the list or enter a job manually.</div>';
    results.hidden = false;
    results.classList.add("open");
    search.setAttribute("aria-expanded", "true");
  }

  async function load() {
    const latest = ++request;
    const loaded = await getJgcProjectJobOptions();
    if (latest !== request) return;
    jobs = Array.isArray(loaded) ? loaded : [];
    ready = true;
    if (search.value.trim()) render();
  }

  search.addEventListener("input", render);
  search.addEventListener("focus", () => { if (search.value.trim()) render(); });
  search.addEventListener("keydown", event => {
    if (event.key === "Escape") { close(); return; }
    if ((event.key === "ArrowDown" || event.key === "Enter") && !results.hidden) {
      const first = results.querySelector("button[data-jsa-job-index]");
      if (!first) return;
      event.preventDefault();
      if (event.key === "Enter") first.click(); else first.focus();
    }
  });
  results.addEventListener("click", event => {
    const option = event.target.closest("button[data-jsa-job-index]");
    const picker = select();
    if (!option || !picker || picker.disabled || search.disabled || project.disabled || project.readOnly) return;
    const job = jobs[Number(option.dataset.jsaJobIndex)];
    if (!job) return;
    const value = getJgcProjectJobDisplay(job);
    if (!Array.from(picker.options).some(item => item.value === value)) return;
    picker.value = value;
    picker.dispatchEvent(new Event("change", { bubbles: true }));
    search.value = "";
    close();
    search.blur();
  });
  results.addEventListener("keydown", event => {
    if (event.key === "Escape") { event.preventDefault(); search.focus(); close(); return; }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const buttons = Array.from(results.querySelectorAll("button[data-jsa-job-index]"));
    const current = buttons.indexOf(document.activeElement);
    if (current < 0) return;
    event.preventDefault();
    buttons[Math.max(0, Math.min(buttons.length - 1, current + (event.key === "ArrowDown" ? 1 : -1)))].focus();
  });
  document.addEventListener("change", event => {
    if (event.target === select()) { search.value = ""; close(); }
  });
  document.addEventListener("click", event => {
    if (!search.parentElement.contains(event.target)) close();
  });
  const observer = new MutationObserver(() => { if (search.value.trim()) render(); });
  observer.observe(project.closest(".field"), { childList: true });
  function syncBoardLock() {
    search.parentElement.hidden = project.readOnly;
    document.querySelector(".jsa-job-browse-label").hidden = project.readOnly;
    if (project.readOnly || project.disabled) close();
  }
  new MutationObserver(syncBoardLock).observe(project, { attributes: true, attributeFilter: ["readonly", "disabled"] });
  syncBoardLock();
  window.addEventListener("jgc-jobs-saved", () => { void load(); });
  void load().catch(() => { ready = true; render(); });
}());
