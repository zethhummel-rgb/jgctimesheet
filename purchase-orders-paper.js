(function () {
  "use strict";
  window.JgcPaperPo = { initialize };

  function initialize(api) {
    const e = api.elements;
    const escape = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const paper = document.createElement("section");
    paper.className = "po-paper";
    paper.setAttribute("aria-label", "Purchase order document");
    paper.innerHTML = `
      <div class="po-paper-brand"><img src="logo.webp" alt="John Gordon Construction"></div>
      <h2 class="po-paper-banner">PURCHASE ORDER</h2>
      <div class="po-paper-number"><span>Purchase order number</span><div data-paper-number></div></div>
      <button type="button" class="po-paper-field" data-paper-edit="to"><span class="po-paper-label">To</span><span data-paper-to>Tap to enter company or supplier</span><small>Manual entry</small></button>
      <div class="po-paper-meta">
        <button type="button" class="po-paper-field" data-paper-edit="date"><span class="po-paper-label">Date of order</span><span data-paper-date></span></button>
        <button type="button" class="po-paper-field" data-paper-edit="job"><span class="po-paper-label">Job #</span><span data-paper-job-number>Choose or enter job</span></button>
      </div>
      <button type="button" class="po-paper-field" data-paper-edit="job"><span class="po-paper-label">Job name</span><span data-paper-job-name>Tap to choose or enter a job</span></button>
      <table class="po-paper-items" aria-label="Purchase order items"><thead><tr><th scope="col">Qty.</th><th scope="col">Description</th><th scope="col"><span class="jgc-sr-only">Actions</span></th></tr></thead><tbody data-paper-items></tbody></table>
      <div data-paper-add></div>
      <button type="button" class="po-paper-field po-paper-notes" data-paper-edit="notes"><span class="po-paper-label">Order notes</span><span data-paper-notes>Tap to add delivery or pickup notes</span></button>
      <div class="po-paper-author"><span class="po-paper-label">Authorized by</span><span data-paper-author></span></div>
      <p class="po-paper-instruction">Show this purchase order number on invoices, correspondence and packages.</p>
      <p id="poPaperSaveStatus" class="po-paper-save-status" role="status"></p>`;
    const sourceGrid = e.form.querySelector(".po-form-grid");
    sourceGrid.hidden = true;
    e.materialList.closest("section").hidden = true;
    e.form.prepend(paper);
    paper.querySelector("[data-paper-number]").append(e.numberDisplay);
    paper.querySelector("[data-paper-add]").append(e.addItemButton);
    e.addItemButton.textContent = "+ Add an item";
    e.formView.classList.add("po-paper-enabled");
    const receiptSection = e.receiptInput.closest("section");
    const receipts = document.createElement("details"); receipts.className = "po-paper-receipts";
    receipts.innerHTML = "<summary>Receipt photo</summary>";
    receiptSection.before(receipts); receipts.append(receiptSection);

    const dialog = document.createElement("dialog");
    dialog.id = "poPaperDialog"; dialog.className = "po-paper-dialog";
    dialog.setAttribute("aria-labelledby", "poPaperDialogTitle");
    dialog.innerHTML = `<div class="po-paper-dialog-head"><h2 id="poPaperDialogTitle"></h2><button type="button" class="jgc-button jgc-button--secondary" data-paper-cancel>Cancel</button></div><div data-paper-fields></div><p data-paper-error class="jgc-notice jgc-notice--danger" hidden role="alert"></p><button type="button" class="jgc-button po-paper-done" data-paper-done>Done</button>`;
    document.body.append(dialog);
    const manual = document.createElement("dialog");
    manual.id = "poPaperManualDialog"; manual.className = "po-paper-dialog";
    manual.setAttribute("aria-labelledby", "poPaperManualTitle");
    manual.innerHTML = `<div class="po-paper-dialog-head"><h2 id="poPaperManualTitle">Manual Entry</h2><button type="button" class="jgc-button jgc-button--secondary" data-manual-cancel>Cancel</button></div><label class="jgc-label" for="poPaperManualNumber">Job number (optional)</label><input id="poPaperManualNumber" class="jgc-input" maxlength="120"><label class="jgc-label" for="poPaperManualName">Job name</label><input id="poPaperManualName" class="jgc-input" maxlength="240" required><p data-manual-error class="jgc-notice jgc-notice--danger" role="alert" hidden>Enter a job name.</p><button type="button" class="jgc-button po-paper-done" data-manual-done>Done</button>`;
    document.body.append(manual);
    const fields = dialog.querySelector("[data-paper-fields]");
    const error = dialog.querySelector("[data-paper-error]");
    const saveStatus = paper.querySelector("#poPaperSaveStatus");
    let editing = "", rowId = "", trigger = null, jobSnapshot = null, movedPicker = null;
    let checkpoint = Promise.resolve(), generation = 0;

    function rows() { return [...e.materialList.querySelectorAll(".po-material-tile")]; }
    function findRow(id) { return rows().find(row => row.dataset.itemId === id); }
    function refresh() {
      const data = api.collect();
      paper.querySelector("[data-paper-to]").textContent = data.supplier_name || "Tap to enter company or supplier";
      paper.querySelector("[data-paper-date]").textContent = api.formatDate(data.order_date);
      paper.querySelector("[data-paper-job-number]").textContent = data.job_number || "Choose or enter job";
      paper.querySelector("[data-paper-job-name]").textContent = data.job_name || "Tap to choose or enter a job";
      paper.querySelector("[data-paper-notes]").textContent = data.notes || "Tap to add delivery or pickup notes";
      paper.querySelector("[data-paper-author]").textContent = api.author() || "";
      paper.querySelectorAll("[data-paper-edit]").forEach(button => {
        const input = { to: e.supplierName, date: e.orderDate, job: e.jobSearch, notes: e.notes }[button.dataset.paperEdit];
        button.disabled = input.disabled;
      });
      const visible = rows().filter(row => row.querySelector('[data-item-field="description"]').value.trim() || row.querySelector('[data-item-field="quantity_ordered"]').value.trim());
      paper.querySelector("[data-paper-items]").innerHTML = visible.length ? visible.map(row => {
        const description = row.querySelector('[data-item-field="description"]');
        const quantity = row.querySelector('[data-item-field="quantity_ordered"]');
        const id = escape(row.dataset.itemId), label = escape(description.value || "Item");
        return `<tr><td><button type="button" data-paper-item="${id}" aria-label="Edit quantity: ${label}"${quantity.disabled ? " disabled" : ""}>${escape(quantity.value || "—")}</button></td><td><button type="button" data-paper-item="${id}" aria-label="Edit item: ${label}"${description.disabled ? " disabled" : ""}>${label}</button></td><td><button type="button" class="po-paper-remove" data-paper-remove="${id}" aria-label="Remove item: ${label}"${description.disabled ? " disabled" : ""}>×</button></td></tr>`;
      }).join("") : '<tr><td>—</td><td colspan="2">No items added yet</td></tr>';
    }
    function markUnsaved() { saveStatus.textContent = "Unsaved changes"; refresh(); }
    function saveCheckpoint() {
      refresh();
      const version = generation, poId = e.id.value;
      saveStatus.textContent = "Saving on this device…";
      checkpoint = checkpoint.catch(() => {}).then(async () => {
        if (version !== generation || poId !== e.id.value) return;
        try {
          const saved = await api.checkpoint();
          if (version === generation && poId === e.id.value) saveStatus.textContent = saved ? "Saved on this device" : "Changes ready — press Save to keep them";
        } catch (failure) {
          if (version === generation) saveStatus.textContent = "Could not save on this device. Keep this page open and press Save Draft. " + (failure.message || "");
        }
      });
      return checkpoint;
    }
    function restorePicker() {
      if (movedPicker) { movedPicker.placeholder.replaceWith(e.jobPicker); movedPicker = null; }
      api.closeJobOptions();
    }
    function cancelEdit() {
      if (editing === "job" && jobSnapshot) {
        api.selectJob(jobSnapshot.job, { clearManual: false });
        e.manualJobNumber.value = jobSnapshot.number; e.manualJobName.value = jobSnapshot.name;
      }
      restorePicker(); editing = ""; jobSnapshot = null; refresh();
    }
    function closeEdit(commit) {
      if (!commit) cancelEdit(); else { restorePicker(); editing = ""; jobSnapshot = null; }
      if (dialog.open) dialog.close();
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    }
    function input(label, id, value, extra) {
      return `<label class="jgc-label" for="${id}">${label}</label><input class="jgc-input" id="${id}" value="${escape(value)}" ${extra || ""}>`;
    }
    function open(kind, id, source) {
      if (dialog.open || manual.open) return;
      const original = { to: e.supplierName, date: e.orderDate, job: e.jobSearch, notes: e.notes, item: e.addItemButton }[kind];
      const itemRow = id ? findRow(id) : null;
      if (kind === "item" ? (itemRow ? itemRow.querySelector('[data-item-field="description"]').disabled : e.addItemButton.disabled) : original.disabled) return;
      editing = kind; rowId = id || ""; trigger = source; error.hidden = true;
      dialog.querySelector("h2").textContent = { to: "To — Manual Entry", date: "Date of order", job: "Choose a job", item: id ? "Edit item" : "Add an item", notes: "Order notes" }[kind];
      if (kind === "to" || kind === "notes") {
        const value = kind === "to" ? e.supplierName.value : e.notes.value;
        fields.innerHTML = `<label class="jgc-label" for="poPaperText">${kind === "to" ? "Company / supplier and address" : "Delivery, pickup or order notes"}</label><textarea class="jgc-textarea" id="poPaperText" rows="4" maxlength="${kind === "to" ? 240 : 5000}" placeholder="${kind === "to" ? "Company or supplier name\nAddress (optional)" : "Enter notes"}">${escape(value)}</textarea>`;
      } else if (kind === "date") fields.innerHTML = input("Date of order", "poPaperDate", e.orderDate.value, 'type="date" required');
      else if (kind === "job") {
        jobSnapshot = { job: e.job.value, number: e.manualJobNumber.value, name: e.manualJobName.value };
        fields.innerHTML = '<label class="jgc-label" for="poJobSearch">Find a saved job</label><div data-paper-picker></div><button type="button" id="poPaperManualEntry" class="jgc-button jgc-button--secondary po-paper-manual">Manual Entry</button>';
        const placeholder = document.createComment("PO job picker");
        e.jobPicker.before(placeholder); movedPicker = { placeholder };
        fields.querySelector("[data-paper-picker]").append(e.jobPicker);
      } else if (kind === "item") {
        const value = name => itemRow?.querySelector(`[data-item-field="${name}"]`).value || "";
        fields.innerHTML = input("Qty.", "poPaperQty", value("quantity_ordered"), 'type="number" min="0" step="0.001" inputmode="decimal"') + `<label class="jgc-label" for="poPaperDescription">Description</label><textarea id="poPaperDescription" class="jgc-textarea" maxlength="1000" rows="4" required>${escape(value("description"))}</textarea>`;
      }
      dialog.showModal();
    }
    function done() {
      if (!api.isCurrent()) { closeEdit(false); return; }
      error.hidden = true;
      if (editing !== "item" && { to: e.supplierName, date: e.orderDate, job: e.jobSearch, notes: e.notes }[editing]?.disabled) { closeEdit(false); return; }
      if (editing === "to" || editing === "notes") {
        const value = fields.querySelector("textarea").value.trim();
        if (editing === "to" && !value) { error.textContent = "Enter the company or supplier name."; error.hidden = false; return; }
        const target = editing === "to" ? e.supplierName : e.notes;
        target.value = value; target.dispatchEvent(new Event("input", { bubbles: true }));
      } else if (editing === "date") {
        const date = fields.querySelector("input"); if (!date.reportValidity()) return;
        e.orderDate.value = date.value;
      } else if (editing === "job") {
        if (!e.job.value && !e.manualJobName.value.trim()) { error.textContent = "Choose a job or use Manual Entry."; error.hidden = false; return; }
      } else if (editing === "item") {
        const quantity = fields.querySelector("input"), description = fields.querySelector("textarea");
        if (!quantity.reportValidity() || !description.reportValidity() || !description.value.trim()) return;
        let row = rowId ? findRow(rowId) : rows().find(row => !row.querySelector('[data-item-field="description"]').value.trim() && !row.querySelector('[data-item-field="quantity_ordered"]').value.trim());
        if (rowId && (!row || row.querySelector('[data-item-field="description"]').disabled)) { closeEdit(false); return; }
        if (!row) { api.addRow(); row = rows().at(-1); }
        row.querySelector('[data-item-field="quantity_ordered"]').value = quantity.value;
        const target = row.querySelector('[data-item-field="description"]'); target.value = description.value.trim();
        target.dispatchEvent(new Event("input", { bubbles: true }));
      }
      closeEdit(true); void saveCheckpoint();
    }
    paper.addEventListener("click", event => {
      const section = event.target.closest("[data-paper-edit]"), item = event.target.closest("[data-paper-item]"), remove = event.target.closest("[data-paper-remove]");
      if (section && !section.disabled) open(section.dataset.paperEdit, "", section);
      if (item && !item.disabled) open("item", item.dataset.paperItem, item);
      if (remove && !remove.disabled) { findRow(remove.dataset.paperRemove)?.querySelector("[data-remove-item]").click(); void saveCheckpoint(); }
    });
    e.addItemButton.addEventListener("click", event => { event.stopImmediatePropagation(); open("item", "", e.addItemButton); }, true);
    dialog.querySelector("[data-paper-done]").onclick = done;
    dialog.querySelector("[data-paper-cancel]").onclick = () => closeEdit(false);
    dialog.addEventListener("cancel", event => { event.preventDefault(); closeEdit(false); });
    dialog.addEventListener("click", event => {
      if (event.target.id !== "poPaperManualEntry" || e.jobSearch.disabled) return;
      manual.querySelector("#poPaperManualNumber").value = e.manualJobNumber.value;
      manual.querySelector("#poPaperManualName").value = e.manualJobName.value;
      manual.querySelector("[data-manual-error]").hidden = true; manual.showModal();
    });
    manual.querySelector("[data-manual-cancel]").onclick = () => manual.close();
    manual.querySelector("[data-manual-done]").onclick = () => {
      const name = manual.querySelector("#poPaperManualName").value.trim();
      if (!name) { manual.querySelector("[data-manual-error]").hidden = false; return; }
      if (!api.isCurrent() || e.jobSearch.disabled) { manual.close(); closeEdit(false); return; }
      api.selectJob("", { clearManual: false });
      e.manualJobNumber.value = manual.querySelector("#poPaperManualNumber").value.trim();
      e.manualJobName.value = name;
      e.manualJobName.dispatchEvent(new Event("input", { bubbles: true }));
      manual.close(); done();
    };
    [dialog, manual].forEach(modal => modal.addEventListener("keydown", event => {
      if (event.key === "Enter" && event.target.tagName === "INPUT" && event.target !== e.jobSearch) { event.preventDefault(); modal.querySelector(modal === dialog ? "[data-paper-done]" : "[data-manual-done]").click(); }
    }));
    const observer = new MutationObserver(refresh);
    observer.observe(e.materialList, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled"] });
    e.form.addEventListener("input", markUnsaved);
    e.form.addEventListener("change", refresh);
    e.jobNotesList.addEventListener("click", () => { refresh(); if (!e.supplierName.disabled) void saveCheckpoint(); });
    refresh();
    return {
      refresh,
      reset() { generation++; if (manual.open) manual.close(); if (dialog.open) closeEdit(false); saveStatus.textContent = ""; refresh(); },
      settled: () => checkpoint,
      locked() { if (dialog.open) closeEdit(false); if (manual.open) manual.close(); refresh(); }
    };
  }
}());
