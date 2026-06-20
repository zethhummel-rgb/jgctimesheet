(function(global) {
  "use strict";

  const INCHES_PER_METER = 39.37007874015748;
  const EPSILON = 1e-10;

  const UNIT_DEFS = {
    in: { label: "IN", dimension: "length", factor: 1 },
    ft: { label: "FT", dimension: "length", factor: 12 },
    yd: { label: "YD", dimension: "length", factor: 36 },
    m: { label: "M", dimension: "length", factor: INCHES_PER_METER },
    cm: { label: "CM", dimension: "length", factor: INCHES_PER_METER / 100 },
    mm: { label: "MM", dimension: "length", factor: INCHES_PER_METER / 1000 },
    sqin: { label: "SQ IN", dimension: "area", factor: 1 },
    sqft: { label: "SQ FT", dimension: "area", factor: 144 },
    sqyd: { label: "SQ YD", dimension: "area", factor: 1296 },
    sqm: { label: "SQ M", dimension: "area", factor: INCHES_PER_METER ** 2 },
    sqcm: { label: "SQ CM", dimension: "area", factor: (INCHES_PER_METER / 100) ** 2 },
    sqmm: { label: "SQ MM", dimension: "area", factor: (INCHES_PER_METER / 1000) ** 2 },
    acre: { label: "ACRE", dimension: "area", factor: 6272640 },
    cuin: { label: "CU IN", dimension: "volume", factor: 1 },
    cuft: { label: "CU FT", dimension: "volume", factor: 1728 },
    cuyd: { label: "CU YD", dimension: "volume", factor: 46656 },
    cum: { label: "CU M", dimension: "volume", factor: INCHES_PER_METER ** 3 },
    cucm: { label: "CU CM", dimension: "volume", factor: (INCHES_PER_METER / 100) ** 3 },
    cumm: { label: "CU MM", dimension: "volume", factor: (INCHES_PER_METER / 1000) ** 3 },
    lb: { label: "LB", dimension: "weight", factor: 1 },
    kg: { label: "KG", dimension: "weight", factor: 2.20462262185 },
    ton: { label: "TON", dimension: "weight", factor: 2000 },
    metricTon: { label: "MET TON", dimension: "weight", factor: 2204.62262185 },
    deg: { label: "DEG", dimension: "angle", factor: 1 },
    percent: { label: "%", dimension: "scalar", factor: 1 },
    scalar: { label: "", dimension: "scalar", factor: 1 },
    currency: { label: "$", dimension: "currency", factor: 1 },
    count: { label: "COUNT", dimension: "count", factor: 1 },
    boardft: { label: "BD FT", dimension: "volume-lumber", factor: 1 }
  };

  const DIMENSION_DEFAULT_UNIT = {
    scalar: "scalar",
    length: "ft",
    area: "sqft",
    volume: "cuft",
    weight: "lb",
    angle: "deg",
    currency: "currency",
    count: "count",
    "volume-lumber": "boardft"
  };

  const REGISTER_KEYS = ["length", "width", "height", "rise", "run", "diag", "pitch", "radius", "springAngle"];
  const REPEATED_UNIT_MAP = {
    in: { area: "sqin", volume: "cuin" },
    ft: { area: "sqft", volume: "cuft" },
    yd: { area: "sqyd", volume: "cuyd" },
    m: { area: "sqm", volume: "cum" },
    cm: { area: "sqcm", volume: "cucm" },
    mm: { area: "sqmm", volume: "cumm" }
  };

  function roundForDisplay(value, precision) {
    if (!Number.isFinite(value)) {
      return value;
    }
    const digits = typeof precision === "number" ? precision : 5;
    const factor = 10 ** digits;
    return Math.round((value + Number.EPSILON) * factor) / factor;
  }

  function gcd(a, b) {
    a = Math.abs(Math.round(a));
    b = Math.abs(Math.round(b));
    while (b) {
      const t = b;
      b = a % b;
      a = t;
    }
    return a || 1;
  }

  function makeValue(baseValue, dimension, unit, meta) {
    return {
      baseValue: Number(baseValue) || 0,
      dimension: dimension || "scalar",
      unit: unit || DIMENSION_DEFAULT_UNIT[dimension || "scalar"] || "scalar",
      meta: meta || {}
    };
  }

  function cloneValue(value) {
    if (!value) {
      return null;
    }
    return makeValue(value.baseValue, value.dimension, value.unit, Object.assign({}, value.meta || {}));
  }

  function valueFromDisplay(number, unit, meta) {
    const def = UNIT_DEFS[unit] || UNIT_DEFS.scalar;
    return makeValue(Number(number || 0) * def.factor, def.dimension, unit, meta);
  }

  function convertDisplay(value, unit) {
    if (!value) {
      return 0;
    }
    const def = UNIT_DEFS[unit] || UNIT_DEFS[value.unit] || UNIT_DEFS.scalar;
    if (def.dimension !== value.dimension && !(def.dimension === "scalar" && value.dimension === "scalar")) {
      throw new Error("Incompatible units");
    }
    return value.baseValue / def.factor;
  }

  function inferUnitForOperation(dimension, left, right) {
    if (dimension === "area") {
      return left && left.unit && left.unit.startsWith("m") || right && right.unit && right.unit.startsWith("m") ? "sqm" : "sqft";
    }
    if (dimension === "volume") {
      return left && left.unit && left.unit.startsWith("m") || right && right.unit && right.unit.startsWith("m") ? "cum" : "cuft";
    }
    return DIMENSION_DEFAULT_UNIT[dimension] || "scalar";
  }

  function addValues(a, b, sign) {
    if (a.dimension !== b.dimension) {
      throw new Error("Incompatible units");
    }
    return makeValue(a.baseValue + sign * b.baseValue, a.dimension, a.unit || b.unit, Object.assign({}, b.meta || {}, a.meta || {}));
  }

  function multiplyValues(a, b) {
    if (a.dimension === "scalar") {
      return makeValue(a.baseValue * b.baseValue, b.dimension, b.unit, Object.assign({}, b.meta || {}));
    }
    if (b.dimension === "scalar") {
      return makeValue(a.baseValue * b.baseValue, a.dimension, a.unit, Object.assign({}, a.meta || {}));
    }
    if (a.dimension === "length" && b.dimension === "length") {
      return makeValue(a.baseValue * b.baseValue, "area", inferUnitForOperation("area", a, b));
    }
    if ((a.dimension === "area" && b.dimension === "length") || (a.dimension === "length" && b.dimension === "area")) {
      return makeValue(a.baseValue * b.baseValue, "volume", inferUnitForOperation("volume", a, b));
    }
    throw new Error("Incompatible multiplication");
  }

  function divideValues(a, b) {
    if (Math.abs(b.baseValue) < EPSILON) {
      throw new Error("Divide by zero");
    }
    if (b.dimension === "scalar") {
      return makeValue(a.baseValue / b.baseValue, a.dimension, a.unit, Object.assign({}, a.meta || {}));
    }
    if (a.dimension === b.dimension) {
      return makeValue(a.baseValue / b.baseValue, "scalar", "scalar");
    }
    if (a.dimension === "volume" && b.dimension === "length") {
      return makeValue(a.baseValue / b.baseValue, "area", "sqft");
    }
    if (a.dimension === "area" && b.dimension === "length") {
      return makeValue(a.baseValue / b.baseValue, "length", "ft");
    }
    throw new Error("Incompatible division");
  }

  function operate(a, operator, b) {
    if (!a) {
      return cloneValue(b);
    }
    if (!b) {
      return cloneValue(a);
    }
    if (operator === "+") {
      return addValues(a, b, 1);
    }
    if (operator === "-") {
      return addValues(a, b, -1);
    }
    if (operator === "*") {
      return multiplyValues(a, b);
    }
    if (operator === "/") {
      return divideValues(a, b);
    }
    return cloneValue(b);
  }

  const DISPLAY_UNIT_LABELS = {
    sqin: "SQUARE INCH",
    sqft: "SQUARE FEET",
    sqyd: "SQUARE YARD",
    sqm: "SQUARE METER",
    sqcm: "SQUARE CENTIMETER",
    sqmm: "SQUARE MILLIMETER",
    acre: "ACRE",
    cuin: "CUBIC INCH",
    cuft: "CUBIC FEET",
    cuyd: "CUBIC YARD",
    cum: "CUBIC METER",
    cucm: "CUBIC CENTIMETER",
    cumm: "CUBIC MILLIMETER"
  };

  function addCommaSeparators(text) {
    const parts = String(text).split(".");
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return parts.join(".");
  }

  function formatNumber(number, precision, preferences) {
    const prefs = preferences || {};
    const rounded = roundForDisplay(number, precision);
    if (!Number.isFinite(rounded)) {
      return "Error";
    }
    if (prefs.exponential || Math.abs(rounded) >= 1000000000 || (Math.abs(rounded) > 0 && Math.abs(rounded) < 0.00001)) {
      return rounded.toExponential(5);
    }
    let text = prefs.fixedDecimalPlaces === true
      ? rounded.toFixed(Math.max(0, Number(precision) || 0))
      : String(rounded).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
    if (prefs.commaSeparator !== false) {
      text = addCommaSeparators(text);
    }
    if (prefs.trailingDecimalForWholeNumbers !== false && !text.includes(".")) {
      text += ".";
    }
    return text;
  }

  function displayUnitLabel(unit, def) {
    return DISPLAY_UNIT_LABELS[unit] || (def && def.label) || "";
  }

  function displayModeLabel(state, formatted, value) {
    if (state.error || state.status) {
      return state.error || state.status;
    }
    if (state.memory) {
      return "M";
    }
    if (value && (value.dimension === "area" || value.dimension === "volume")) {
      return "";
    }
    return formatted.mode;
  }

  function inchesToFeetInches(totalInches, denominator, options) {
    const opts = options || {};
    const negative = totalInches < -EPSILON;
    let inches = Math.abs(totalInches);
    const feet = Math.floor(inches / 12);
    inches -= feet * 12;
    const wholeInches = Math.floor(inches + EPSILON);
    let fraction = Math.round((inches - wholeInches) * denominator);
    let displayFeet = feet;
    let displayInches = wholeInches;
    if (fraction >= denominator) {
      displayInches += 1;
      fraction = 0;
    }
    if (displayInches >= 12) {
      displayFeet += 1;
      displayInches -= 12;
    }
    let fractionText = "";
    if (fraction) {
      const div = opts.fractionMode === "fixed" || opts.fractionMode === "constant" ? 1 : gcd(fraction, denominator);
      fractionText = (fraction / div) + "/" + (denominator / div);
    }
    let text = "";
    if (displayFeet || opts.showZeroFeet) {
      text += displayFeet + "\u2032";
    }
    if (displayInches || fractionText || !displayFeet) {
      if (displayFeet || opts.showZeroFeet) {
        text += "-";
      }
      text += displayInches ? displayInches : (displayFeet && fractionText ? "0" : "");
      if (fractionText) {
        text += (displayInches || displayFeet ? " " : "") + fractionText;
      }
      text += "\u2033";
    }
    return (negative ? "-" : "") + text;
  }

  function inchesToInchesFraction(totalInches, denominator, options) {
    const opts = options || {};
    const negative = totalInches < -EPSILON;
    const absInches = Math.abs(totalInches);
    const wholeInches = Math.floor(absInches + EPSILON);
    let fraction = Math.round((absInches - wholeInches) * denominator);
    let displayInches = wholeInches;
    if (fraction >= denominator) {
      displayInches += 1;
      fraction = 0;
    }
    let fractionText = "";
    if (fraction) {
      const div = opts.fractionMode === "fixed" || opts.fractionMode === "constant" ? 1 : gcd(fraction, denominator);
      fractionText = (fraction / div) + "/" + (denominator / div);
    }
    const text = displayInches + (fractionText ? (displayInches ? " " : "-") + fractionText : "");
    return (negative ? "-" : "") + text;
  }

  function lengthDisplayMeta(unit, format) {
    return format ? { format } : unit === "ft" || unit === "in" ? { format: "decimal" } : {};
  }

  function repeatedUnitTarget(current, unit) {
    const map = REPEATED_UNIT_MAP[unit];
    if (!map || !current) {
      return "";
    }
    if (current.dimension === "length" && current.unit === unit) {
      return map.area;
    }
    if (current.dimension === "area" && current.unit === map.area) {
      return map.volume;
    }
    if (current.dimension === "volume" && current.unit === map.volume) {
      return unit;
    }
    return "";
  }

  function isWholeDisplayValue(value, unit) {
    const def = UNIT_DEFS[unit];
    if (!value || !def) {
      return false;
    }
    const display = value.baseValue / def.factor;
    return Math.abs(display - Math.round(display)) < EPSILON;
  }

  function toggleLengthDisplayFormat(current, unit) {
    if (!current || current.dimension !== "length" || current.unit !== unit) {
      return false;
    }
    const meta = current.meta || {};
    if (unit === "ft") {
      current.meta = Object.assign({}, meta, {
        format: meta.format === "feet-inch" ? "decimal" : "feet-inch",
        showZeroFeet: meta.format === "feet-inch" ? false : true
      });
      return true;
    }
    if (unit === "in") {
      current.meta = Object.assign({}, meta, {
        format: meta.format === "inch-fraction" ? "decimal" : "inch-fraction",
        forceInches: meta.format === "inch-fraction" ? false : true
      });
      return true;
    }
    return false;
  }

  function lengthConversionMetaForUnit(unit) {
    if (unit === "in") {
      return { format: "inch-fraction", forceInches: true };
    }
    if (unit === "ft") {
      return { format: "decimal" };
    }
    return lengthDisplayMeta(unit, "decimal");
  }

  function formatValue(value, preferences) {
    if (!value) {
      return { main: "0", unit: "", mode: "READY" };
    }
    const prefs = preferences || {};
    let unit = value.unit || DIMENSION_DEFAULT_UNIT[value.dimension] || "scalar";
    const meta = value.meta || {};
    if (value.dimension === "area" && prefs.areaDisplay && prefs.areaDisplay !== "standard" && UNIT_DEFS[prefs.areaDisplay]) {
      unit = prefs.areaDisplay;
    }
    if (value.dimension === "volume" && prefs.volumeDisplay && prefs.volumeDisplay !== "standard" && UNIT_DEFS[prefs.volumeDisplay]) {
      unit = prefs.volumeDisplay;
    }
    const def = UNIT_DEFS[unit] || UNIT_DEFS.scalar;
    const precision = typeof meta.precision === "number"
      ? meta.precision
      : unit === "m" || unit === "cm" || unit === "mm"
        ? Number(prefs.meterPrecision) || 3
        : unit === "deg"
          ? Number(prefs.degreePrecision) || 2
          : value.dimension === "area" || value.dimension === "volume"
            ? 6
            : prefs.precision || 5;
    const formatPrefs = Object.assign({}, prefs);
    if (meta.noTrailingDecimal) {
      formatPrefs.trailingDecimalForWholeNumbers = false;
    }
    if (value.dimension === "scalar" && prefs.unitlessDisplay === "fixed") {
      formatPrefs.fixedDecimalPlaces = true;
    }
    const fractionOptions = Object.assign({}, meta, { fractionMode: prefs.fractionMode });
    if (value.dimension === "length" && unit === "ft" && meta.format === "feet-inch") {
      return { main: inchesToFeetInches(value.baseValue, prefs.fractionDenominator || 16, fractionOptions), unit: "FEET INCH", mode: "LENGTH" };
    }
    if (value.dimension === "length" && unit === "in" && meta.format === "inch-fraction" && (Math.abs(value.baseValue) < 12 || meta.forceInches)) {
      return { main: inchesToInchesFraction(value.baseValue, prefs.fractionDenominator || 16, fractionOptions), unit: meta.unitLabel || "IN", mode: "LENGTH" };
    }
    if (value.dimension === "length" && unit === "in" && Math.abs(value.baseValue) >= 12 && meta.format !== "decimal") {
      return { main: inchesToFeetInches(value.baseValue, prefs.fractionDenominator || 16, fractionOptions), unit: "FEET INCH", mode: "LENGTH" };
    }
    const display = value.baseValue / def.factor;
    return { main: formatNumber(display, precision, formatPrefs), unit: meta.unitLabel || displayUnitLabel(unit, def), mode: String(value.dimension || "scalar").toUpperCase() };
  }

  function parseNumberBuffer(buffer) {
    if (!buffer || buffer === "-" || buffer === ".") {
      return 0;
    }
    return Number(buffer);
  }

  function pendingFractionValue(state, targetUnit, useDefaultDenominator) {
    if (state.pendingFractionNumerator === null) {
      return null;
    }
    const denominator = state.inputBuffer === ""
      ? (useDefaultDenominator ? state.preferences.fractionDenominator || 16 : null)
      : parseNumberBuffer(state.inputBuffer);
    if (!Number.isFinite(denominator) || Math.abs(denominator) < EPSILON) {
      throw new Error("Invalid fraction");
    }
    const fractionInches = state.pendingFractionNumerator / denominator;
    if (state.pendingFractionBase && state.pendingFractionBase.dimension === "length") {
      const base = cloneValue(state.pendingFractionBase);
      base.baseValue += fractionInches;
      if (base.unit === "ft" || Math.abs(base.baseValue) >= 12) {
        base.unit = "ft";
        base.meta = Object.assign({}, base.meta || {}, { format: "feet-inch" });
      } else {
        base.unit = "in";
        base.meta = Object.assign({}, base.meta || {}, { format: "inch-fraction" });
      }
      return base;
    }
    const unit = targetUnit === "ft" ? "ft" : "in";
    return valueFromDisplay(fractionInches, unit, unit === "in" ? { format: "inch-fraction" } : { format: "decimal" });
  }

  function createState() {
    return {
      inputBuffer: "",
      pendingFractionNumerator: null,
      pendingFractionBase: null,
      preInputValue: null,
      compound: { feet: null, inches: null },
      current: makeValue(0, "scalar", "scalar"),
      accumulator: null,
      pendingOperator: null,
      registers: {},
      memory: null,
      conversionMode: false,
      conversionLocked: false,
      error: "",
      status: "",
      history: [],
      lastFunction: "",
      lastUnitEntry: "",
      preferences: {
        fractionDenominator: 16,
        precision: 5,
        concreteWaste: 5,
        drywallWaste: 10,
        studSpacing: 16,
        stairRiserLimit: 7.75,
        treadDepth: 10,
        springAngle: 38,
        sound: false,
        haptic: true,
        fullScreenMode: true,
        trigMode: false,
        legacyMode: false,
        fractionMode: "standard",
        exponential: false,
        areaDisplay: "standard",
        volumeDisplay: "standard",
        meterPrecision: 3,
        degreePrecision: 2,
        commaSeparator: true,
        unitlessDisplay: "float",
        rakeWallOrder: "descending",
        archedWallSide: "outside",
        jackOrder: "descending",
        irregularJackMode: "on-center",
        headroomHeight: 80,
        floorThickness: 10,
        blockArea: 128,
        blockLength: 16,
        footingArea: 264,
        weightPerVolume: 1.5,
        themeContrast: "standard"
      }
    };
  }

  function CalculatorEngine(savedPreferences, savedHistory) {
    this.state = createState();
    this.state.preferences = Object.assign(this.state.preferences, savedPreferences || {});
    this.state.history = Array.isArray(savedHistory) ? savedHistory.slice(0, 50) : [];
  }

  CalculatorEngine.prototype.snapshot = function() {
    return JSON.parse(JSON.stringify(this.state));
  };

  CalculatorEngine.prototype.restore = function(state) {
    this.state = state || createState();
  };

  CalculatorEngine.prototype.clearError = function() {
    this.state.error = "";
  };

  CalculatorEngine.prototype.setError = function(message) {
    this.state.error = message || "Error";
    this.state.status = this.state.error;
  };

  CalculatorEngine.prototype.addHistory = function(label, value) {
    const formatted = typeof value === "string" ? value : formatValue(value, this.state.preferences).main + " " + formatValue(value, this.state.preferences).unit;
    this.state.history.unshift({
      label,
      value: formatted.trim(),
      timestamp: new Date().toISOString()
    });
    this.state.history = this.state.history.slice(0, 60);
  };

  CalculatorEngine.prototype.getDisplay = function() {
    let displayValue = this.state.current;
    if (this.state.pendingFractionNumerator !== null) {
      try {
        displayValue = pendingFractionValue(this.state, "in", true) || this.state.current;
      } catch (error) {
        displayValue = this.state.current;
      }
    }
    const formatted = formatValue(displayValue, this.state.preferences);
    return {
      main: this.state.inputBuffer && this.state.current.dimension === "scalar" && this.state.pendingFractionNumerator === null ? this.state.inputBuffer : formatted.main,
      unit: formatted.unit,
      mode: displayModeLabel(this.state, formatted, displayValue),
      expression: this.state.pendingOperator && this.state.accumulator ? formatValue(this.state.accumulator, this.state.preferences).main + " " + this.state.pendingOperator : "",
      conversionMode: this.state.conversionMode,
      registers: Object.assign({}, this.state.registers),
      history: this.state.history.slice()
    };
  };

  CalculatorEngine.prototype.commitInputAsScalar = function() {
    if (this.state.pendingFractionNumerator !== null) {
      try {
        this.state.current = pendingFractionValue(this.state, "in", true);
      } catch (error) {
        this.setError(error.message);
      }
      this.state.pendingFractionNumerator = null;
      this.state.pendingFractionBase = null;
      this.state.preInputValue = null;
      this.state.inputBuffer = "";
      this.state.status = "";
      return this.state.current;
    }
    if (this.state.inputBuffer !== "") {
      this.state.current = makeValue(parseNumberBuffer(this.state.inputBuffer), "scalar", "scalar");
      this.state.inputBuffer = "";
    }
    this.state.pendingFractionNumerator = null;
    this.state.pendingFractionBase = null;
    this.state.preInputValue = null;
    return this.state.current;
  };

  CalculatorEngine.prototype.pressDigit = function(digit) {
    this.clearError();
    const text = String(digit);
    if (this.state.pendingFractionNumerator !== null) {
      this.state.inputBuffer += text;
      try {
        const preview = pendingFractionValue(this.state, "in", true);
        if (preview) {
          this.state.current = preview;
        }
      } catch (error) {
        this.setError(error.message);
      }
      return;
    }
    if (this.state.inputBuffer === "" && this.state.current && this.state.current.dimension !== "scalar" && (!this.state.pendingOperator || this.state.preInputValue)) {
      this.state.preInputValue = cloneValue(this.state.current);
    } else if (this.state.inputBuffer === "") {
      this.state.preInputValue = null;
    }
    if (this.state.inputBuffer === "0") {
      this.state.inputBuffer = text;
    } else {
      this.state.inputBuffer += text;
    }
    this.state.current = makeValue(parseNumberBuffer(this.state.inputBuffer), "scalar", "scalar");
    this.state.lastUnitEntry = "";
  };

  CalculatorEngine.prototype.pressDecimal = function() {
    this.clearError();
    if (this.state.inputBuffer === "" && this.state.current && this.state.current.dimension !== "scalar" && (!this.state.pendingOperator || this.state.preInputValue)) {
      this.state.preInputValue = cloneValue(this.state.current);
    } else if (this.state.inputBuffer === "") {
      this.state.preInputValue = null;
    }
    if (!this.state.inputBuffer.includes(".")) {
      this.state.inputBuffer = this.state.inputBuffer ? this.state.inputBuffer + "." : "0.";
    }
    this.state.current = makeValue(parseNumberBuffer(this.state.inputBuffer), "scalar", "scalar");
    this.state.lastUnitEntry = "";
  };

  CalculatorEngine.prototype.pressFraction = function() {
    this.clearError();
    const number = parseNumberBuffer(this.state.inputBuffer);
    if (!Number.isFinite(number)) {
      this.setError("Invalid fraction");
      return;
    }
    this.state.pendingFractionNumerator = number;
    this.state.pendingFractionBase = this.state.preInputValue && this.state.preInputValue.dimension === "length" ? cloneValue(this.state.preInputValue) : null;
    this.state.inputBuffer = "";
    this.state.status = "Fraction numerator " + number;
  };

  CalculatorEngine.prototype.applyUnit = function(unit) {
    this.clearError();
    const def = UNIT_DEFS[unit];
    if (!def) {
      this.setError("Unsupported unit");
      return;
    }
    if (this.state.pendingFractionNumerator !== null) {
      try {
        this.state.current = pendingFractionValue(this.state, unit, true);
      } catch (error) {
        this.setError(error.message);
        return;
      }
      this.state.pendingFractionNumerator = null;
      this.state.pendingFractionBase = null;
      this.state.preInputValue = null;
      this.state.inputBuffer = "";
      this.state.lastUnitEntry = unit;
      return;
    }

    if (this.state.inputBuffer === "") {
      if (this.state.current && this.state.current.dimension === "length" && this.state.current.unit === unit) {
        if (this.state.lastUnitEntry !== unit || !isWholeDisplayValue(this.state.current, unit)) {
          toggleLengthDisplayFormat(this.state.current, unit);
          this.state.lastUnitEntry = "";
          return;
        }
      }
      const repeatedTarget = this.state.lastUnitEntry === unit ? repeatedUnitTarget(this.state.current, unit) : "";
      if (repeatedTarget) {
        const currentDisplay = convertDisplay(this.state.current, this.state.current.unit);
        this.state.current = valueFromDisplay(currentDisplay, repeatedTarget);
        this.state.compound = { feet: null, inches: null };
        this.state.preInputValue = null;
        this.state.lastUnitEntry = unit;
        return;
      }
      if (this.state.current && this.state.current.dimension !== "scalar" && def.dimension === this.state.current.dimension) {
        this.state.current.unit = unit;
        this.state.current.meta = Object.assign({}, this.state.current.meta || {}, lengthConversionMetaForUnit(unit));
        this.state.compound = { feet: null, inches: null };
        this.state.preInputValue = null;
        this.state.lastUnitEntry = "";
        return;
      }
      if (this.state.current && this.state.current.dimension === "area" && def.dimension === "length") {
        const areaUnit = REPEATED_UNIT_MAP[unit] && REPEATED_UNIT_MAP[unit].area;
        if (areaUnit) {
          this.state.current.unit = areaUnit;
          this.state.compound = { feet: null, inches: null };
          this.state.preInputValue = null;
          this.state.lastUnitEntry = "";
          return;
        }
      }
      if (this.state.current && this.state.current.dimension === "volume" && def.dimension === "length") {
        const volumeUnit = REPEATED_UNIT_MAP[unit] && REPEATED_UNIT_MAP[unit].volume;
        if (volumeUnit) {
          this.state.current.unit = volumeUnit;
          this.state.compound = { feet: null, inches: null };
          this.state.preInputValue = null;
          this.state.lastUnitEntry = "";
          return;
        }
      }
    }

    const number = this.state.inputBuffer !== "" ? parseNumberBuffer(this.state.inputBuffer) : convertDisplay(this.state.current, this.state.current.unit || DIMENSION_DEFAULT_UNIT[this.state.current.dimension]);
    if (unit === "ft") {
      this.state.compound.feet = number;
      this.state.current = valueFromDisplay(number, "ft", { format: "decimal" });
      this.state.inputBuffer = "";
      this.state.preInputValue = cloneValue(this.state.current);
      this.state.lastUnitEntry = "ft";
      return;
    }
    if (unit === "in" && this.state.compound.feet !== null) {
      this.state.compound.inches = number;
      this.state.current = valueFromDisplay(this.state.compound.feet * 12 + number, "in", { format: "feet-inch" });
      this.state.current.unit = "ft";
      this.state.compound = { feet: null, inches: null };
      this.state.inputBuffer = "";
      this.state.preInputValue = cloneValue(this.state.current);
      this.state.lastUnitEntry = "";
      return;
    }
    this.state.current = valueFromDisplay(number, unit, lengthDisplayMeta(unit, "decimal"));
    this.state.inputBuffer = "";
    this.state.preInputValue = this.state.current.dimension === "length" ? cloneValue(this.state.current) : null;
    this.state.lastUnitEntry = unit;
  };

  CalculatorEngine.prototype.convertCurrent = function(unit) {
    this.clearError();
    this.commitInputAsScalar();
    const def = UNIT_DEFS[unit];
    if (!def) {
      this.setError("Unsupported conversion");
      return;
    }
    try {
      if (this.state.current.dimension === "scalar" && def.dimension !== "scalar") {
        this.state.current = valueFromDisplay(this.state.current.baseValue, unit, lengthDisplayMeta(unit, "decimal"));
        this.state.lastUnitEntry = unit;
        this.addHistory("Entered " + def.label, this.state.current);
        return;
      }
      if (this.state.current.dimension === "length" && def.dimension === "area") {
        this.setError("Use x for area first");
        return;
      }
      if (this.state.current.dimension === def.dimension || (this.state.current.dimension === "scalar" && def.dimension === "scalar")) {
        this.state.current.unit = unit;
        if (this.state.current.dimension === "length" && unit === "ft") {
          const wasFeetInch = this.state.current.meta && this.state.current.meta.format === "feet-inch";
          this.state.current.meta = Object.assign({}, this.state.current.meta || {}, { format: wasFeetInch ? "decimal" : "feet-inch", showZeroFeet: wasFeetInch ? false : true });
        } else if (this.state.current.dimension === "length" && unit === "in") {
          const wasFraction = this.state.current.meta && this.state.current.meta.format === "inch-fraction";
          this.state.current.meta = Object.assign({}, this.state.current.meta || {}, { format: wasFraction ? "decimal" : "inch-fraction", forceInches: wasFraction ? false : true });
        } else if (this.state.current.dimension === "length") {
          this.state.current.meta = Object.assign({}, this.state.current.meta || {}, { format: "decimal" });
        }
        this.state.lastUnitEntry = "";
        this.addHistory("Converted to " + def.label, this.state.current);
      } else {
        this.setError("Incompatible units");
      }
    } catch (error) {
      this.setError(error.message);
    }
  };

  CalculatorEngine.prototype.convertVolumeToWeight = function(unit) {
    this.clearError();
    this.commitInputAsScalar();
    const def = UNIT_DEFS[unit];
    if (!def || def.dimension !== "weight") {
      this.setError("Unsupported weight conversion");
      return;
    }
    try {
      if (this.state.current.dimension === "weight") {
        this.convertCurrent(unit);
        return;
      }
      if (this.state.current.dimension !== "volume") {
        this.setError("Need volume for weight conversion");
        return;
      }
      const tonsPerCubicYard = Number(this.state.preferences.weightPerVolume) || 1.5;
      const cubicYards = this.state.current.baseValue / UNIT_DEFS.cuyd.factor;
      const pounds = cubicYards * tonsPerCubicYard * UNIT_DEFS.ton.factor;
      this.state.current = makeValue(pounds, "weight", unit);
      this.state.lastUnitEntry = "";
      this.addHistory("Converted volume to " + def.label, this.state.current);
    } catch (error) {
      this.setError(error.message);
    }
  };

  CalculatorEngine.prototype.pressOperator = function(operator) {
    this.clearError();
    this.commitInputAsScalar();
    this.state.compound = { feet: null, inches: null };
    if (this.state.pendingOperator && this.state.accumulator) {
      try {
        this.state.accumulator = operate(this.state.accumulator, this.state.pendingOperator, this.state.current);
        this.state.current = cloneValue(this.state.accumulator);
      } catch (error) {
        this.setError(error.message);
        return;
      }
    } else {
      this.state.accumulator = cloneValue(this.state.current);
    }
    this.state.pendingOperator = operator;
    this.state.inputBuffer = "";
    this.state.preInputValue = null;
    this.state.lastUnitEntry = "";
    this.state.status = "";
  };

  CalculatorEngine.prototype.equals = function() {
    this.clearError();
    this.commitInputAsScalar();
    if (!this.state.pendingOperator) {
      return;
    }
    try {
      const result = operate(this.state.accumulator, this.state.pendingOperator, this.state.current);
      this.addHistory("Result", result);
      this.state.current = result;
      this.state.accumulator = null;
      this.state.pendingOperator = null;
      this.state.preInputValue = null;
      this.state.lastUnitEntry = "";
    } catch (error) {
      this.setError(error.message);
    }
  };

  CalculatorEngine.prototype.clear = function() {
    this.state.inputBuffer = "";
    this.state.pendingFractionNumerator = null;
    this.state.pendingFractionBase = null;
    this.state.preInputValue = null;
    this.state.compound = { feet: null, inches: null };
    this.state.current = makeValue(0, "scalar", "scalar");
    this.state.lastUnitEntry = "";
    this.clearError();
    this.state.status = "";
  };

  CalculatorEngine.prototype.clearAll = function() {
    const preferences = this.state.preferences;
    const history = this.state.history;
    this.state = createState();
    this.state.preferences = preferences;
    this.state.history = history;
  };

  CalculatorEngine.prototype.toggleSign = function() {
    this.clearError();
    if (this.state.inputBuffer) {
      this.state.inputBuffer = String(-parseNumberBuffer(this.state.inputBuffer));
      this.state.current = makeValue(parseNumberBuffer(this.state.inputBuffer), "scalar", "scalar");
      return;
    }
    this.state.current.baseValue *= -1;
  };

  CalculatorEngine.prototype.percent = function() {
    this.clearError();
    this.commitInputAsScalar();
    if (this.state.pendingOperator && this.state.accumulator && (this.state.pendingOperator === "+" || this.state.pendingOperator === "-")) {
      this.state.current = makeValue(this.state.accumulator.baseValue * (this.state.current.baseValue / 100), this.state.accumulator.dimension, this.state.accumulator.unit);
      this.equals();
      return;
    }
    this.state.current = makeValue(this.state.current.baseValue / 100, "scalar", "percent");
  };

  CalculatorEngine.prototype.square = function() {
    this.clearError();
    this.commitInputAsScalar();
    try {
      this.state.current = multiplyValues(this.state.current, this.state.current);
      this.addHistory("Square", this.state.current);
    } catch (error) {
      this.setError(error.message);
    }
  };

  CalculatorEngine.prototype.squareRoot = function() {
    this.clearError();
    this.commitInputAsScalar();
    if (this.state.current.baseValue < 0) {
      this.setError("Negative square root");
      return;
    }
    if (this.state.current.dimension === "area") {
      this.state.current = makeValue(Math.sqrt(this.state.current.baseValue), "length", "ft");
    } else if (this.state.current.dimension === "scalar") {
      this.state.current = makeValue(Math.sqrt(this.state.current.baseValue), "scalar", "scalar");
    } else {
      this.setError("Square root needs scalar or area");
    }
  };

  CalculatorEngine.prototype.reciprocal = function() {
    this.clearError();
    this.commitInputAsScalar();
    if (Math.abs(this.state.current.baseValue) < EPSILON) {
      this.setError("Divide by zero");
      return;
    }
    if (this.state.current.dimension !== "scalar") {
      this.setError("Reciprocal needs scalar");
      return;
    }
    this.state.current = makeValue(1 / this.state.current.baseValue, "scalar", "scalar");
  };

  CalculatorEngine.prototype.pi = function() {
    this.state.current = makeValue(Math.PI, "scalar", "scalar");
    this.state.inputBuffer = "";
  };

  CalculatorEngine.prototype.storeRegister = function(name) {
    this.clearError();
    this.commitInputAsScalar();
    this.state.registers[name] = cloneValue(this.state.current);
    this.state.status = name + " stored";
  };

  CalculatorEngine.prototype.recallRegister = function(name) {
    const value = this.state.registers[name];
    if (!value) {
      this.setError("Missing " + name);
      return null;
    }
    this.state.current = cloneValue(value);
    this.state.inputBuffer = "";
    this.state.status = name + " recalled";
    return this.state.current;
  };

  CalculatorEngine.prototype.handleRegisterKey = function(name) {
    if (this.state.inputBuffer || (this.state.current && Math.abs(this.state.current.baseValue) > EPSILON)) {
      this.storeRegister(name);
    } else {
      this.recallRegister(name);
    }
  };

  CalculatorEngine.prototype.storeMemory = function() {
    this.commitInputAsScalar();
    this.state.memory = cloneValue(this.state.current);
    this.state.status = "Memory stored";
  };

  CalculatorEngine.prototype.recallMemory = function() {
    if (!this.state.memory) {
      this.setError("Memory empty");
      return;
    }
    this.state.current = cloneValue(this.state.memory);
    this.state.inputBuffer = "";
    this.state.status = "Memory recalled";
  };

  CalculatorEngine.prototype.memoryPlus = function(sign) {
    this.commitInputAsScalar();
    if (!this.state.memory) {
      this.state.memory = cloneValue(this.state.current);
    } else {
      try {
        this.state.memory = addValues(this.state.memory, this.state.current, sign || 1);
      } catch (error) {
        this.setError(error.message);
      }
    }
    this.state.status = sign === -1 ? "Memory minus" : "Memory plus";
  };

  CalculatorEngine.prototype.memoryClear = function() {
    this.state.memory = null;
    this.state.status = "Memory cleared";
  };

  CalculatorEngine.prototype.toDisplayUnit = function(preferred) {
    this.commitInputAsScalar();
    if (preferred) {
      this.convertCurrent(preferred);
    }
  };

  CalculatorEngine.prototype.getRegister = function(name) {
    return this.state.registers[name] ? cloneValue(this.state.registers[name]) : null;
  };

  CalculatorEngine.prototype.setCurrent = function(value, label) {
    this.state.current = cloneValue(value);
    this.state.inputBuffer = "";
    this.state.status = label || "";
    if (label) {
      this.addHistory(label, value);
    }
  };

  CalculatorEngine.prototype.updatePreferences = function(prefs) {
    this.state.preferences = Object.assign(this.state.preferences, prefs || {});
  };

  CalculatorEngine.prototype.setFractionResolution = function(denominator) {
    const allowed = [2, 4, 8, 16, 32, 64];
    const value = Number(denominator);
    if (!allowed.includes(value)) {
      this.setError("Invalid fraction resolution");
      return;
    }
    this.updatePreferences({ fractionDenominator: value });
    this.state.status = "Fraction resolution 1/" + value;
  };

  function assertFinite(value) {
    if (!Number.isFinite(value)) {
      throw new Error("Invalid result");
    }
    return value;
  }

  global.JgcCalculatorEngine = {
    CalculatorEngine,
    UNIT_DEFS,
    REGISTER_KEYS,
    makeValue,
    valueFromDisplay,
    convertDisplay,
    operate,
    formatValue,
    inchesToFeetInches,
    inchesToInchesFraction,
    roundForDisplay,
    assertFinite,
    constants: { INCHES_PER_METER }
  };
})(typeof window !== "undefined" ? window : globalThis);
