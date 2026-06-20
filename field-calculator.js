(function() {
  "use strict";

  const PREF_KEY = "jgc_field_calculator_preferences";
  const HISTORY_KEY = "jgc_field_calculator_history";
  const EngineApi = window.JgcCalculatorEngine;
  const Fn = window.JgcCalculatorFunctions;

  const KEY_ROWS = [
    [
      { primary: "Pitch", secondary: "Slope", action: "pitch", secondaryAction: "slope", type: "function" },
      { primary: "Rise", secondary: "R/Wall", action: "rise", secondaryAction: "rake-wall", type: "function" },
      { primary: "Run", secondary: "Polygon", action: "run", secondaryAction: "polygon", type: "function" },
      { primary: "Diag", secondary: "Roof", action: "diag", secondaryAction: "roof-summary", type: "function" },
      { primary: "Hip/V", secondary: "Ir/Pitch", action: "hip", secondaryAction: "irregular-pitch", type: "function" }
    ],
    [
      { spacer: true },
      { primary: "Stair", secondary: "Riser Limit", action: "stair", secondaryAction: "riser-limit", type: "function" },
      { primary: "Arc", secondary: "Radius", action: "arc", secondaryAction: "arc-radius", type: "function" },
      { primary: "Circ", secondary: "Column/Cone", action: "circle", secondaryAction: "column-cone", type: "function" },
      { spacer: true }
    ],
    [
      { primary: "m", action: "unit:m", type: "function" },
      { primary: "Length", action: "register:length", type: "function" },
      { primary: "Width", action: "register:width", type: "function" },
      { primary: "Height", action: "register:height", type: "function" },
      { primary: "%", secondary: "x\u00b2", action: "percent", secondaryAction: "square", type: "operator" }
    ],
    [
      { primary: "Yds", action: "unit:yd", type: "function" },
      { primary: "Feet", action: "unit:ft", type: "function" },
      { primary: "Inch", action: "unit:in", type: "function" },
      { primary: "/", action: "fraction", type: "operator" },
      { primary: "Clear", secondary: "\u221ax", action: "clear", secondaryAction: "sqrt", type: "danger" }
    ],
    [
      { primary: "Conv", action: "conv", type: "convert" },
      { primary: "7", secondary: "cm", action: "digit:7", secondaryAction: "unit:cm", type: "number" },
      { primary: "8", secondary: "Bd ft", action: "digit:8", secondaryAction: "board-feet", type: "number" },
      { primary: "9", secondary: "mm", action: "digit:9", secondaryAction: "unit:mm", type: "number" },
      { primary: "\u00f7", secondary: "1/x", action: "op:/", secondaryAction: "reciprocal", type: "operator" }
    ],
    [
      { primary: "Store", secondary: "Prefs", action: "store", secondaryAction: "prefs", type: "function" },
      { primary: "4", secondary: "lbs", action: "digit:4", secondaryAction: "unit:lb", type: "number" },
      { primary: "5", secondary: "Studs", action: "digit:5", secondaryAction: "studs", type: "number" },
      { primary: "6", secondary: "tons", action: "digit:6", secondaryAction: "unit:ton", type: "number" },
      { primary: "\u00d7", secondary: "Clear All", action: "op:*", secondaryAction: "clear-all", type: "operator" }
    ],
    [
      { primary: "Rcl", secondary: "MC", action: "recall", secondaryAction: "memory-clear", type: "function" },
      { primary: "1", secondary: "kg", action: "digit:1", secondaryAction: "unit:kg", type: "number" },
      { primary: "2", secondary: "Acre", action: "digit:2", secondaryAction: "unit:acre", type: "number" },
      { primary: "3", secondary: "met tons", action: "digit:3", secondaryAction: "unit:metricTon", type: "number" },
      { primary: "\u2212", secondary: "+/-", action: "op:-", secondaryAction: "sign", type: "operator" }
    ],
    [
      { primary: "M+", secondary: "M-", action: "mplus", secondaryAction: "mminus", type: "function" },
      { primary: "0", action: "digit:0", type: "number" },
      { primary: ".", secondary: "dms\u25c4\u25badeg", action: "decimal", secondaryAction: "dms", type: "number" },
      { primary: "=", secondary: "Tape", action: "equals", secondaryAction: "history", type: "operator" },
      { primary: "+", secondary: "\u03c0", action: "op:+", secondaryAction: "pi", type: "operator" }
    ]
  ];

  let calculator;

  function loadJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (error) {
      return fallback;
    }
  }

  function saveStatePieces() {
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify(calculator.state.preferences));
      localStorage.setItem(HISTORY_KEY, JSON.stringify(calculator.state.history.slice(0, 60)));
    } catch (error) {
      // localStorage can be blocked in private mode; calculator still works.
    }
  }

  function getPortalBackDestination() {
    if (typeof getCurrentWorkerRecord === "function") {
      const worker = getCurrentWorkerRecord();
      if (worker && worker.key) {
        if (typeof isAdminWorker === "function" && isAdminWorker(worker.key, worker.role, worker.email)) {
          return { href: "admin.html", label: "Admin" };
        }
        return { href: "home.html", label: "Home" };
      }
    }

    return { href: "index.html", label: "Login" };
  }

  function goBack() {
    window.location.href = getPortalBackDestination().href;
  }

  function updateBackButton() {
    const button = document.getElementById("calcHomeButton");
    if (!button) {
      return;
    }
    const destination = getPortalBackDestination();
    button.textContent = destination.label;
    button.setAttribute("aria-label", "Back to " + destination.label);
  }

  function keyToAria(key) {
    return key.primary + (key.secondary ? ", secondary " + key.secondary : "");
  }

  function renderKeypad() {
    const pad = document.getElementById("calcKeypad");
    pad.innerHTML = KEY_ROWS.flat().map((key) => {
      if (key.spacer) {
        return `<div class="calc-key-spacer" aria-hidden="true"></div>`;
      }
      const classes = ["calc-key", key.type || "function"];
      if (!key.secondaryAction && key.secondary) {
        classes.push("disabled-secondary");
      }
      return `
        <button type="button" class="${classes.join(" ")}" data-action="${key.action}" data-secondary-action="${key.secondaryAction || ""}" aria-label="${escapeHtml(keyToAria(key))}">
          ${key.secondary ? `<span class="secondary-label">${escapeHtml(key.secondary)}</span>` : ""}
          <span class="primary-label">${escapeHtml(key.primary)}</span>
        </button>
      `;
    }).join("");
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function updateDisplay() {
    const display = calculator.getDisplay();
    const main = document.getElementById("calcMainValue");
    main.textContent = display.main;
    main.style.fontSize = display.main.length > 13 ? "clamp(24px, 7vw, 38px)" : "";
    document.getElementById("calcUnit").textContent = display.unit || "JGC";
    document.getElementById("calcMode").textContent = display.mode || "READY";
    document.getElementById("calcExpression").textContent = display.expression || "";
    document.getElementById("convIndicator").classList.toggle("active", calculator.state.conversionMode);
    document.getElementById("convIndicator").textContent = calculator.state.conversionMode ? "CONV" : "PRI";
    document.querySelectorAll(".calc-key.convert").forEach((button) => button.classList.toggle("active", calculator.state.conversionMode));
    applyPreferenceClasses();
    saveStatePieces();
  }

  let audioContext;

  function playKeyClick() {
    if (!calculator.state.preferences.sound) {
      return;
    }
    try {
      audioContext = audioContext || new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = "square";
      oscillator.frequency.value = 620;
      gain.gain.setValueAtTime(0.025, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.035);
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start();
      oscillator.stop(audioContext.currentTime + 0.035);
    } catch (error) {
      // Audio is optional; ignore browser/autoplay restrictions.
    }
  }

  function applyPreferenceClasses() {
    if (!document.body || !calculator) {
      return;
    }
    document.body.classList.toggle("calc-fullscreen-mode", calculator.state.preferences.fullScreenMode !== false);
    document.body.classList.toggle("calc-windowed-mode", calculator.state.preferences.fullScreenMode === false);
    document.body.classList.toggle("calc-high-contrast", calculator.state.preferences.themeContrast === "high");
  }

  function resetConvIfNeeded(action) {
    if (calculator.state.conversionMode && action !== "conv") {
      calculator.state.conversionMode = calculator.state.conversionLocked;
    }
  }

  function showRowsOverlay(title, rows) {
    if (!rows || !rows.length) {
      updateDisplay();
      return;
    }
    openOverlay(title, `
      <table class="calc-result-table">
        <tbody>
          ${rows.map((row) => `<tr><th>${escapeHtml(row[0])}</th><td>${escapeHtml(row[1])}</td></tr>`).join("")}
        </tbody>
      </table>
    `);
  }

  function openOverlay(title, bodyHtml, modifierClass) {
    const overlayShell = document.querySelector(".calc-overlay");
    if (overlayShell) {
      overlayShell.className = "calc-overlay" + (modifierClass ? " " + modifierClass : "");
    }
    document.getElementById("calcOverlayTitle").textContent = title;
    document.getElementById("calcOverlayBody").innerHTML = bodyHtml;
    document.getElementById("calcOverlay").classList.add("open");
  }

  function closeOverlay(event) {
    if (event && event.target !== event.currentTarget) {
      return;
    }
    document.getElementById("calcOverlay").classList.remove("open");
  }

  function runSecondary(action) {
    runAction(action, true);
  }

  function runAction(rawAction, secondary) {
    if (!rawAction) {
      calculator.setError("Function not ready");
      updateDisplay();
      return;
    }
    let action = rawAction;
    if (!calculator.state.conversionMode && calculator.state.repeatUnitRawAction === rawAction && calculator.state.repeatUnitAction) {
      action = calculator.state.repeatUnitAction;
    }
    if (calculator.state.conversionMode && !secondary) {
      const fractionResolution = getFractionResolutionShortcut(rawAction);
      if (fractionResolution && isClearForPreferenceShortcut()) {
        action = "fraction-resolution:" + fractionResolution;
      } else {
        const button = Array.from(document.querySelectorAll(".calc-key")).find((item) => item.getAttribute("data-action") === rawAction);
        const secondaryAction = button ? button.getAttribute("data-secondary-action") : "";
        if (secondaryAction) {
          action = secondaryAction;
        }
      }
    }

    const beforeConv = calculator.state.conversionMode;
    if (action.startsWith("digit:") || action === "decimal" || action === "fraction" || action.startsWith("unit:") || action.startsWith("op:")) {
      calculator.state.lastFunction = "";
    }

    try {
      if (action.startsWith("digit:")) {
        calculator.pressDigit(action.split(":")[1]);
      } else if (action === "decimal") {
        calculator.pressDecimal();
      } else if (action === "fraction") {
        calculator.pressFraction();
      } else if (action.startsWith("unit:")) {
        const unit = action.split(":")[1];
        if (beforeConv) {
          const targetUnit = normalizeConversionUnit(unit);
          if (["lb", "kg", "ton", "metricTon"].includes(targetUnit) && calculator.state.current && calculator.state.current.dimension === "volume") {
            calculator.convertVolumeToWeight(targetUnit);
          } else {
            calculator.convertCurrent(targetUnit);
          }
        } else {
          calculator.applyUnit(unit);
        }
      } else if (action.startsWith("op:")) {
        calculator.pressOperator(action.split(":")[1]);
      } else if (action.startsWith("register:")) {
        const registerName = action.split(":")[1];
        if (registerName === "length") {
          Fn.lengthPrimary(calculator);
        } else if (registerName === "width") {
          Fn.widthPrimary(calculator);
        } else if (registerName === "height") {
          Fn.heightPrimary(calculator);
        } else {
          calculator.handleRegisterKey(registerName);
        }
      } else {
        runNamedAction(action);
      }
    } catch (error) {
      calculator.setError(error.message);
    }

    if (navigator.vibrate && calculator.state.preferences.haptic) {
      navigator.vibrate(8);
    }
    playKeyClick();
    rememberRepeatUnit(rawAction, action, beforeConv);
    resetConvIfNeeded(action);
    updateDisplay();
  }

  function rememberRepeatUnit(rawAction, action, wasConv) {
    if (wasConv && rawAction && rawAction.startsWith("digit:") && action && action.startsWith("unit:")) {
      calculator.state.repeatUnitRawAction = rawAction;
      calculator.state.repeatUnitAction = action;
      return;
    }
    if (rawAction === calculator.state.repeatUnitRawAction && action === calculator.state.repeatUnitAction) {
      return;
    }
    if (action !== "conv") {
      calculator.state.repeatUnitRawAction = "";
      calculator.state.repeatUnitAction = "";
    }
  }

  function normalizeConversionUnit(unit) {
    const current = calculator.state.current;
    if (!current) {
      return unit;
    }
    if (unit === "m" && current.dimension === "area") {
      return "sqm";
    }
    if (unit === "m" && current.dimension === "volume") {
      return "cum";
    }
    if (unit === "cm" && current.dimension === "area") {
      return "sqcm";
    }
    if (unit === "cm" && current.dimension === "volume") {
      return "cucm";
    }
    if (unit === "mm" && current.dimension === "area") {
      return "sqmm";
    }
    if (unit === "mm" && current.dimension === "volume") {
      return "cumm";
    }
    if (unit === "yd" && current.dimension === "area") {
      return "sqyd";
    }
    if (unit === "yd" && current.dimension === "volume") {
      return "cuyd";
    }
    if (unit === "ft" && current.dimension === "area") {
      return "sqft";
    }
    if (unit === "ft" && current.dimension === "volume") {
      return "cuft";
    }
    if (unit === "in" && current.dimension === "area") {
      return "sqin";
    }
    if (unit === "in" && current.dimension === "volume") {
      return "cuin";
    }
    return unit;
  }

  function getFractionResolutionShortcut(rawAction) {
    const map = {
      "digit:1": 16,
      "digit:2": 2,
      "digit:3": 32,
      "digit:4": 4,
      "digit:6": 64,
      "digit:8": 8
    };
    return map[rawAction] || 0;
  }

  function isClearForPreferenceShortcut() {
    const current = calculator.state.current;
    return !calculator.state.inputBuffer &&
      !calculator.state.pendingOperator &&
      current &&
      current.dimension === "scalar" &&
      Math.abs(current.baseValue) < 1e-10;
  }

  function runNamedAction(action) {
    const rowsByAction = {
      "roof-summary": () => Fn.roofSummary(calculator),
      stair: () => Fn.stair(calculator),
      "riser-limit": () => Fn.setRiserLimit(calculator),
      arc: () => Fn.arc(calculator),
      "column-cone": () => Fn.columnCone(calculator, false),
      studs: () => Fn.studs(calculator),
      "board-feet": () => Fn.boardFeet(calculator),
      "compound-miter": () => Fn.compoundMiter(calculator),
      "spring-angle": () => Fn.setSpringAngle(calculator),
      polygon: () => Fn.polygon(calculator),
      "rake-wall": () => Fn.rakeWall(calculator),
      jack: () => Fn.jack(calculator),
      dms: () => Fn.dmsDecimal(calculator)
    };
    switch (action) {
      case "conv":
        calculator.state.conversionMode = !calculator.state.conversionMode;
        calculator.state.status = calculator.state.conversionMode ? "Secondary functions active" : "";
        break;
      case "pitch":
      case "slope":
        Fn.pitchPrimary(calculator);
        break;
      case "rise":
        Fn.risePrimary(calculator);
        break;
      case "run":
        Fn.runPrimary(calculator);
        break;
      case "diag":
        Fn.diagPrimary(calculator);
        break;
      case "hip":
        Fn.hipValley(calculator);
        break;
      case "irregular-pitch":
        Fn.irregularPitch(calculator);
        break;
      case "irregular-jack":
        calculator.setError("Advanced irregular calc not verified yet");
        break;
      case "radius":
        calculator.handleRegisterKey("radius");
        break;
      case "arc-radius":
        Fn.arcRadius(calculator);
        break;
      case "circle":
        Fn.circle(calculator);
        break;
      case "percent":
        calculator.percent();
        break;
      case "square":
        calculator.square();
        break;
      case "sqrt":
        calculator.squareRoot();
        break;
      case "clear":
        calculator.clear();
        break;
      case "clear-all":
        calculator.clearAll();
        break;
      case "reciprocal":
        calculator.reciprocal();
        break;
      case "sign":
        calculator.toggleSign();
        break;
      case "equals":
        calculator.equals();
        break;
      case "pi":
        calculator.pi();
        break;
      case "store":
        calculator.storeMemory();
        break;
      case "recall":
        calculator.recallMemory();
        break;
      case "mplus":
        calculator.memoryPlus(1);
        break;
      case "mminus":
        calculator.memoryPlus(-1);
        break;
      case "memory-clear":
        calculator.memoryClear();
        break;
      case "prefs":
        openPreferences();
        break;
      case "history":
        openHistory();
        break;
      default:
        if (action.startsWith("fraction-resolution:")) {
          calculator.setFractionResolution(Number(action.split(":")[1]));
        } else if (rowsByAction[action]) {
          const rows = rowsByAction[action]();
          if (Array.isArray(rows) && rows.length) {
            showRowsOverlay(action.replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()), rows);
          }
        } else {
          calculator.setError("Function not ready");
        }
    }
  }

  function openHistory() {
    const rows = calculator.state.history || [];
    openOverlay("Tape / History", `
      ${rows.length ? `<table class="calc-result-table"><tbody>${rows.map((item) => `<tr><th>${escapeHtml(item.label)}</th><td>${escapeHtml(item.value)}</td></tr>`).join("")}</tbody></table>` : `<p>No history yet.</p>`}
      <div class="calculator-notice">History is stored on this device only.</div>
      <p><button type="button" class="toolbar-button" onclick="window.JgcFieldCalculator.clearHistory()">Clear History</button></p>
    `);
  }

  function openPreferences() {
    const prefs = calculator.state.preferences;
    const pref = (key, fallback) => prefs[key] === undefined || prefs[key] === null ? fallback : prefs[key];
    const checked = (key, fallback) => pref(key, fallback) ? " checked" : "";
    const value = (key, fallback) => escapeHtml(pref(key, fallback));
    const boundedValue = (key, fallback, min, max) => {
      const number = Number(pref(key, fallback));
      return escapeHtml(Number.isFinite(number) && number >= min && number <= max ? number : fallback);
    };
    const options = (items, current) => items.map((item) => {
      const selected = String(item.value) === String(current) ? " selected" : "";
      return `<option value="${escapeHtml(item.value)}"${selected}>${escapeHtml(item.label)}</option>`;
    }).join("");

    openOverlay("Preferences", `
      <div class="preferences-screen">
        <details class="preferences-section" open>
          <summary class="pref-section-toggle">General</summary>
          <label class="pref-row">
            <span>Key Clicks</span>
            <input id="prefSound" class="pref-switch-input" type="checkbox"${checked("sound", false)}>
            <span class="pref-switch" aria-hidden="true"></span>
          </label>
          <label class="pref-row">
            <span>Haptic Feedback</span>
            <input id="prefHaptic" class="pref-switch-input" type="checkbox"${checked("haptic", true)}>
            <span class="pref-switch" aria-hidden="true"></span>
          </label>
          <label class="pref-row">
            <span>Trig Mode</span>
            <input id="prefTrigMode" class="pref-switch-input" type="checkbox"${checked("trigMode", false)}>
            <span class="pref-switch" aria-hidden="true"></span>
          </label>
          <label class="pref-row">
            <span>Legacy Mode</span>
            <input id="prefLegacyMode" class="pref-switch-input" type="checkbox"${checked("legacyMode", false)}>
            <span class="pref-switch" aria-hidden="true"></span>
          </label>
          <label class="pref-row">
            <span>Full Screen Mode</span>
            <input id="prefFullScreenMode" class="pref-switch-input" type="checkbox"${checked("fullScreenMode", true)}>
            <span class="pref-switch" aria-hidden="true"></span>
          </label>
        </details>

        <details class="preferences-section">
          <summary class="pref-section-toggle">Display Settings</summary>
          <label class="pref-row">
            <span>Fractional Resolution</span>
            <select id="prefFraction">${options([2, 4, 8, 16, 32, 64].map((item) => ({ value: item, label: "1/" + item })), pref("fractionDenominator", 16))}</select>
          </label>
          <label class="pref-row">
            <span>Fractional Mode</span>
            <select id="prefFractionMode">${options([{ value: "standard", label: "Standard" }, { value: "fixed", label: "Constant" }], pref("fractionMode", "standard"))}</select>
          </label>
          <label class="pref-row">
            <span>Exponential</span>
            <input id="prefExponential" class="pref-switch-input" type="checkbox"${checked("exponential", false)}>
            <span class="pref-switch" aria-hidden="true"></span>
          </label>
          <label class="pref-row">
            <span>Area Display</span>
            <select id="prefAreaDisplay">${options([{ value: "standard", label: "Standard" }, { value: "sqft", label: "Square Feet" }, { value: "sqyd", label: "Square Yards" }, { value: "sqm", label: "Square Meters" }], pref("areaDisplay", "standard"))}</select>
          </label>
          <label class="pref-row">
            <span>Volume Display</span>
            <select id="prefVolumeDisplay">${options([{ value: "standard", label: "Standard" }, { value: "cuft", label: "Cubic Feet" }, { value: "cuyd", label: "Cubic Yards" }, { value: "cum", label: "Cubic Meters" }], pref("volumeDisplay", "standard"))}</select>
          </label>
          <label class="pref-row">
            <span>Meters</span>
            <select id="prefMeterPrecision">${options([{ value: 2, label: "0.00" }, { value: 3, label: "0.000" }, { value: 4, label: "0.0000" }], pref("meterPrecision", 3))}</select>
          </label>
          <label class="pref-row">
            <span>Decimal Degrees</span>
            <select id="prefDegreePrecision">${options([{ value: 1, label: "0.0" }, { value: 2, label: "0.00" }, { value: 3, label: "0.000" }], pref("degreePrecision", 2))}</select>
          </label>
          <label class="pref-row">
            <span>Comma Separator</span>
            <input id="prefCommaSeparator" class="pref-switch-input" type="checkbox"${checked("commaSeparator", true)}>
            <span class="pref-switch" aria-hidden="true"></span>
          </label>
          <label class="pref-row">
            <span>Unitless Decimal Display</span>
            <select id="prefUnitlessDisplay">${options([{ value: "float", label: "Float" }, { value: "fixed", label: "Fixed" }], pref("unitlessDisplay", "float"))}</select>
          </label>
          <label class="pref-row">
            <span>Display Precision</span>
            <input id="prefPrecision" type="number" min="2" max="8" value="${value("precision", 5)}">
          </label>
        </details>

        <details class="preferences-section">
          <summary class="pref-section-toggle">Function Settings</summary>
          <label class="pref-row">
            <span>Rake Wall</span>
            <select id="prefRakeWallOrder">${options([{ value: "descending", label: "Descending" }, { value: "ascending", label: "Ascending" }], pref("rakeWallOrder", "descending"))}</select>
          </label>
          <label class="pref-row">
            <span>Arched Wall</span>
            <select id="prefArchedWallSide">${options([{ value: "outside", label: "Outside" }, { value: "inside", label: "Inside" }], pref("archedWallSide", "outside"))}</select>
          </label>
          <label class="pref-row">
            <span>Jack Rafters</span>
            <select id="prefJackOrder">${options([{ value: "descending", label: "Descending" }, { value: "ascending", label: "Ascending" }], pref("jackOrder", "descending"))}</select>
          </label>
          <label class="pref-row">
            <span>Irregular Jack Rafters</span>
            <select id="prefIrregularJackMode">${options([{ value: "on-center", label: "On-Center" }, { value: "spacing", label: "Spacing" }], pref("irregularJackMode", "on-center"))}</select>
          </label>
        </details>

        <details class="preferences-section">
          <summary class="pref-section-toggle">Stored Settings</summary>
          <label class="pref-row">
            <span>Headroom Height</span>
            <input id="prefHeadroomHeight" type="number" min="48" max="120" step="0.01" value="${boundedValue("headroomHeight", 80, 48, 120)}">
            <small>inches</small>
          </label>
          <label class="pref-row">
            <span>Riser Height</span>
            <input id="prefRiserLimit" type="number" step="0.001" min="4" max="7.875" value="${boundedValue("stairRiserLimit", 7.5, 4, 7.875)}">
            <small>inches</small>
          </label>
          <label class="pref-row">
            <span>Floor Thickness</span>
            <input id="prefFloorThickness" type="number" min="0" max="36" step="0.01" value="${boundedValue("floorThickness", 10, 0, 36)}">
            <small>inches</small>
          </label>
          <label class="pref-row">
            <span>Tread Width</span>
            <input id="prefTreadDepth" type="number" step="0.01" min="4" max="24" value="${boundedValue("treadDepth", 10, 4, 24)}">
            <small>inches</small>
          </label>
          <label class="pref-row">
            <span>Spring Angle</span>
            <input id="prefSpringAngle" type="number" step="0.1" min="1" value="${value("springAngle", 38)}">
            <small>degrees</small>
          </label>
          <label class="pref-row">
            <span>On-Center Spacing</span>
            <input id="prefStudSpacing" type="number" min="8" max="32" value="${value("studSpacing", 16)}">
            <small>inches</small>
          </label>
          <label class="pref-row">
            <span>Weight / Volume</span>
            <input id="prefWeightPerVolume" type="number" min="0" step="0.01" value="${value("weightPerVolume", 1.5)}">
            <small>ton/yard3</small>
          </label>
        </details>

        <button type="button" class="pref-reset-button" onclick="window.JgcFieldCalculator.resetCalculatorData()">Reset calculator data and settings</button>
        <div class="pref-bottom-bar">
          <button type="button" class="toolbar-button" onclick="window.JgcFieldCalculator.savePreferences()">Save Preferences</button>
        </div>
      </div>
      <div class="calculator-notice">Calculation aid only. Verify critical measurements, engineering requirements, and applicable building codes before construction.</div>
    `, "preferences-overlay");
  }

  function openHelp() {
    openOverlay("JGC Pocket Guide", `
      <div class="guide-screen">
        <p class="guide-intro">
          This original JGC guide follows the same workflow covered by the CM pocket guide and full manual:
          enter a number, choose a unit, press a function, then read the answer.
        </p>

        <div class="guide-actions">
          <button type="button" class="toolbar-button" onclick="window.JgcFieldCalculator.openPreferences()">Preferences</button>
          <button type="button" class="toolbar-button" onclick="window.JgcFieldCalculator.openHistory()">Tape</button>
        </div>

        <details class="guide-section" open>
          <summary>1. Basic Keys</summary>
          <table class="guide-table">
            <tr><th>Key</th><th>Use</th></tr>
            <tr><td><span class="guide-key">Clear</span></td><td>Clears the current entry or error. Press again when needed to reset the entry.</td></tr>
            <tr><td><span class="guide-key">Conv</span></td><td>Turns on the green/red secondary labels for the next key press.</td></tr>
            <tr><td><span class="guide-key">Conv</span> + <span class="guide-key">x</span></td><td>Clear all working values.</td></tr>
            <tr><td><span class="guide-key">Conv</span> + <span class="guide-key">=</span></td><td>Open the calculation tape.</td></tr>
            <tr><td><span class="guide-key">Conv</span> + <span class="guide-key">Store</span></td><td>Open calculator preferences.</td></tr>
          </table>
        </details>

        <details class="guide-section" open>
          <summary>2. Entering Dimensions</summary>
          <table class="guide-table">
            <tr><th>Tap sequence</th><th>Result</th></tr>
            <tr><td>5 <span class="guide-key">Feet</span> 1 <span class="guide-key">Inch</span> 1 <span class="guide-key">/</span> 2</td><td>5 feet - 1 1/2 inch</td></tr>
            <tr><td>5 <span class="guide-key">Yds</span></td><td>5 yards</td></tr>
            <tr><td>17 <span class="guide-key">.</span> 5 <span class="guide-key">m</span></td><td>17.5 meters</td></tr>
            <tr><td>100 <span class="guide-key">Feet</span> <span class="guide-key">Feet</span></td><td>100 square feet</td></tr>
            <tr><td>100 <span class="guide-key">Feet</span> <span class="guide-key">Feet</span> <span class="guide-key">Feet</span></td><td>100 cubic feet</td></tr>
          </table>
          <p class="guide-note">Pressing the same unit key again changes linear to square, then cubic, when that makes sense.</p>
        </details>

        <details class="guide-section" open>
          <summary>3. Conversions</summary>
          <table class="guide-table">
            <tr><th>Tap sequence</th><th>Result</th></tr>
            <tr><td>10 <span class="guide-key">Feet</span> <span class="guide-key">Conv</span> <span class="guide-key">m</span></td><td>3.048 meters</td></tr>
            <tr><td>100 <span class="guide-key">cm</span> <span class="guide-key">Conv</span> <span class="guide-key">Inch</span></td><td>39.3701 inches</td></tr>
            <tr><td>17.32 <span class="guide-key">Feet</span> <span class="guide-key">Conv</span> <span class="guide-key">Feet</span></td><td>Feet-inch-fraction display</td></tr>
            <tr><td>9.0625 <span class="guide-key">Inch</span> <span class="guide-key">Conv</span> <span class="guide-key">Inch</span></td><td>9 1/16 inch</td></tr>
          </table>
        </details>

        <details class="guide-section">
          <summary>4. Basic Math</summary>
          <table class="guide-table">
            <tr><th>Tap sequence</th><th>Result</th></tr>
            <tr><td>4 <span class="guide-key">Feet</span> 6 <span class="guide-key">Inch</span> + 2 <span class="guide-key">Feet</span> 3 <span class="guide-key">Inch</span> =</td><td>6 feet - 9 inch</td></tr>
            <tr><td>10 <span class="guide-key">Feet</span> x 12 <span class="guide-key">Feet</span> =</td><td>120 square feet</td></tr>
            <tr><td>100 + 10 <span class="guide-key">%</span></td><td>110</td></tr>
            <tr><td><span class="guide-key">Conv</span> + <span class="guide-key">%</span></td><td>Square the current value.</td></tr>
            <tr><td><span class="guide-key">Conv</span> + <span class="guide-key">Clear</span></td><td>Square root of the current value.</td></tr>
          </table>
        </details>

        <details class="guide-section">
          <summary>5. Registers and Material Functions</summary>
          <div class="guide-keyline"><span class="guide-key">Length</span> <span class="guide-key">Width</span> <span class="guide-key">Height</span> <span class="guide-key">Rise</span> <span class="guide-key">Run</span> <span class="guide-key">Diag</span></div>
          <p>With a current value showing, pressing one of these keys stores that value. With no new value entered, pressing the key recalls it.</p>
          <table class="guide-table">
            <tr><th>Function</th><th>Workflow</th></tr>
            <tr><td>Studs</td><td>Store Length, then press <span class="guide-key">Conv</span> + <span class="guide-key">5</span>.</td></tr>
            <tr><td>Board Feet</td><td>Store thickness as Height, board width as Width, length as Length, then press <span class="guide-key">Conv</span> + <span class="guide-key">8</span>.</td></tr>
          </table>
        </details>

        <details class="guide-section">
          <summary>6. Roof, Stairs, Circle and Arc</summary>
          <table class="guide-table">
            <tr><th>Function</th><th>Workflow</th></tr>
            <tr><td>Pitch</td><td>Store Rise and Run, then press <span class="guide-key">Pitch</span>. Repeated presses cycle pitch, angle, and slope.</td></tr>
            <tr><td>Diagonal / Rafter</td><td>Store Rise and Run, then press <span class="guide-key">Diag</span>.</td></tr>
            <tr><td>Hip / Valley</td><td>Store Rise and Run, then press <span class="guide-key">Hip/V</span>.</td></tr>
            <tr><td>Stairs</td><td>Store total Rise, then press <span class="guide-key">Stair</span>. Repeated presses cycle riser height, risers, tread width, treads, opening, stringer, angle, run, rise, and stored settings.</td></tr>
            <tr><td>Circle</td><td>Enter radius or diameter, then press <span class="guide-key">Circ</span>.</td></tr>
            <tr><td>Arc</td><td>Store Radius and angle, then press <span class="guide-key">Arc</span>.</td></tr>
          </table>
        </details>

        <details class="guide-section">
          <summary>7. Preferences and Current Limits</summary>
          <p>Use Preferences for fraction resolution, display precision, stud spacing, stair defaults, spring angle, and stored construction defaults.</p>
          <p class="guide-note">Irregular pitch and irregular jack functions are shown on the keypad for future expansion, but this calculator will not return unverified advanced roof math.</p>
        </details>

        <div class="calculator-notice">Calculation aid only. Verify critical measurements, engineering requirements, and applicable building codes before construction.</div>
      </div>
    `, "guide-overlay");
  }

  function openLegacyHelp() {
    openOverlay("Calculator Help", `
      <ul class="help-list">
        <li>Enter dimensions as Number → Unit. Example: 4 → Feet → 6 → Inch.</li>
        <li>Fractions: 5 → / → 8 → Inch enters 5/8 inch.</li>
        <li>Conv activates the red secondary label on the next button.</li>
        <li>Length, Width, Height, Rise, Run, Diag, Radius store the current value. Press with no current value to recall.</li>
        <li>Length × Width creates area. Area × Height creates volume.</li>
        <li>Use Conv + = for the tape/history panel.</li>
        <li>Use Conv + Store for preferences.</li>
      </ul>
      <div class="calculator-notice">Calculation aid only. Verify critical measurements, engineering requirements, and applicable building codes before construction.</div>
    `);
  }

  function savePreferencesFromOverlay() {
    const numberValue = (id, fallback) => {
      const node = document.getElementById(id);
      if (!node) {
        return fallback;
      }
      const value = Number(node.value);
      return Number.isFinite(value) ? value : fallback;
    };
    const boundedNumberValue = (id, fallback, min, max) => {
      const value = numberValue(id, fallback);
      return Number.isFinite(value) && value >= min && value <= max ? value : fallback;
    };
    const textValue = (id, fallback) => {
      const node = document.getElementById(id);
      return node ? node.value : fallback;
    };
    const checkedValue = (id, fallback) => {
      const node = document.getElementById(id);
      return node ? node.checked : fallback;
    };

    calculator.updatePreferences({
      fractionDenominator: numberValue("prefFraction", 16),
      precision: numberValue("prefPrecision", 5),
      studSpacing: numberValue("prefStudSpacing", 16),
      stairRiserLimit: boundedNumberValue("prefRiserLimit", 7.5, 4, 7.875),
      treadDepth: boundedNumberValue("prefTreadDepth", 10, 4, 24),
      springAngle: numberValue("prefSpringAngle", 38),
      sound: checkedValue("prefSound", false),
      haptic: checkedValue("prefHaptic", true),
      trigMode: checkedValue("prefTrigMode", false),
      legacyMode: checkedValue("prefLegacyMode", false),
      fullScreenMode: checkedValue("prefFullScreenMode", true),
      fractionMode: textValue("prefFractionMode", "standard"),
      exponential: checkedValue("prefExponential", false),
      areaDisplay: textValue("prefAreaDisplay", "standard"),
      volumeDisplay: textValue("prefVolumeDisplay", "standard"),
      meterPrecision: numberValue("prefMeterPrecision", 3),
      degreePrecision: numberValue("prefDegreePrecision", 2),
      commaSeparator: checkedValue("prefCommaSeparator", true),
      unitlessDisplay: textValue("prefUnitlessDisplay", "float"),
      rakeWallOrder: textValue("prefRakeWallOrder", "descending"),
      archedWallSide: textValue("prefArchedWallSide", "outside"),
      jackOrder: textValue("prefJackOrder", "descending"),
      irregularJackMode: textValue("prefIrregularJackMode", "on-center"),
      headroomHeight: boundedNumberValue("prefHeadroomHeight", 80, 48, 120),
      floorThickness: boundedNumberValue("prefFloorThickness", 10, 0, 36),
      weightPerVolume: numberValue("prefWeightPerVolume", 1.5)
    });
    saveStatePieces();
    closeOverlay();
    applyPreferenceClasses();
    updateDisplay();
  }

  function resetCalculatorData() {
    if (!confirm("Reset calculator data and settings on this device?")) {
      return;
    }
    localStorage.removeItem(PREF_KEY);
    localStorage.removeItem(HISTORY_KEY);
    calculator = new EngineApi.CalculatorEngine({}, []);
    closeOverlay();
    applyPreferenceClasses();
    updateDisplay();
  }

  function handleKeyboard(event) {
    const key = event.key;
    if (/^\d$/.test(key)) {
      runAction("digit:" + key);
      event.preventDefault();
    } else if (key === ".") {
      runAction("decimal");
      event.preventDefault();
    } else if (key === "+") {
      runAction("op:+");
      event.preventDefault();
    } else if (key === "-") {
      runAction("op:-");
      event.preventDefault();
    } else if (key === "*") {
      runAction("op:*");
      event.preventDefault();
    } else if (key === "/") {
      runAction("op:/");
      event.preventDefault();
    } else if (key === "Enter" || key === "=") {
      runAction("equals");
      event.preventDefault();
    } else if (key === "Escape") {
      runAction("clear");
      event.preventDefault();
    } else if (key === "Backspace") {
      calculator.backspace();
      updateDisplay();
      event.preventDefault();
    }
  }

  function init() {
    if (!EngineApi || !Fn) {
      alert("Calculator engine could not load.");
      return;
    }
    calculator = new EngineApi.CalculatorEngine(loadJson(PREF_KEY, {}), loadJson(HISTORY_KEY, []));
    applyPreferenceClasses();
    updateBackButton();
    renderKeypad();
    document.getElementById("calcKeypad").addEventListener("click", (event) => {
      const button = event.target.closest(".calc-key");
      if (!button) {
        return;
      }
      button.classList.add("pressed");
      setTimeout(() => button.classList.remove("pressed"), 110);
      runAction(button.getAttribute("data-action"));
    });
    document.getElementById("calcDisplay").addEventListener("click", () => {
      calculator.backspace();
      updateDisplay();
    });
    document.getElementById("calcDisplay").addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        calculator.backspace();
        updateDisplay();
        event.preventDefault();
      }
    });
    document.addEventListener("keydown", handleKeyboard);
    updateDisplay();
  }

  window.JgcFieldCalculator = {
    closeOverlay,
    openHelp,
    openHistory,
    openPreferences,
    savePreferences: savePreferencesFromOverlay,
    resetCalculatorData,
    goBack,
    clearHistory() {
      calculator.state.history = [];
      saveStatePieces();
      openHistory();
      updateDisplay();
    },
    runAction,
    runSecondary,
    getEngine() {
      return calculator;
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
