(function () {
  "use strict";
  function today(now = new Date()) {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
    const part = type => parts.find(value => value.type === type).value;
    return `${part("year")}-${part("month")}-${part("day")}`;
  }
  function isNotActivated(row, date = today()) {
    const workDate = row?.payload?.record?.inspection_date;
    if (row?.activated_at || row?.record_id || !/^\d{4}-\d{2}-\d{2}$/.test(workDate || "")) return false;
    const parsed = new Date(workDate + "T12:00:00Z");
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === workDate && workDate < date;
  }
  async function loadPrevious(client) {
    const access = await client.rpc("is_admin");
    if (access.error) throw access.error;
    if (access.data !== true) return [];
    const rows = [];
    for (let offset = 0; ; offset += 200) {
      const result = await client.from("jsa_preparations").select("*").is("activated_at", null).is("record_id", null)
        .order("updated_at", { ascending: false }).order("id").range(offset, offset + 199);
      if (result.error) throw result.error;
      rows.push(...(result.data || []));
      if ((result.data || []).length < 200) break;
    }
    return rows.filter(row => isNotActivated(row)).sort((a, b) => b.payload.record.inspection_date.localeCompare(a.payload.record.inspection_date));
  }
  // Refresh the date-derived lists when a page is left open across Toronto midnight or resumed later.
  function onDayChange(callback) {
    let date = today();
    const check = () => {
      const current = today();
      if (!document.hidden && current !== date) { date = current; callback(); }
    };
    window.addEventListener("focus", check);
    window.addEventListener("pageshow", check);
    document.addEventListener("visibilitychange", check);
    setInterval(check, 30000);
  }
  window.JgcJsaPreparationStatus = { today, isNotActivated, loadPrevious, onDayChange };
}());
