(function () {
  'use strict';
  const TITLES = { toolbox_talk_reports: 'TOOLBOX TALK REPORT', daily_site_reports: 'DAILY SITE REPORT', incident_reports: 'INCIDENT / NEAR MISS REPORT', inspection_records: 'INSPECTION / PERMIT REPORT' };
  const textValue = value => {
    if (value === null || value === undefined || value === '') return 'Not entered';
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (Array.isArray(value)) return value.length ? value.map(textValue).join(' · ') : 'None recorded';
    if (typeof value === 'object' && (value.displayName || value.display_name)) return String(value.displayName || value.display_name) + (value.company ? ' (' + value.company + ')' : '');
    if (typeof value === 'object') return Object.entries(value).filter(([key]) => !/^(id|workerName|worker_name|email|signature|strokes)$/i.test(key)).map(([key, v]) => `${key.replace(/_/g, ' ')}: ${textValue(v)}`).join(' · ');
    return String(value);
  };
  async function create(payload, options = {}) {
    const asset = path => options.baseUrl ? new URL(path, options.baseUrl).href : path;
    const type = payload.source_type, record = payload.record;
    if (!record || typeof record !== 'object') throw new Error('The saved report is unavailable.');
    await loadJgcScriptOnce(asset('vendor/jspdf.umd.min.js'), 'jspdf');
    if (type === 'inspection_records' && /^JSA$/i.test(record.inspection_type)) {
      await loadJgcScriptOnce(asset('jsa-workers.js?v=2'),'JGCJsaWorkers');
      await loadJgcScriptOnce(asset('jsa-pdf.js?v=5'), 'JgcJsaPdf');
      return (await JgcJsaPdf.create(record,{acknowledgements:payload.acknowledgements || [], ...(options.baseUrl ? {logoUrl:asset('logo.webp')} : {})})).output('blob');
    }
    if (type === 'accident_reports' || type === 'employee_injury_reports') {
      await loadJgcScriptOnce(asset('safety-report-tools.js?v=1'), 'JGCSafetyReport');
      return (await JGCSafetyReport.pdf(record, type === 'accident_reports' ? 'accident' : 'injury')).output('blob');
    }
    if (!TITLES[type]) throw new Error('This report format is unavailable.');
    const doc = new jspdf.jsPDF({ unit: 'pt', format: 'letter', compress: true });
    const left = 40, width = 532, bottom = 735, green = [20, 65, 49], ink = [27, 43, 37];
    let y = 40;
    function header() {
      doc.setFillColor(...green); doc.rect(0, 0, 612, 95, 'F'); doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.text('JOHN GORDON CONSTRUCTION', left, 30);
      doc.setFontSize(18); doc.text(TITLES[type], left, 56);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
      doc.text('Saved report · ' + (record.report_date || record.inspection_date || ''), left, 78); y = 119;
    }
    function page() { doc.addPage(); header(); }
    function section(label, value) {
      if (y > bottom - 55) page();
      doc.setFillColor(237, 243, 239); doc.rect(left, y - 12, width, 22, 'F');
      doc.setTextColor(...green); doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.text(label, left + 8, y + 3); y += 28;
      doc.setTextColor(...ink); doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
      const lines = doc.splitTextToSize(textValue(value), width - 16);
      for (const line of lines) { if (y > bottom) page(); doc.setTextColor(...ink); doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.text(line, left + 8, y); y += 14; }
      y += 16;
    }
    header();
    section('Project / job', record.project || record.form_data?.job_context?.project || record.form_data?.job_context?.jobName);
    section('Completed by', record.worker_display_name || record.submitted_by_name || record.reported_by_name || record.presenter_name);
    if (type === 'inspection_records') {
      section('Form', record.inspection_type || record.title);
      for (const field of record.form_data?.fields || []) section(field.label || 'Form detail', field.value);
      for (const [index, row] of (record.form_data?.rows || []).entries()) section('Checklist item ' + (index + 1), row.cells || row);
    } else {
      const fields = type === 'toolbox_talk_reports' ? [['Talk', 'talk_title'], ['Location', 'location'], ['Presenter', 'presenter_name'], ['Crew', 'crew'], ['Discussion notes', 'discussion_notes'], ['Hazards discussed', 'hazards_discussed'], ['Corrective actions', 'corrective_actions']]
        : type === 'daily_site_reports' ? [['Weather', 'weather'], ['Crew', 'crew'], ['Work completed', 'work_completed'], ['Deliveries', 'deliveries'], ['Visitors', 'visitors'], ['Delays', 'delays'], ['Photo files', 'photos']]
          : [['Type', 'incident_type'], ['Severity', 'severity'], ['Time', 'incident_time'], ['Location', 'location'], ['People involved', 'people_involved'], ['Witnesses', 'witnesses'], ['Description', 'description'], ['Immediate action', 'immediate_action'], ['Injury details', 'injury_details'], ['Property damage', 'property_damage_details'], ['Environmental details', 'environmental_details'], ['Follow-up required', 'follow_up_required'], ['Follow-up notes', 'follow_up_notes'], ['Photo files', 'photos']];
      for (const [label, key] of fields) section(label, key === 'photos' && Array.isArray(record[key]) ? record[key].map(photo => photo.name || 'Photo') : record[key]);
    }
    const count = doc.getNumberOfPages();
    for (let i = 1; i <= count; i++) { doc.setPage(i); doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(82, 97, 89); doc.text('Job Board report · Reference ' + (record.id || ''), left, 766); doc.text('Page ' + i + ' of ' + count, 497, 766); }
    return doc.output('blob');
  }
  window.JGCJobBoardPdf = { create };
}());
