(function () {
  "use strict";
  const W = window.JGCWriteUps;
  const $ = id => document.getElementById(id);
  const client = createJgcSupabaseClient();
  let rows = [], current = null, userId = "";

  const status = text => { $("myWriteupsStatus").textContent = text; };

  function renderList() {
    $("myWriteupsList").hidden = false;
    $("myWriteupDetail").hidden = true;
    $("myWriteupsList").innerHTML = rows.map(row => `<article class="writeup-card">
      <div><h2>${W.escape((row.categories || []).map(W.label).join(", "))}</h2><small>Incident ${W.escape(W.formatDate(row.incident_date))}</small></div>
      <span class="writeup-status" data-status="${W.escape(row.status)}">${W.escape(row.status === "sent" ? "Needs your acknowledgment" : W.STATUS[row.status] || row.status)}</span>
      <button type="button" class="writeup-btn writeup-btn--secondary" data-open="${W.escape(row.id)}">Open</button></article>`).join("");
    const waiting = rows.filter(r => r.status === "sent").length;
    status(rows.length ? `${rows.length} write-up${rows.length === 1 ? "" : "s"}${waiting ? ` · ${waiting} waiting for your acknowledgment` : ""}.` : "You have no write-ups.");
  }

  async function loadList() {
    const result = await client.from("employee_writeups").select("*").eq("employee_profile_id", userId).order("incident_date", { ascending: false }).order("id");
    if (result.error) throw result.error;
    rows = result.data;
  }

  async function openDetail(id, message) {
    $("myWriteupsList").hidden = true;
    $("myWriteupDetail").hidden = false;
    $("myWriteupBody").innerHTML = "<p>Loading…</p>";
    $("myWriteupAck").hidden = true;
    $("myWriteupStatus").textContent = message || "";
    const record = await W.load(client, id);
    if (!record) { $("myWriteupBody").innerHTML = "<p>This write-up could not be found.</p>"; return; }
    current = record;
    history.replaceState(null, "", "employee-writeups.html?id=" + encodeURIComponent(id));
    $("myWriteupBody").innerHTML = W.reportHtml(record);
    const needsAck = record.writeup.status === "sent" && !record.acknowledgement;
    $("myWriteupAck").hidden = !needsAck;
    $("myWriteupAck").querySelector(".writeup-ack-statement").textContent = W.ACK_STATEMENT;
    $("myWriteupComment").value = "";
    $("myWriteupAckError").hidden = true;
    $("myWriteupTitle").focus();
  }

  async function notifyAdmins(record) {
    try {
      const admins = await getJgcAdminNotificationRecipients(client);
      await createJgcPortalNotifications(client, "employee_writeup", admins, {
        title: "Write-up acknowledged",
        message: `${record.writeup.employee_name} acknowledged a write-up (version ${record.version.version}).`,
        link_url: "employee-writeups-admin.html?id=" + encodeURIComponent(record.writeup.id),
        source_table: "employee_writeups",
        source_id: record.writeup.id,
        dedupe_key_prefix: `employee_writeup_ack:${record.writeup.id}:v${record.version.version}`
      });
    } catch (error) { console.warn("Admins could not be notified of the acknowledgment.", error); }
  }

  $("myWriteupSign").addEventListener("click", () => {
    if (!current) return;
    const record = current;
    const worker = getCurrentWorkerRecord();
    JGCSafetySignature.open({
      recordLabel: "Write-up acknowledgment — received and reviewed, not necessarily agreed",
      attendeeName: worker.display || record.writeup.employee_name,
      onSubmit: async value => {
        const result = await client.rpc("acknowledge_employee_writeup", {
          p_id: record.writeup.id, p_version: record.version.version, p_printed_name: value.printedName,
          p_signature: value.strokes, p_comment: $("myWriteupComment").value.trim(), p_user_agent: navigator.userAgent
        });
        if (result.error) return { ok: false, message: result.error.code === "40001" ? "This write-up was updated. Reopen it to review the latest version." : result.error.message };
        if (result.data.notify) await notifyAdmins(record);
        return { ok: true };
      },
      onClose: async result => {
        if (!result) return;
        await openDetail(record.writeup.id, "Thank you. Your acknowledgment was recorded.");
        loadList().catch(() => {});
      }
    });
  });

  $("myWriteupDownload").addEventListener("click", async () => {
    if (!current) return;
    $("myWriteupDownload").disabled = true;
    try { await W.download(current); } catch (error) { $("myWriteupStatus").textContent = error.message; } finally { $("myWriteupDownload").disabled = false; }
  });
  $("myWriteupBack").addEventListener("click", () => { history.replaceState(null, "", "employee-writeups.html"); current = null; renderList(); });
  $("myWriteupsList").addEventListener("click", event => { const open = event.target.closest("[data-open]"); if (open) openDetail(open.dataset.open).catch(error => status(error.message)); });

  (async () => {
    const identity = await client.auth.getUser();
    if (identity.error || !identity.data?.user) { status("Sign in to see your write-ups."); return; }
    userId = identity.data.user.id;
    await loadList();
    renderList();
    const id = new URLSearchParams(location.search).get("id");
    if (id) await openDetail(id);
  })().catch(error => status("Your write-ups could not load. " + (error.message || "")));
}());
