(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const panel = $('jsaCopyPanel'), source = $('jsaCopySource'), workDate = $('jsaCopyDate');
  const project = $('jsaField1'), button = $('jsaCopyApply'), refresh = $('jsaCopyRefresh');
  const params = new URLSearchParams(location.search);
  const sourceId = params.get('copy');
  let records = [], loaded = false, loading = false, applying = false, restoring = false, saved = false;
  const text = value => String(value ?? '').trim();
  const normalized = value => text(value).toLowerCase().replace(/\s+/g, ' ');
  const fieldValue = (record, label) => text(record.form_data?.fields?.find(field => field.label === label)?.value);
  const projectName = record => fieldValue(record, 'Project / Job') || text(record.form_data?.job_context?.project)
    || [record.form_data?.job_context?.jobNumber, record.form_data?.job_context?.jobName].filter(Boolean).join(' - ');
  function jobKey(value, context = {}) {
    const number = text(context.jobNumber || context.job_number) || (text(value).match(/^(\d+)(?:\s*[-–—]|$)/) || [])[1];
    return number ? 'number:' + normalized(number) : 'name:' + normalized(value);
  }
  const sourceKey = record => jobKey(projectName(record), record.form_data?.job_context);
  const isJsa = record => normalized(record?.inspection_type) === 'jsa' && Array.isArray(record.form_data?.fields) && Array.isArray(record.form_data?.rows);
  function fresh() {
    const query = new URLSearchParams(location.search);
    return !saved && !query.has('record') && !query.has('prepared') && !jsaPostSaveRecord && !jsaWorkerModel;
  }
  const saveBusy = () => jsaWorkerBusy || window.JgcPreparedJsa?.isBusy;
  function sync() {
    panel.hidden = !fresh();
    button.disabled = loading || applying || saveBusy() || !fresh() || !source.value;
    refresh.disabled = loading || applying || saveBusy();
    workDate.disabled = applying || saveBusy();
  }
  window.JgcJsaCopy = { sync, get isBusy() { return applying; }, markSaved() { saved = true; sync(); } };
  function status(message) { $('jsaCopyStatus').textContent = message; }
  function render(preselect = '') {
    const selected = preselect || source.value;
    const matches = project.value.trim() ? records.filter(record => sourceKey(record) === jobKey(project.value)) : [];
    source.replaceChildren(new Option(!project.value.trim() ? 'Select a job above first' : matches.length ? 'Choose a previous JSA' : 'No previous JSAs for this job', ''));
    for (const record of matches) {
      const task = text(record.form_data.rows[0]?.cells?.[0]);
      source.add(new Option([record.inspection_date || 'Undated', record.worker_display_name, task].filter(Boolean).join(' · '), record.id));
    }
    source.value = matches.some(record => record.id === selected) ? selected : '';
    source.disabled = loading || !matches.length;
    sync();
  }
  async function readSources() {
    const rows = [];
    for (let offset = 0; ; offset += 200) {
      const result = await inspectionSupabaseClient.from('inspection_records')
        .select('id,inspection_type,inspection_date,worker_display_name,form_data')
        .ilike('inspection_type', 'jsa').order('inspection_date', { ascending: false }).order('id')
        .range(offset, offset + 199);
      if (result.error) throw result.error;
      const batch = result.data || [];
      rows.push(...batch.filter(isJsa));
      if (batch.length < 200) break;
    }
    return rows;
  }
  async function load() {
    if (loading || !fresh()) return;
    loading = true; source.disabled = true; sync(); status('Loading previous JSAs…');
    try {
      if (!navigator.onLine) throw new Error('Connect to the internet to load previous JSAs.');
      if (window.prepareJgcJobBoardForm && !(await window.prepareJgcJobBoardForm())) throw new Error('Sign in to this Job Board before loading previous JSAs.');
      records = await readSources(); loaded = true;
      status('Choose a previous JSA and the new work date. Nothing is saved until you save the new JSA.');
    } catch (error) { status('Could not load previous JSAs. ' + (error.message || 'Try again.')); }
    finally { loading = false; render(); }
  }
  function hasEntries() {
    return [...document.querySelectorAll('#tableBody textarea')].some(input => input.value.trim())
      || selectedCrewMembers.size || manualCrewMembers.size || $('jsaSiteLocation').value.trim()
      || $('jsaField5').value.trim() || document.querySelector('.checklist input:checked');
  }
  // Copy form content only. Never restore source IDs, author, signatures, workflow,
  // acknowledgement requests, board attachment IDs or offline submission tokens.
  function copyContent(record, date) {
    const conditions = window.JgcPreparedJsa.conditionFields(record);
    let conditionIndex = 0;
    const fields = [...document.querySelectorAll('.grid input, .checklist input')]
      .filter(input => input.dataset.inspectionSkip !== 'true')
      .map(input => {
        const label = getFieldLabel(input);
        let value = input.type === 'checkbox' ? conditions[conditionIndex++].value : fieldValue(record, label);
        if (input.id === 'jsaField1') value = project.value || projectName(record);
        if (input.id === 'jsaField2' && !value) value = fieldValue(record, 'Location');
        if (input.id === 'jsaField3') value = date;
        if (input.id === 'jsaField4') value = getCurrentWorker().display || '';
        if (input.id === 'jsaField5') value = '';
        return { label, value };
      });
    const rows = record.form_data.rows.filter(row => Array.isArray(row.cells)).map(row => ({ table: 1, cells: row.cells.slice(0, 3).map(value => String(value ?? '')) }));
    return { record: { inspection_date: date, form_data: { fields, rows } }, crew: [], manual: [] };
  }
  async function apply() {
    if (loading || applying || saveBusy() || !fresh()) return;
    const record = records.find(row => row.id === source.value);
    const date = workDate.value;
    if (!record || sourceKey(record) !== jobKey(project.value)) return status('Choose a previous JSA for this job.');
    workDate.min = JGCJsaWorkers.today();
    if (!date || !workDate.checkValidity()) { status('Choose today or a future work date.'); workDate.reportValidity(); return; }
    if (hasEntries() && !confirm('Replace the entries in this new JSA with the selected previous JSA? The original JSA will not change.')) return;
    applying = true; sync();
    try {
      if (window.prepareJgcJobBoardForm && !(await window.prepareJgcJobBoardForm())) throw new Error('Return to the Job Board and sign in before copying this JSA.');
      await window.jsaCrewReady;
      if (!fresh() || saveBusy()) throw new Error('This JSA is being saved or has already been saved. Start a new JSA to copy another day.');
      if (sourceKey(record) !== jobKey(project.value)) throw new Error('The job changed. Choose a previous JSA for this job.');
      restoring = true;
      window.JgcPreparedJsa.restore(copyContent(record, date));
      $('jsaField3').value = date;
      $('jsaField3').dispatchEvent(new Event('change', { bubbles: true }));
      $('manualCrewInput').value = ''; $('manualCrewCompany').value = '';
      status('Copied from ' + record.inspection_date + ' for ' + date + '. Review the tasks and site conditions, then choose the workers for that day and save. The original JSA is unchanged.');
      $('jsaField3').focus();
    } catch (error) { status(error.message || 'Could not copy this JSA. Your entries are still here.'); }
    finally { restoring = false; applying = false; sync(); }
  }
  source.addEventListener('change', sync);
  panel.addEventListener('toggle', () => { if (panel.open && !loaded && !loading) void load(); });
  project.addEventListener('change', () => { if (!restoring) render(); });
  project.addEventListener('input', () => { if (!restoring) render(); });
  refresh.onclick = () => { void load(); };
  button.onclick = () => { void apply(); };
  workDate.value = JGCJsaWorkers.today(); workDate.min = JGCJsaWorkers.today();
  sync();
  if (!sourceId || !fresh()) return;
  // A history shortcut selects the source; the user still chooses the new date
  // and explicitly copies before the existing save/sign-off flow can be used.
  loading = true; panel.open = true; sync(); status('Opening previous JSA…');
  (async () => {
    if (window.prepareJgcJobBoardForm && !(await window.prepareJgcJobBoardForm())) throw new Error('Sign in to this Job Board before copying a JSA.');
    const result = await inspectionSupabaseClient.from('inspection_records')
      .select('id,inspection_type,inspection_date,worker_display_name,form_data').eq('id', sourceId).single();
    if (result.error) throw result.error;
    const record = result.data;
    if (!isJsa(record) || !projectName(record)) throw new Error('This JSA is unavailable or has no saved job details.');
    if (window.JGCJobBoardContext?.active && sourceKey(record) !== jobKey(project.value)) throw new Error('This JSA belongs to a different job.');
    if (!fresh() || saveBusy()) return;
    if (!project.value.trim()) {
      project.value = projectName(record);
      project.dispatchEvent(new Event('change', { bubbles: true }));
      const picker = $('jsaField1Select');
      if (picker) { picker.value = [...picker.options].some(option => option.value === project.value) ? project.value : '__manual__'; project.hidden = picker.value !== '__manual__'; }
    }
    records = [record]; loaded = true;
    status('Choose the new work date, then copy this JSA. The original and its signatures will stay unchanged.');
  })().catch(error => { status('Could not open the previous JSA. ' + (error.message || 'Try again.')); })
    .finally(() => { loading = false; render(sourceId); });
}());
