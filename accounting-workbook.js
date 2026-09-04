(function() {
  "use strict";

  const COLORS = {
    navy: "245783",
    blue: "5B9BD5",
    lightBlue: "D9EAF7",
    entryBlue: "DCEAF7",
    paleGreen: "E7F1DF",
    green: "DDEED7",
    grid: "D8E0E6",
    white: "FFFFFF",
    text: "1F2933",
    softGray: "F3F5F6",
    inputBlue: "D9EAF7",
    rateYellow: "FFF2CC",
    overtimeDark: "9C0006",
    overtimeRed: "C00000",
    overtimeLight: "FCE8E6",
    overtimeTotal: "F4CCCC",
    warningRed: "8F1D1D",
    warningBorder: "FF6B6B"
  };

  const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const DAY_LABELS = ["Sun", "Mon", "Tues", "Wed", "Thurs", "Fri", "Sat"];
  const WEEK_DAY_COLUMNS = ["C", "D", "E", "F", "G", "H", "I"];
  const OVERTIME_THRESHOLD_HOURS = 44;
  const LABOUR_BURDEN_MULTIPLIER = 1.4;
  const DEFAULT_STAT_HOURS = 8;

  function isoDate(value) {
    return String(value || "").slice(0, 10);
  }

  function utcDate(value) {
    const parts = isoDate(value).split("-").map(Number);
    return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], 12));
  }

  function excelDate(value) {
    const date = utcDate(value);
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  }

  function addDays(value, days) {
    const date = utcDate(value);
    date.setUTCDate(date.getUTCDate() + Number(days || 0));
    return date.toISOString().slice(0, 10);
  }

  function formatDate(value, options) {
    return new Intl.DateTimeFormat("en-CA", Object.assign({
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC"
    }, options || {})).format(utcDate(value));
  }

  function sheetDateName(value) {
    return new Intl.DateTimeFormat("en-CA", {
      month: "short",
      day: "numeric",
      timeZone: "UTC"
    }).format(utcDate(value));
  }

  function round(value) {
    return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
  }

  function safeNumber(value) {
    const number = Number(value || 0);
    return Number.isFinite(number) ? number : 0;
  }

  function employeeSortKey(value) {
    const parts = String(value || "").trim().split(/\s+/).filter(Boolean);
    const lastName = parts.pop() || "";
    return `${lastName}\u0000${parts.join(" ")}`;
  }

  function compareEmployeeNames(left, right) {
    const leftName = String(left || "");
    const rightName = String(right || "");
    return employeeSortKey(leftName).localeCompare(employeeSortKey(rightName), "en-CA", { sensitivity: "base", numeric: true })
      || leftName.localeCompare(rightName, "en-CA", { sensitivity: "base", numeric: true });
  }

  function sortedEmployees(employees) {
    return (employees || []).slice().sort((left, right) => compareEmployeeNames(left.name, right.name));
  }

  function fill(color) {
    return { type: "pattern", pattern: "solid", fgColor: { argb: color } };
  }

  function thinBorder(color) {
    const edge = { style: "thin", color: { argb: color || COLORS.grid } };
    return { top: edge, left: edge, bottom: edge, right: edge };
  }

  function applyTitle(cell) {
    cell.fill = fill(COLORS.navy);
    cell.font = { bold: true, color: { argb: COLORS.white }, size: 14 };
    cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
  }

  function applyHeader(cell) {
    cell.fill = fill(COLORS.blue);
    cell.font = { bold: true, color: { argb: COLORS.white } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  }

  function applyEmployeeHeader(cell) {
    cell.fill = fill(COLORS.lightBlue);
    cell.font = { bold: true, color: { argb: COLORS.text }, size: 12 };
    cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
  }

  function applyEntryCell(cell, numeric) {
    cell.fill = fill(COLORS.entryBlue);
    cell.border = thinBorder("E7EEF3");
    cell.alignment = { vertical: "middle", horizontal: numeric ? "right" : "left" };
    if (numeric) cell.numFmt = "0.00;-0.00;-";
  }

  function hasLongEntryForDay(entries, day) {
    return (entries || []).some((entry) => entry.dayOfWeek === day && safeNumber(entry.hours) > 12);
  }

  function applyLongHoursWarning(cell) {
    cell.fill = fill(COLORS.warningRed);
    cell.font = { bold: true, color: { argb: COLORS.white } };
    cell.border = thinBorder(COLORS.warningBorder);
  }

  function applyTotalCell(cell, bold) {
    cell.fill = fill(COLORS.paleGreen);
    cell.border = thinBorder("D2DFC9");
    cell.font = { bold: Boolean(bold), color: { argb: COLORS.text } };
    cell.alignment = { vertical: "middle", horizontal: "right" };
    cell.numFmt = "0.00;-0.00;-";
  }

  function applyRateCell(cell, bold) {
    cell.fill = fill(COLORS.rateYellow);
    cell.border = thinBorder("E6D69A");
    cell.font = { bold: Boolean(bold), color: { argb: COLORS.text } };
    cell.alignment = { vertical: "middle", horizontal: "right" };
    cell.numFmt = "0.00;-0.00;-";
  }

  function applyOvertimeHeader(cell) {
    cell.fill = fill(COLORS.overtimeRed);
    cell.font = { bold: true, color: { argb: COLORS.white } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = thinBorder(COLORS.overtimeDark);
  }

  function setFormula(cell, formula, result, numFmt) {
    cell.value = { formula, result: result instanceof Date ? result : safeNumber(result) };
    if (numFmt) cell.numFmt = numFmt;
  }

  function quoteSheetName(name) {
    return `'${String(name || "").replace(/'/g, "''")}'`;
  }

  function wrappedRowHeight(value, charactersPerLine, minimumHeight) {
    const width = Math.max(1, Number(charactersPerLine) || 1);
    const lines = String(value || "").split(/\r?\n/).reduce((count, part) => (
      count + Math.max(1, Math.ceil(part.length / width))
    ), 0);
    return Math.min(60, Math.max(Number(minimumHeight) || 18, lines * 15));
  }

  function base64ToUint8Array(value) {
    const binary = window.atob(String(value || ""));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }

  function getMerges(sheet) {
    const model = sheet && sheet.model;
    return model && Array.isArray(model.merges) ? model.merges.slice() : [];
  }

  function resetWorksheet(sheet) {
    getMerges(sheet).forEach((range) => {
      try {
        sheet.unMergeCells(range);
      } catch (_) {
        // A duplicate merge in a legacy workbook should not block a new export.
      }
    });
    const rowCount = sheet.rowCount || 0;
    if (rowCount) sheet.spliceRows(1, rowCount);
    sheet.columns = [];
    sheet.views = [];
    sheet.pageSetup = {};
    sheet.properties.defaultRowHeight = 15;
    sheet.showGridLines = true;
  }

  function findRate(rates, profileId, workDate) {
    const target = isoDate(workDate);
    return (rates || [])
      .filter((rate) => rate.profile_id === profileId && isoDate(rate.effective_from) <= target)
      .sort((a, b) => isoDate(b.effective_from).localeCompare(isoDate(a.effective_from)))[0] || null;
  }

  function employeeName(profileId, employees, fallback) {
    const employee = (employees || []).find((item) => item.profileId === profileId);
    return employee ? employee.name : (fallback || "Unmatched Employee");
  }

  function resolveJob(entry, jobsById) {
    const job = entry.jobId ? jobsById.get(entry.jobId) : null;
    return {
      id: job ? job.id : "",
      number: job ? String(job.job_number || "") : String(entry.sourceJobNumber || ""),
      name: job ? String(job.job_name || "") : String(entry.sourceJobName || "Special / No Job"),
      active: job ? Boolean(job.active) : null
    };
  }

  function isManualShopJob(job) {
    return !job.id && String(job.name || "").trim().toLowerCase().includes("shop");
  }

  function jobKey(entry, jobsById) {
    const job = resolveJob(entry, jobsById);
    if (isManualShopJob(job)) return "source:manual-shop";
    return job.id || `source:${job.number.toLowerCase()}|${job.name.toLowerCase()}`;
  }

  function jobLabel(entry, jobsById) {
    const job = resolveJob(entry, jobsById);
    if (isManualShopJob(job)) return "Shop";
    return [job.name, job.number].filter(Boolean).join(" ").trim() || "Special / No Job";
  }

  function rateKey(entry, rates) {
    const rate = findRate(rates, entry.profileId, entry.workDate);
    return rate ? (rate.id || rate.effective_from || rate.regular_rate) : "missing";
  }

  function jobRateKey(entry, jobsById, rates) {
    return `${jobKey(entry, jobsById)}|rate:${rateKey(entry, rates)}`;
  }

  function shiftKey(entry) {
    return entry && entry.shiftType === "night" ? "night" : "day";
  }

  function jobRateShiftKey(entry, jobsById, rates) {
    return `${jobRateKey(entry, jobsById, rates)}|shift:${shiftKey(entry)}`;
  }

  function employeeJobRateKey(entry, jobsById, rates) {
    return `${entry.profileId || entry.workerName}|${jobRateShiftKey(entry, jobsById, rates)}`;
  }

  function workEntriesForWeek(entries, start, end) {
    return (entries || []).filter((entry) => entry.entryType === "work"
      && isoDate(entry.workDate) >= start
      && isoDate(entry.workDate) <= end);
  }

  function groupBy(items, keyFunction) {
    const groups = new Map();
    items.forEach((item) => {
      const key = keyFunction(item);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    });
    return groups;
  }

  function dayTotals(entries) {
    return DAYS.map((day) => round(entries
      .filter((entry) => entry.dayOfWeek === day)
      .reduce((sum, entry) => sum + safeNumber(entry.hours), 0)));
  }

  function blockRate(profileId, rates, date) {
    const rate = findRate(rates, profileId, date);
    return rate ? safeNumber(rate.regular_rate) : 0;
  }

  function blockOvertimePremiumRate(profileId, rates, date) {
    const rate = findRate(rates, profileId, date);
    const premiumMultiplier = rate ? Math.max(0, safeNumber(rate.overtime_multiplier || 1.5) - 1) : 0;
    return rate ? round(safeNumber(rate.regular_rate) * premiumMultiplier) : 0;
  }

  function blockNightPremium(profileId, rates, date) {
    const rate = findRate(rates, profileId, date);
    return rate ? safeNumber(rate.night_premium) : 0;
  }

  function prepareWeekSheet(sheet, title) {
    resetWorksheet(sheet);
    sheet.columns = [
      { width: 42 }, { width: 3 },
      { width: 10 }, { width: 10 }, { width: 10 }, { width: 10 }, { width: 10 }, { width: 10 }, { width: 10 },
      { width: 12 }, { width: 10 }, { width: 14 }, { width: 14 }
    ];
    sheet.mergeCells("A1:M1");
    sheet.getCell("A1").value = title;
    applyTitle(sheet.getCell("A1"));
    sheet.getRow(1).height = wrappedRowHeight(title, 86, 24);
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    sheet.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };
    sheet.headerFooter = sheet.headerFooter || {};
    sheet.headerFooter.oddFooter = "Page &P of &N";
  }

  function buildWeekSheet(sheet, data, start, end, title) {
    prepareWeekSheet(sheet, title);
    const jobsById = new Map(data.jobs.map((job) => [job.id, job]));
    let row = 3;
    let workbookTotal = 0;
    const employeeRefs = {};
    const jobRowRefs = {};
    const employeeTotalRows = [];

    data.employees.forEach((employee) => {
      const workEntries = workEntriesForWeek(data.entries, start, end)
        .filter((entry) => entry.profileId === employee.profileId);
      const leaveEntries = data.entries.filter((entry) => entry.profileId === employee.profileId
        && entry.entryType !== "work" && isoDate(entry.workDate) >= start && isoDate(entry.workDate) <= end);
      const jobGroups = groupBy(workEntries, (entry) => jobRateShiftKey(entry, jobsById, data.rates));

      sheet.mergeCells(row, 1, row, 13);
      sheet.getCell(row, 1).value = employee.name;
      applyEmployeeHeader(sheet.getCell(row, 1));
      sheet.getRow(row).height = 22;
      row += 1;

      sheet.getCell(row, 1).value = "Job";
      applyHeader(sheet.getCell(row, 1));
      sheet.getCell(row, 2).fill = fill(COLORS.blue);
      for (let dayIndex = 0; dayIndex < DAY_LABELS.length; dayIndex += 1) {
        sheet.getCell(row, 3 + dayIndex).value = DAY_LABELS[dayIndex];
        applyHeader(sheet.getCell(row, 3 + dayIndex));
      }
      ["Total HRS", "Rate", "Gross", "Employee Total"].forEach((label, index) => {
        sheet.getCell(row, 10 + index).value = label;
        applyHeader(sheet.getCell(row, 10 + index));
      });
      const headerRow = row;
      row += 1;

      const firstJobRow = row;
      const sortedJobGroups = Array.from(jobGroups.values()).sort((left, right) => {
        const leftDate = left.map((item) => isoDate(item.workDate)).sort()[0] || "";
        const rightDate = right.map((item) => isoDate(item.workDate)).sort()[0] || "";
        return leftDate.localeCompare(rightDate)
          || jobLabel(left[0], jobsById).localeCompare(jobLabel(right[0], jobsById))
          || shiftKey(left[0]).localeCompare(shiftKey(right[0]));
      });
      const nightJobRows = [];

      if (!sortedJobGroups.length) sortedJobGroups.push([]);
      sortedJobGroups.forEach((jobEntries) => {
        const totals = dayTotals(jobEntries);
        const rowTotal = round(totals.reduce((sum, hours) => sum + hours, 0));
        const label = jobEntries.length
          ? `${jobLabel(jobEntries[0], jobsById)}${shiftKey(jobEntries[0]) === "night" ? " - Night" : ""}`
          : "No submitted work hours";
        sheet.mergeCells(row, 1, row, 2);
        sheet.getCell(row, 1).value = label;
        sheet.getCell(row, 1).border = thinBorder("E7EEF3");
        sheet.getCell(row, 1).alignment = { vertical: "middle", horizontal: "left", wrapText: true };
        sheet.getRow(row).height = wrappedRowHeight(label, 44, 18);
        if (jobEntries.length) {
          jobRowRefs[employeeJobRateKey(jobEntries[0], jobsById, data.rates)] = row;
          if (shiftKey(jobEntries[0]) === "night") nightJobRows.push(row);
        }
        totals.forEach((hours, index) => {
          const cell = sheet.getCell(row, 3 + index);
          cell.value = hours || null;
          applyEntryCell(cell, true);
          if (hasLongEntryForDay(jobEntries, DAYS[index])) applyLongHoursWarning(cell);
        });
        const rate = jobEntries.length ? blockRate(employee.profileId, data.rates, jobEntries[0].workDate) : blockRate(employee.profileId, data.rates, end);
        const gross = round(rowTotal * rate);
        setFormula(sheet.getCell(row, 10), `SUM(C${row}:I${row})`, rowTotal, "0.00;-0.00;-");
        applyTotalCell(sheet.getCell(row, 10), false);
        sheet.getCell(row, 11).value = rate;
        applyRateCell(sheet.getCell(row, 11), false);
        setFormula(sheet.getCell(row, 12), `J${row}*K${row}`, gross, "$#,##0.00;[Red]-$#,##0.00;-");
        applyTotalCell(sheet.getCell(row, 12), false);
        row += 1;
      });
      const lastJobRow = row - 1;

      sheet.mergeCells(row, 1, row, 9);
      sheet.getCell(row, 1).value = "Regular Total";
      sheet.getCell(row, 1).font = { bold: true };
      const regularHours = round(workEntries.reduce((sum, entry) => sum + safeNumber(entry.hours), 0));
      const regularRate = blockRate(employee.profileId, data.rates, end);
      const regularGross = round(workEntries.reduce((sum, entry) => {
        const rate = findRate(data.rates, employee.profileId, entry.workDate);
        return sum + safeNumber(entry.hours) * safeNumber(rate && rate.regular_rate);
      }, 0));
      setFormula(sheet.getCell(row, 10), `SUM(J${firstJobRow}:J${lastJobRow})`, regularHours, "0.00;-0.00;-");
      applyTotalCell(sheet.getCell(row, 10), true);
      sheet.getCell(row, 11).value = regularRate;
      applyRateCell(sheet.getCell(row, 11), true);
      setFormula(sheet.getCell(row, 12), `SUM(L${firstJobRow}:L${lastJobRow})`, regularGross, "$#,##0.00;[Red]-$#,##0.00;-");
      applyTotalCell(sheet.getCell(row, 12), true);
      const regularRow = row;
      row += 2;

      sheet.mergeCells(row, 1, row, 2);
      sheet.getCell(row, 1).value = "Overtime - Hours over 44";
      for (let column = 3; column <= 9; column += 1) applyEntryCell(sheet.getCell(row, column), true);
      const overtimeHours = round(Math.max(0, regularHours - OVERTIME_THRESHOLD_HOURS));
      const overtimeRate = blockOvertimePremiumRate(employee.profileId, data.rates, end);
      const overtimeGross = round(overtimeHours * overtimeRate);
      setFormula(sheet.getCell(row, 10), `MAX(0,J${regularRow}-${quoteSheetName("Pay Period")}!$B$16)`, overtimeHours, "0.00;-0.00;-");
      applyTotalCell(sheet.getCell(row, 10), false);
      sheet.getCell(row, 11).value = overtimeRate;
      applyRateCell(sheet.getCell(row, 11), false);
      setFormula(sheet.getCell(row, 12), `J${row}*K${row}`, overtimeGross, "$#,##0.00;[Red]-$#,##0.00;-");
      applyTotalCell(sheet.getCell(row, 12), false);
      const overtimeRow = row;
      row += 1;

      const nightEntries = workEntries.filter((entry) => entry.shiftType === "night");
      const nightTotals = dayTotals(nightEntries);
      const nightHours = round(nightTotals.reduce((sum, hours) => sum + hours, 0));
      const nightPremium = blockNightPremium(employee.profileId, data.rates, end);
      sheet.mergeCells(row, 1, row, 2);
      sheet.getCell(row, 1).value = "Other - Night Shift";
      nightTotals.forEach((hours, index) => {
        const cell = sheet.getCell(row, 3 + index);
        const dayColumn = WEEK_DAY_COLUMNS[index];
        const formula = nightJobRows.length
          ? `SUM(${nightJobRows.map((jobRow) => `${dayColumn}${jobRow}`).join(",")})`
          : "0";
        setFormula(cell, formula, hours, "0.00;-0.00;-");
        applyEntryCell(cell, true);
      });
      setFormula(sheet.getCell(row, 10), `SUM(C${row}:I${row})`, nightHours, "0.00;-0.00;-");
      applyTotalCell(sheet.getCell(row, 10), false);
      sheet.getCell(row, 11).value = nightPremium;
      applyRateCell(sheet.getCell(row, 11), false);
      setFormula(sheet.getCell(row, 12), `J${row}*K${row}`, round(nightHours * nightPremium), "$#,##0.00;[Red]-$#,##0.00;-");
      applyTotalCell(sheet.getCell(row, 12), false);
      const otherRow = row;

      const employeeTotal = round(regularGross + overtimeGross + nightHours * nightPremium);
      setFormula(sheet.getCell(row, 13), `SUM(L${regularRow},L${overtimeRow},L${otherRow})`, employeeTotal, "$#,##0.00;[Red]-$#,##0.00;-");
      applyTotalCell(sheet.getCell(row, 13), true);
      employeeRefs[employee.profileId] = {
        regularRow,
        overtimeRow,
        otherRow,
        regularHours,
        overtimeHours,
        overtimeRate,
        overtimeGross,
        nightHours
      };
      employeeTotalRows.push(row);
      workbookTotal = round(workbookTotal + employeeTotal);
      row += 1;

      if (leaveEntries.length) {
        sheet.mergeCells(row, 1, row, 13);
        const leaveText = leaveEntries.map((entry) => `${entry.dayOfWeek}: ${String(entry.entryType || "leave").replace(/_/g, " ")}`).join(" | ");
        sheet.getCell(row, 1).value = `Leave reference (not added to hours): ${leaveText}`;
        sheet.getCell(row, 1).font = { italic: true, color: { argb: "596A60" }, size: 9 };
        sheet.getCell(row, 1).fill = fill(COLORS.softGray);
        sheet.getCell(row, 1).alignment = { wrapText: true };
        sheet.getRow(row).height = wrappedRowHeight(sheet.getCell(row, 1).value, 110, 18);
        row += 1;
      }

      row += 2;
      sheet.getRow(headerRow).height = 28;
    });

    const totalCell = sheet.getCell(row, 13);
    setFormula(totalCell, employeeTotalRows.length ? employeeTotalRows.map((item) => `M${item}`).join("+") : "0", workbookTotal, "$#,##0.00;[Red]-$#,##0.00;-");
    totalCell.fill = fill(COLORS.navy);
    totalCell.font = { bold: true, color: { argb: COLORS.white }, size: 12 };
    totalCell.numFmt = "$#,##0.00;[Red]-$#,##0.00;-";
    totalCell.alignment = { horizontal: "right" };
    sheet.autoFilter = null;
    return { workbookTotal, employeeRefs, jobRowRefs, sheetName: sheet.name };
  }

  function prepareJobSheet(sheet) {
    resetWorksheet(sheet);
    sheet.columns = [
      { width: 32 }, { width: 12 }, { width: 10 }, { width: 10 }, { width: 10 }, { width: 10 }, { width: 10 }, { width: 10 }, { width: 10 },
      { width: 12 }, { width: 12 }, { width: 14 }, { width: 14 }
    ];
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    sheet.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };
    sheet.headerFooter = sheet.headerFooter || {};
    sheet.headerFooter.oddFooter = "Page &P of &N";
  }

  function buildJobSheet(sheet, data, start, end, weekWorkbook) {
    prepareJobSheet(sheet);
    const jobsById = new Map(data.jobs.map((job) => [job.id, job]));
    const workEntries = workEntriesForWeek(data.entries, start, end);
    const jobGroups = groupBy(workEntries, (entry) => jobKey(entry, jobsById));
    let row = 1;
    let workbookTotal = 0;
    const jobTotalRows = [];

    Array.from(jobGroups.values())
      .sort((left, right) => jobLabel(left[0], jobsById).localeCompare(jobLabel(right[0], jobsById)))
      .forEach((jobEntries) => {
        sheet.mergeCells(row, 1, row, 13);
        sheet.getCell(row, 1).value = jobLabel(jobEntries[0], jobsById);
        applyEmployeeHeader(sheet.getCell(row, 1));
        sheet.getRow(row).height = wrappedRowHeight(sheet.getCell(row, 1).value, 100, 22);
        row += 1;

        sheet.getCell(row, 1).value = formatDate(end);
        sheet.getCell(row, 1).font = { bold: true };
        DAY_LABELS.forEach((label, index) => {
          sheet.getCell(row, 2 + index).value = label;
          applyHeader(sheet.getCell(row, 2 + index));
        });
        ["Total", "Rate", "Gross", "Gross + Burden"].forEach((label, index) => {
          sheet.getCell(row, 9 + index).value = label;
          applyHeader(sheet.getCell(row, 9 + index));
        });
        sheet.getRow(row).height = 28;
        row += 1;

        const employeeGroups = groupBy(jobEntries, (entry) => employeeJobRateKey(entry, jobsById, data.rates));
        const firstEmployeeRow = row;
        Array.from(employeeGroups.values())
          .sort((left, right) => compareEmployeeNames(
            employeeName(left[0].profileId, data.employees, left[0].workerName),
            employeeName(right[0].profileId, data.employees, right[0].workerName)
          ) || shiftKey(left[0]).localeCompare(shiftKey(right[0])))
          .forEach((employeeEntries) => {
            const profileId = employeeEntries[0].profileId;
            const employeeDisplayName = employeeName(profileId, data.employees, employeeEntries[0].workerName);
            const isNightShift = shiftKey(employeeEntries[0]) === "night";
            const totals = dayTotals(employeeEntries);
            const totalHours = round(totals.reduce((sum, hours) => sum + hours, 0));
            const rate = blockRate(profileId, data.rates, employeeEntries[0].workDate);
            const sourceKey = employeeJobRateKey(employeeEntries[0], jobsById, data.rates);
            const sourceRow = weekWorkbook && weekWorkbook.jobRowRefs[sourceKey];
            if (!sourceRow) {
              throw new Error(`Could not link ${employeeName(profileId, data.employees, employeeEntries[0].workerName)} to ${weekWorkbook && weekWorkbook.sheetName}.`);
            }
            const gross = round(employeeEntries.reduce((sum, entry) => {
              const entryRate = findRate(data.rates, profileId, entry.workDate);
              return sum + safeNumber(entry.hours) * safeNumber(entryRate && entryRate.regular_rate);
            }, 0));
            sheet.getCell(row, 1).value = `${employeeDisplayName}${isNightShift ? " - Night" : ""}`;
            sheet.getCell(row, 1).alignment = { vertical: "middle", horizontal: "left", wrapText: true };
            sheet.getRow(row).height = wrappedRowHeight(sheet.getCell(row, 1).value, 31, 18);
            totals.forEach((hours, index) => {
              const cell = sheet.getCell(row, 2 + index);
              setFormula(cell, `${quoteSheetName(weekWorkbook.sheetName)}!${WEEK_DAY_COLUMNS[index]}${sourceRow}`, hours, "0.00;-0.00;-");
              cell.fill = fill(COLORS.paleGreen);
              cell.border = thinBorder("D2DFC9");
              cell.alignment = { vertical: "middle", horizontal: "right" };
              if (hasLongEntryForDay(employeeEntries, DAYS[index])) applyLongHoursWarning(cell);
            });
            setFormula(sheet.getCell(row, 9), `SUM(B${row}:H${row})`, totalHours, "0.00;-0.00;-");
            applyTotalCell(sheet.getCell(row, 9), false);
            setFormula(sheet.getCell(row, 10), `${quoteSheetName(weekWorkbook.sheetName)}!K${sourceRow}`, rate, "$#,##0.00;[Red]-$#,##0.00;-");
            applyRateCell(sheet.getCell(row, 10), false);
            setFormula(sheet.getCell(row, 11), `I${row}*J${row}`, gross, "$#,##0.00;[Red]-$#,##0.00;-");
            applyTotalCell(sheet.getCell(row, 11), false);
            setFormula(sheet.getCell(row, 12), `K${row}*${quoteSheetName("Pay Period")}!$B$17`, round(gross * LABOUR_BURDEN_MULTIPLIER), "$#,##0.00;[Red]-$#,##0.00;-");
            applyTotalCell(sheet.getCell(row, 12), false);
            row += 1;

            if (isNightShift) {
              const premiumRow = row;
              const premiumRate = blockNightPremium(profileId, data.rates, employeeEntries[0].workDate);
              const premiumGross = round(totalHours * premiumRate);
              const otherRow = weekWorkbook && weekWorkbook.employeeRefs[profileId] && weekWorkbook.employeeRefs[profileId].otherRow;
              if (!otherRow) {
                throw new Error(`Could not link ${employeeDisplayName}'s night premium to ${weekWorkbook && weekWorkbook.sheetName}.`);
              }
              const premiumLabel = `${employeeDisplayName} - Night Premium (${totalHours.toFixed(2)} hrs)`;
              sheet.getCell(premiumRow, 1).value = {
                formula: `="${employeeDisplayName.replace(/"/g, '""')} - Night Premium ("&TEXT(${quoteSheetName(weekWorkbook.sheetName)}!J${sourceRow},"0.00")&" hrs)"`,
                result: premiumLabel
              };
              sheet.getCell(premiumRow, 1).alignment = { vertical: "middle", horizontal: "left", wrapText: true };
              sheet.getRow(premiumRow).height = wrappedRowHeight(premiumLabel, 31, 18);
              setFormula(sheet.getCell(premiumRow, 10), `${quoteSheetName(weekWorkbook.sheetName)}!K${otherRow}`, premiumRate, "$#,##0.00;[Red]-$#,##0.00;-");
              applyRateCell(sheet.getCell(premiumRow, 10), false);
              setFormula(sheet.getCell(premiumRow, 11), `${quoteSheetName(weekWorkbook.sheetName)}!J${sourceRow}*J${premiumRow}`, premiumGross, "$#,##0.00;[Red]-$#,##0.00;-");
              applyTotalCell(sheet.getCell(premiumRow, 11), false);
              setFormula(sheet.getCell(premiumRow, 12), `K${premiumRow}*${quoteSheetName("Pay Period")}!$B$17`, round(premiumGross * LABOUR_BURDEN_MULTIPLIER), "$#,##0.00;[Red]-$#,##0.00;-");
              applyTotalCell(sheet.getCell(premiumRow, 12), false);
              row += 1;
            }
          });
        const lastEmployeeRow = row - 1;
        const jobGross = round(jobEntries.reduce((sum, entry) => {
          const rate = findRate(data.rates, entry.profileId, entry.workDate);
          const regularGross = safeNumber(entry.hours) * safeNumber(rate && rate.regular_rate);
          const premiumGross = shiftKey(entry) === "night"
            ? safeNumber(entry.hours) * safeNumber(rate && rate.night_premium)
            : 0;
          return sum + regularGross + premiumGross;
        }, 0));
        setFormula(sheet.getCell(row, 11), `SUM(K${firstEmployeeRow}:K${lastEmployeeRow})`, jobGross, "$#,##0.00;[Red]-$#,##0.00;-");
        applyTotalCell(sheet.getCell(row, 11), true);
        setFormula(sheet.getCell(row, 12), `K${row}*${quoteSheetName("Pay Period")}!$B$17`, round(jobGross * LABOUR_BURDEN_MULTIPLIER), "$#,##0.00;[Red]-$#,##0.00;-");
        applyTotalCell(sheet.getCell(row, 12), true);
        jobTotalRows.push(row);
        workbookTotal = round(workbookTotal + jobGross);
        row += 3;
      });

    const overtimeEmployees = data.employees
      .map((employee) => ({ employee, ref: weekWorkbook.employeeRefs[employee.profileId] }))
      .filter((item) => item.ref && safeNumber(item.ref.overtimeHours) > 0);

    if (overtimeEmployees.length) {
      sheet.mergeCells(row, 1, row, 12);
      sheet.getCell(row, 1).value = "Overtime hours to be allocated to a job";
      sheet.getCell(row, 1).fill = fill(COLORS.overtimeDark);
      sheet.getCell(row, 1).font = { bold: true, color: { argb: COLORS.white }, size: 12 };
      sheet.getCell(row, 1).alignment = { vertical: "middle", horizontal: "left", wrapText: true };
      sheet.getRow(row).height = 30;
      row += 1;

      const overtimeHeaders = [formatDate(end), ...DAY_LABELS, "Total", "Rate", "Gross", "Gross + Burden"];
      overtimeHeaders.forEach((label, index) => {
        sheet.getCell(row, index + 1).value = label;
        applyOvertimeHeader(sheet.getCell(row, index + 1));
      });
      sheet.getRow(row).height = 28;
      row += 1;

      const firstOvertimeRow = row;
      let overtimeTotal = 0;
      overtimeEmployees.forEach(({ employee, ref }) => {
        sheet.getCell(row, 1).value = employee.name;
        sheet.getCell(row, 1).fill = fill(COLORS.overtimeLight);
        sheet.getCell(row, 1).font = { color: { argb: COLORS.text } };
        sheet.getCell(row, 1).border = thinBorder("E6B8B7");
        sheet.getCell(row, 1).alignment = { vertical: "middle", horizontal: "left", wrapText: true };
        for (let column = 2; column <= 8; column += 1) {
          const cell = sheet.getCell(row, column);
          cell.fill = fill(COLORS.overtimeLight);
          cell.border = thinBorder("E6B8B7");
          cell.numFmt = "0.00;-0.00;-";
          cell.alignment = { vertical: "middle", horizontal: "right" };
        }
        setFormula(sheet.getCell(row, 9), `${quoteSheetName(weekWorkbook.sheetName)}!J${ref.overtimeRow}`, ref.overtimeHours, "0.00;-0.00;-");
        sheet.getCell(row, 9).fill = fill(COLORS.overtimeTotal);
        sheet.getCell(row, 9).border = thinBorder("E6B8B7");
        sheet.getCell(row, 9).alignment = { vertical: "middle", horizontal: "right" };
        setFormula(sheet.getCell(row, 10), `${quoteSheetName(weekWorkbook.sheetName)}!K${ref.overtimeRow}`, ref.overtimeRate, "0.00;-0.00;-");
        applyRateCell(sheet.getCell(row, 10), false);
        setFormula(sheet.getCell(row, 11), `I${row}*J${row}`, ref.overtimeGross, "$#,##0.00;[Red]-$#,##0.00;-");
        sheet.getCell(row, 11).fill = fill(COLORS.overtimeLight);
        sheet.getCell(row, 11).border = thinBorder("E6B8B7");
        sheet.getCell(row, 11).alignment = { vertical: "middle", horizontal: "right" };
        setFormula(sheet.getCell(row, 12), `K${row}*${quoteSheetName("Pay Period")}!$B$17`, round(ref.overtimeGross * LABOUR_BURDEN_MULTIPLIER), "$#,##0.00;[Red]-$#,##0.00;-");
        sheet.getCell(row, 12).fill = fill(COLORS.overtimeLight);
        sheet.getCell(row, 12).border = thinBorder("E6B8B7");
        sheet.getCell(row, 12).alignment = { vertical: "middle", horizontal: "right" };
        overtimeTotal = round(overtimeTotal + ref.overtimeGross);
        row += 1;
      });
      const lastOvertimeRow = row - 1;
      sheet.mergeCells(row, 1, row, 10);
      sheet.getCell(row, 1).value = "Overtime premium total";
      sheet.getCell(row, 1).fill = fill(COLORS.overtimeTotal);
      sheet.getCell(row, 1).font = { bold: true, color: { argb: COLORS.overtimeDark } };
      sheet.getCell(row, 1).alignment = { vertical: "middle", horizontal: "right" };
      setFormula(sheet.getCell(row, 11), `SUM(K${firstOvertimeRow}:K${lastOvertimeRow})`, overtimeTotal, "$#,##0.00;[Red]-$#,##0.00;-");
      sheet.getCell(row, 11).fill = fill(COLORS.overtimeTotal);
      sheet.getCell(row, 11).font = { bold: true, color: { argb: COLORS.overtimeDark } };
      sheet.getCell(row, 11).border = thinBorder("E6B8B7");
      sheet.getCell(row, 11).alignment = { vertical: "middle", horizontal: "right" };
      setFormula(sheet.getCell(row, 12), `K${row}*${quoteSheetName("Pay Period")}!$B$17`, round(overtimeTotal * LABOUR_BURDEN_MULTIPLIER), "$#,##0.00;[Red]-$#,##0.00;-");
      sheet.getCell(row, 12).fill = fill(COLORS.overtimeTotal);
      sheet.getCell(row, 12).font = { bold: true, color: { argb: COLORS.overtimeDark } };
      sheet.getCell(row, 12).border = thinBorder("E6B8B7");
      sheet.getCell(row, 12).alignment = { vertical: "middle", horizontal: "right" };
      jobTotalRows.push(row);
      workbookTotal = round(workbookTotal + overtimeTotal);
      row += 3;
    }

    const totalCell = sheet.getCell(row, 13);
    const totalFormula = jobTotalRows.length ? `SUM(${jobTotalRows.map((item) => `K${item}`).join(",")})` : "0";
    setFormula(totalCell, totalFormula, workbookTotal, "$#,##0.00;[Red]-$#,##0.00;-");
    totalCell.fill = fill(COLORS.navy);
    totalCell.font = { bold: true, color: { argb: COLORS.white }, size: 12 };
    return workbookTotal;
  }

  function employeeWeekTotals(data, employee, start, end) {
    const work = workEntriesForWeek(data.entries, start, end).filter((entry) => entry.profileId === employee.profileId);
    const regularHours = round(work.reduce((sum, entry) => sum + safeNumber(entry.hours), 0));
    const regularGross = round(work.reduce((sum, entry) => {
      const rate = findRate(data.rates, employee.profileId, entry.workDate);
      return sum + safeNumber(entry.hours) * safeNumber(rate && rate.regular_rate);
    }, 0));
    const nightHours = round(work.filter((entry) => entry.shiftType === "night")
      .reduce((sum, entry) => sum + safeNumber(entry.hours), 0));
    const nightGross = round(nightHours * blockNightPremium(employee.profileId, data.rates, end));
    const overtimeHours = round(Math.max(0, regularHours - OVERTIME_THRESHOLD_HOURS));
    const overtimeRate = blockOvertimePremiumRate(employee.profileId, data.rates, end);
    const overtimeGross = round(overtimeHours * overtimeRate);
    return { regularHours, regularGross, overtimeHours, overtimeRate, overtimeGross, nightHours, nightGross };
  }

  function buildSummarySheet(sheet, data, weekOneWorkbook, weekTwoWorkbook) {
    resetWorksheet(sheet);
    sheet.columns = [
      { width: 24 }, { width: 12 }, { width: 12 }, { width: 13 }, { width: 12 }, { width: 15 }, { width: 13 },
      { width: 18 }, { width: 13 }, { width: 15 }, { width: 10 }, { width: 10 }, { width: 15 }
    ];
    sheet.mergeCells("A2:M2");
    sheet.getCell("A2").value = `Two Weeks ended ${formatDate(data.weekTwoEnd, { month: "short", day: "numeric" })} paid ${formatDate(data.payDate, { month: "short", day: "numeric" })}`;
    applyTitle(sheet.getCell("A2"));
    sheet.getRow(2).height = 24;
    const headers = ["Employee", "Type", "Total Hrs", "Week 1 Hrs", "Rate", "Week 1 Gross", "Week 2 Hrs", "Week 2 Gross", "Stat Pay", "Gross", "Adjustment", "VP", "To Balance"];
    headers.forEach((header, index) => {
      sheet.getCell(4, index + 1).value = header;
      if (header) applyHeader(sheet.getCell(4, index + 1));
    });
    sheet.getRow(4).height = 30;

    let row = 5;
    const totals = { hours: 0, w1: 0, w1Gross: 0, w2: 0, w2Gross: 0, stat: 0, gross: 0, adjustment: 0, vp: 0, balance: 0 };
    data.employees.forEach((employee, employeeIndex) => {
      const weekOne = employeeWeekTotals(data, employee, data.weekOneStart, data.weekOneEnd);
      const weekTwo = employeeWeekTotals(data, employee, data.weekTwoStart, data.weekTwoEnd);
      const input = data.inputs[employee.profileId] || {};
      const regularRate = blockRate(employee.profileId, data.rates, data.weekTwoEnd);
      const overtimeRate = blockOvertimePremiumRate(employee.profileId, data.rates, data.weekTwoEnd);
      const nightPremium = blockNightPremium(employee.profileId, data.rates, data.weekTwoEnd);
      const statPay = input.statSelected ? round(safeNumber(input.statHours) * regularRate) : 0;
      const adjustment = safeNumber(input.adjustment);
      const vp = safeNumber(input.vacationPay);
      const employeeFill = ["EAF3FC", "D9F0F7", "FBE5D6", "DDF4DD", "F3D9EE", "E8E2F7"][employeeIndex % 6];
      const rowTypes = [
        { type: "Regular", ref: "regularRow", w1: weekOne.regularHours, rate: regularRate, w1Gross: weekOne.regularGross, w2: weekTwo.regularHours, w2Gross: weekTwo.regularGross, stat: statPay, adjustment, vp },
        { type: "Overtime premium", ref: "overtimeRow", w1: weekOne.overtimeHours, rate: overtimeRate, w1Gross: weekOne.overtimeGross, w2: weekTwo.overtimeHours, w2Gross: weekTwo.overtimeGross, stat: 0, adjustment: 0, vp: 0 },
        { type: "Night premium", ref: "otherRow", w1: weekOne.nightHours, rate: nightPremium, w1Gross: weekOne.nightGross, w2: weekTwo.nightHours, w2Gross: weekTwo.nightGross, stat: 0, adjustment: 0, vp: 0 }
      ];
      rowTypes.forEach((item) => {
        const countsAsWorkedHours = item.type === "Regular";
        const totalHours = round(item.w1 + item.w2);
        const gross = round(item.w1Gross + item.w2Gross + item.stat);
        const balance = round(gross + item.adjustment + item.vp);
        const weekOneRow = weekOneWorkbook.employeeRefs[employee.profileId][item.ref];
        const weekTwoRow = weekTwoWorkbook.employeeRefs[employee.profileId][item.ref];
        const weekOneSheet = quoteSheetName(weekOneWorkbook.sheetName);
        const weekTwoSheet = quoteSheetName(weekTwoWorkbook.sheetName);
        const values = [employee.name, item.type, null, null, null, null, null, null, item.stat, null, item.adjustment, item.vp, null];
        values.forEach((value, index) => {
          const cell = sheet.getCell(row, index + 1);
          cell.value = value;
          cell.fill = fill(employeeFill);
          cell.border = thinBorder("E6E6E6");
          if (index >= 2) cell.numFmt = index === 2 || index === 3 || index === 6 ? "0.00;-0.00;-" : "$#,##0.00;[Red]-$#,##0.00;-";
          if (index === 0) cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
        });
        setFormula(sheet.getCell(row, 4), `${weekOneSheet}!J${weekOneRow}`, item.w1, "0.00;-0.00;-");
        setFormula(sheet.getCell(row, 5), `${weekTwoSheet}!K${weekTwoRow}`, item.rate, "$#,##0.00;[Red]-$#,##0.00;-");
        applyRateCell(sheet.getCell(row, 5), false);
        setFormula(sheet.getCell(row, 6), `${weekOneSheet}!L${weekOneRow}`, item.w1Gross, "$#,##0.00;[Red]-$#,##0.00;-");
        setFormula(sheet.getCell(row, 7), `${weekTwoSheet}!J${weekTwoRow}`, item.w2, "0.00;-0.00;-");
        setFormula(sheet.getCell(row, 8), `${weekTwoSheet}!L${weekTwoRow}`, item.w2Gross, "$#,##0.00;[Red]-$#,##0.00;-");
        setFormula(sheet.getCell(row, 10), `F${row}+H${row}+I${row}`, gross, "$#,##0.00;[Red]-$#,##0.00;-");
        setFormula(sheet.getCell(row, 13), `J${row}+K${row}+L${row}`, balance, "$#,##0.00;[Red]-$#,##0.00;-");
        if (item.type === "Regular") {
          [9, 11, 12].forEach((column) => {
            sheet.getCell(row, column).fill = fill(COLORS.inputBlue);
            sheet.getCell(row, column).font = { color: { argb: "0000FF" } };
          });
        }
        if (countsAsWorkedHours) {
          setFormula(sheet.getCell(row, 3), `D${row}+G${row}`, totalHours, "0.00;-0.00;-");
          totals.hours += totalHours;
          totals.w1 += item.w1;
          totals.w2 += item.w2;
        }
        totals.w1Gross += item.w1Gross;
        totals.w2Gross += item.w2Gross;
        totals.stat += item.stat;
        totals.gross += gross;
        totals.adjustment += item.adjustment;
        totals.vp += item.vp;
        totals.balance += balance;
        row += 1;
      });
    });

    const lastDataRow = row - 1;
    const totalRow = row + 1;
    sheet.getCell(totalRow, 1).value = "TOTAL";
    const totalValues = {
      3: totals.hours, 4: totals.w1, 6: totals.w1Gross, 7: totals.w2, 8: totals.w2Gross,
      9: totals.stat, 10: totals.gross, 11: totals.adjustment, 12: totals.vp, 13: totals.balance
    };
    for (let column = 1; column <= 13; column += 1) {
      const cell = sheet.getCell(totalRow, column);
      cell.fill = fill(COLORS.navy);
      cell.font = { bold: true, color: { argb: COLORS.white } };
      if (Object.prototype.hasOwnProperty.call(totalValues, column)) {
        const numberFormat = [3, 4, 7].includes(column) ? "0.00;-0.00;-" : "$#,##0.00;[Red]-$#,##0.00;-";
        const columnLetter = cell.address.replace(/\d+$/g, "");
        const formula = [3, 4, 7].includes(column)
          ? `SUMIF($B$5:$B$${lastDataRow},"Regular",${columnLetter}5:${columnLetter}${lastDataRow})`
          : `SUM(${columnLetter}5:${columnLetter}${lastDataRow})`;
        setFormula(cell, formula, round(totalValues[column]), numberFormat);
      }
    }

    sheet.mergeCells(totalRow + 4, 1, totalRow + 4, 6);
    sheet.getCell(totalRow + 4, 1).value = "Blue cells = enter or update   |   Yellow cells = rates and settings   |   Green cells = calculated automatically";
    sheet.getCell(totalRow + 4, 1).font = { italic: true, color: { argb: "6B7280" } };
    sheet.getCell(totalRow + 4, 1).fill = fill(COLORS.inputBlue);
    sheet.getCell(totalRow + 4, 8).value = "Simple Settings";
    applyEmployeeHeader(sheet.getCell(totalRow + 4, 8));
    sheet.getCell(totalRow + 5, 8).value = "Overtime threshold";
    sheet.getCell(totalRow + 5, 8).alignment = { vertical: "middle", horizontal: "left", wrapText: true };
    setFormula(sheet.getCell(totalRow + 5, 9), `${quoteSheetName("Pay Period")}!$B$16`, OVERTIME_THRESHOLD_HOURS, "0.00");
    sheet.getCell(totalRow + 6, 8).value = "Labour multiplier";
    sheet.getCell(totalRow + 6, 8).alignment = { vertical: "middle", horizontal: "left", wrapText: true };
    setFormula(sheet.getCell(totalRow + 6, 9), `${quoteSheetName("Pay Period")}!$B$17`, LABOUR_BURDEN_MULTIPLIER, "0.00x");
    sheet.getCell(totalRow + 7, 8).value = "Stat hours default";
    sheet.getCell(totalRow + 7, 8).alignment = { vertical: "middle", horizontal: "left", wrapText: true };
    setFormula(sheet.getCell(totalRow + 7, 9), `${quoteSheetName("Pay Period")}!$B$18`, DEFAULT_STAT_HOURS, "0.00");
    [totalRow + 5, totalRow + 6, totalRow + 7].forEach((settingRow) => {
      sheet.getCell(settingRow, 9).fill = fill(COLORS.rateYellow);
      sheet.getCell(settingRow, 9).border = thinBorder("E6D69A");
    });
    sheet.getRow(totalRow + 4).height = 22;
    sheet.getRow(totalRow + 5).height = 22;
    sheet.getRow(totalRow + 6).height = 22;
    sheet.getRow(totalRow + 7).height = 22;
    sheet.views = [{ state: "frozen", ySplit: 4 }];
    sheet.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };
    return totals;
  }

  function buildPayPeriodSheet(sheet, data) {
    resetWorksheet(sheet);
    sheet.columns = [{ width: 27 }, { width: 42 }, { width: 18 }, { width: 18 }];
    sheet.mergeCells("A1:D1");
    sheet.getCell("A1").value = "Biweekly Pay Period";
    applyTitle(sheet.getCell("A1"));
    sheet.getCell("A3").value = "Pay date (selected in portal)";
    sheet.getCell("B3").value = excelDate(data.payDate);
    sheet.getCell("B3").numFmt = "mmm d, yyyy";
    sheet.getCell("B3").fill = fill(COLORS.paleGreen);
    sheet.getCell("A5").value = "Week 1 ending";
    setFormula(sheet.getCell("B5"), "B3-12", excelDate(data.weekOneEnd), "mmm d, yyyy");
    sheet.getCell("A6").value = "Week 2 ending";
    setFormula(sheet.getCell("B6"), "B3-5", excelDate(data.weekTwoEnd), "mmm d, yyyy");
    sheet.getCell("A8").value = "Next pay date";
    setFormula(sheet.getCell("B8"), "B3+14", excelDate(addDays(data.payDate, 14)), "mmm d, yyyy");
    ["A3", "A5", "A6", "A8"].forEach((address) => { sheet.getCell(address).font = { bold: true }; });
    ["B5", "B6", "B8"].forEach((address) => { sheet.getCell(address).fill = fill(COLORS.paleGreen); });
    sheet.mergeCells("A10:D11");
    sheet.getCell("A10").value = "This file is locked to the pay period selected in the JGC Portal. Export a different pay date from the Accounting page. Blue cells in the payroll sheets remain available for Accounting adjustments after download.";
    sheet.getCell("A10").fill = fill(COLORS.lightBlue);
    sheet.getCell("A10").font = { italic: true, color: { argb: COLORS.text } };
    sheet.getCell("A10").alignment = { wrapText: true, vertical: "middle" };
    sheet.getRow(10).height = 28;
    sheet.getRow(11).height = 28;
    sheet.getCell("A13").value = "Week 1 heading";
    sheet.getCell("B13").value = `Week ended ${formatDate(data.weekOneEnd, { month: "short", day: "numeric" })} paid ${formatDate(data.payDate, { month: "short", day: "numeric" })}`;
    sheet.getCell("A14").value = "Week 2 heading";
    sheet.getCell("B14").value = `Week ended ${formatDate(data.weekTwoEnd, { month: "short", day: "numeric" })} paid ${formatDate(data.payDate, { month: "short", day: "numeric" })}`;
    ["A13", "A14"].forEach((address) => { sheet.getCell(address).font = { bold: true }; });
    ["B13", "B14"].forEach((address) => {
      sheet.getCell(address).fill = fill(COLORS.paleGreen);
      sheet.getCell(address).alignment = { vertical: "middle", horizontal: "left", wrapText: true };
    });
    sheet.getRow(13).height = wrappedRowHeight(sheet.getCell("B13").value, 41, 18);
    sheet.getRow(14).height = wrappedRowHeight(sheet.getCell("B14").value, 41, 18);
    sheet.getCell("A16").value = "Overtime threshold";
    sheet.getCell("B16").value = OVERTIME_THRESHOLD_HOURS;
    sheet.getCell("B16").numFmt = "0.00";
    sheet.getCell("A17").value = "Labour burden multiplier";
    sheet.getCell("B17").value = LABOUR_BURDEN_MULTIPLIER;
    sheet.getCell("B17").numFmt = "0.00x";
    sheet.getCell("A18").value = "Stat hours default";
    sheet.getCell("B18").value = DEFAULT_STAT_HOURS;
    sheet.getCell("B18").numFmt = "0.00";
    ["A16", "A17", "A18"].forEach((address) => {
      sheet.getCell(address).font = { bold: true };
      sheet.getCell(address).alignment = { vertical: "middle", horizontal: "left", wrapText: true };
    });
    ["B16", "B17", "B18"].forEach((address) => {
      sheet.getCell(address).fill = fill(COLORS.rateYellow);
      sheet.getCell(address).border = thinBorder("E6D69A");
      sheet.getCell(address).font = { color: { argb: COLORS.text } };
      sheet.getCell(address).alignment = { vertical: "middle", horizontal: "right" };
    });
    sheet.mergeCells("A20:D21");
    sheet.getCell("A20").value = "Overtime is calculated weekly after 44 worked hours. Regular pay is already included on each job; the overtime row adds only the extra premium portion and is left for Accounting to allocate to a job.";
    sheet.getCell("A20").fill = fill(COLORS.overtimeLight);
    sheet.getCell("A20").font = { italic: true, color: { argb: COLORS.overtimeDark } };
    sheet.getCell("A20").alignment = { wrapText: true, vertical: "middle" };
    sheet.getRow(20).height = 30;
    sheet.getRow(21).height = 30;
    sheet.pageSetup = { orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 1, paperSize: 9 };
  }

  function buildSnapshot(data, totals) {
    return {
      version: 2,
      payDate: data.payDate,
      weekOneStart: data.weekOneStart,
      weekOneEnd: data.weekOneEnd,
      weekTwoStart: data.weekTwoStart,
      weekTwoEnd: data.weekTwoEnd,
      employees: data.employees.map((employee) => ({
        profileId: employee.profileId,
        name: employee.name,
        rate: findRate(data.rates, employee.profileId, data.weekTwoEnd),
        input: data.inputs[employee.profileId] || null
      })),
      sourceSubmissions: data.submissions.map((submission) => ({
        id: submission.id,
        sourceWeekId: submission.source_week_id,
        profileId: submission.profile_id,
        weekStart: submission.week_start,
        sourceRevision: submission.source_revision,
        sourceTotalHours: safeNumber(submission.source_total_hours),
        normalizedWorkHours: safeNumber(submission.normalized_work_hours)
      })),
      entryCount: data.entries.length,
      totals: Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, round(value)])),
      generatedAt: new Date().toISOString()
    };
  }

  async function build(options) {
    if (!window.ExcelJS) throw new Error("Excel support is not available.");
    if (!options || !options.templateBase64) throw new Error("The approved workbook template is missing.");
    const sourceData = options.data;
    if (!sourceData || !Array.isArray(sourceData.entries)) throw new Error("Accounting export data is missing.");
    const data = Object.assign({}, sourceData, { employees: sortedEmployees(sourceData.employees) });

    const workbook = new window.ExcelJS.Workbook();
    await workbook.xlsx.load(base64ToUint8Array(options.templateBase64));
    const requiredSheets = ["Aug 8", "Jobs Week 1", "Aug 15", "Jobs Week 2", "Summary", "Pay Period"];
    const missing = requiredSheets.filter((name) => !workbook.getWorksheet(name));
    if (missing.length) throw new Error("Workbook template is missing: " + missing.join(", "));

    ["Aug 8", "Jobs Week 1", "Aug 15", "Jobs Week 2", "Summary", "Stewart", "Pay Period"].forEach((name) => {
      const sheet = workbook.getWorksheet(name);
      if (sheet) workbook.removeWorksheet(sheet.id);
    });

    const weekOneSheet = workbook.addWorksheet(sheetDateName(data.weekOneEnd));
    const jobsWeekOneSheet = workbook.addWorksheet("Jobs Week 1");
    const weekTwoSheet = workbook.addWorksheet(sheetDateName(data.weekTwoEnd));
    const jobsWeekTwoSheet = workbook.addWorksheet("Jobs Week 2");
    const summarySheet = workbook.addWorksheet("Summary");
    const payPeriodSheet = workbook.addWorksheet("Pay Period");
    [weekOneSheet, jobsWeekOneSheet, weekTwoSheet, jobsWeekTwoSheet, summarySheet, payPeriodSheet]
      .forEach((sheet, index) => { sheet.orderNo = index; });

    const weekOneTitle = `Week ended ${formatDate(data.weekOneEnd, { month: "short", day: "numeric" })} paid ${formatDate(data.payDate, { month: "short", day: "numeric" })}`;
    const weekTwoTitle = `Week ended ${formatDate(data.weekTwoEnd, { month: "short", day: "numeric" })} paid ${formatDate(data.payDate, { month: "short", day: "numeric" })}`;
    const weekOneWorkbook = buildWeekSheet(weekOneSheet, data, data.weekOneStart, data.weekOneEnd, weekOneTitle);
    buildJobSheet(jobsWeekOneSheet, data, data.weekOneStart, data.weekOneEnd, weekOneWorkbook);
    const weekTwoWorkbook = buildWeekSheet(weekTwoSheet, data, data.weekTwoStart, data.weekTwoEnd, weekTwoTitle);
    buildJobSheet(jobsWeekTwoSheet, data, data.weekTwoStart, data.weekTwoEnd, weekTwoWorkbook);
    const totals = buildSummarySheet(summarySheet, data, weekOneWorkbook, weekTwoWorkbook);
    buildPayPeriodSheet(payPeriodSheet, data);

    workbook.creator = "JGC Portal Accounting";
    workbook.lastModifiedBy = options.exportedBy || "JGC Accounting";
    workbook.created = new Date();
    workbook.modified = new Date();
    workbook.calcProperties.fullCalcOnLoad = true;
    workbook.calcProperties.forceFullCalc = true;
    workbook.calcProperties.calcMode = "auto";

    const buffer = await workbook.xlsx.writeBuffer();
    const fileName = `JGC Payroll - ${formatDate(data.weekOneStart, { month: "short", day: "numeric" })} to ${formatDate(data.weekTwoEnd, { month: "short", day: "numeric", year: "numeric" })}.xlsx`;
    return { buffer, fileName, snapshot: buildSnapshot(data, totals) };
  }

  window.JgcAccountingWorkbook = {
    build,
    base64ToUint8Array
  };
})();
