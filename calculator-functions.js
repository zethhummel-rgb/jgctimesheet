(function(global) {
  "use strict";

  const Engine = global.JgcCalculatorEngine;
  const PI = Math.PI;

  function requireValue(engine, name) {
    const value = engine.getRegister(name);
    if (!value) {
      throw new Error("Missing " + name);
    }
    return value;
  }

  function requireLength(engine, name) {
    const value = requireValue(engine, name);
    if (value.dimension !== "length") {
      throw new Error(name + " must be a length");
    }
    if (value.baseValue < 0) {
      throw new Error(name + " cannot be negative");
    }
    return value.baseValue;
  }

  function currentAsNumber(engine) {
    engine.commitInputAsScalar();
    if (!engine.state.current) {
      return 0;
    }
    return engine.state.current.baseValue;
  }

  function currentAsLengthInches(engine) {
    engine.commitInputAsScalar();
    if (!engine.state.current || engine.state.current.dimension !== "length") {
      throw new Error("Current value must be a length");
    }
    return engine.state.current.baseValue;
  }

  function setResult(engine, value, label) {
    engine.setCurrent(value, label);
    return value;
  }

  function formatValue(value, prefs) {
    const formatted = Engine.formatValue(value, prefs || {});
    return (formatted.main + " " + formatted.unit).trim();
  }

  function roofFromRiseRun(rise, run) {
    if (!run) {
      throw new Error("Run is required");
    }
    const pitch = rise / run * 12;
    const angle = Math.atan(rise / run) * 180 / PI;
    const slope = rise / run * 100;
    const diag = Math.sqrt(rise * rise + run * run);
    const commonFactor = Math.sqrt(12 * 12 + pitch * pitch) / 12;
    const hipFactor = Math.sqrt(12 * 12 + 12 * 12 + pitch * pitch) / 12;
    return { pitch, angle, slope, diag, commonFactor, hipFactor };
  }

  function pitchPrimary(engine) {
    try {
      const rise = requireLength(engine, "rise");
      const run = requireLength(engine, "run");
      const roof = roofFromRiseRun(rise, run);
      const cycle = (engine.state.lastFunction === "pitch" ? (engine.state.pitchCycle || 0) + 1 : 0) % 3;
      engine.state.pitchCycle = cycle;
      engine.state.lastFunction = "pitch";
      if (cycle === 1) {
        return setResult(engine, Engine.makeValue(roof.angle, "angle", "deg"), "Roof angle");
      }
      if (cycle === 2) {
        return setResult(engine, Engine.makeValue(roof.slope, "scalar", "percent"), "Roof slope percent");
      }
      return setResult(engine, Engine.makeValue(roof.pitch, "scalar", "scalar", { pitch: true }), "Pitch " + Engine.roundForDisplay(roof.pitch, 3) + "/12");
    } catch (error) {
      engine.setError(error.message);
    }
  }

  function risePrimary(engine) {
    try {
      const pitch = engine.getRegister("pitch");
      const run = requireLength(engine, "run");
      if (!pitch) {
        engine.handleRegisterKey("rise");
        return;
      }
      const rise = run * (pitch.baseValue / 12);
      return setResult(engine, Engine.makeValue(rise, "length", "ft"), "Rise from pitch");
    } catch (error) {
      engine.setError(error.message);
    }
  }

  function runPrimary(engine) {
    try {
      const pitch = engine.getRegister("pitch");
      const rise = requireLength(engine, "rise");
      if (!pitch || !pitch.baseValue) {
        engine.handleRegisterKey("run");
        return;
      }
      const run = rise / (pitch.baseValue / 12);
      return setResult(engine, Engine.makeValue(run, "length", "ft"), "Run from pitch");
    } catch (error) {
      engine.setError(error.message);
    }
  }

  function diagPrimary(engine) {
    try {
      const rise = requireLength(engine, "rise");
      const run = requireLength(engine, "run");
      const roof = roofFromRiseRun(rise, run);
      return setResult(engine, Engine.makeValue(roof.diag, "length", "ft"), "Common rafter");
    } catch (error) {
      engine.setError(error.message);
    }
  }

  function hipValley(engine) {
    try {
      const rise = requireLength(engine, "rise");
      const run = requireLength(engine, "run");
      const hipRun = Math.sqrt(run * run * 2);
      const hip = Math.sqrt(rise * rise + hipRun * hipRun);
      return setResult(engine, Engine.makeValue(hip, "length", "ft"), "Hip / valley");
    } catch (error) {
      engine.setError(error.message);
    }
  }

  function roofSummary(engine) {
    try {
      const rise = requireLength(engine, "rise");
      const run = requireLength(engine, "run");
      const roof = roofFromRiseRun(rise, run);
      const rows = [
        ["Pitch", Engine.roundForDisplay(roof.pitch, 3) + "/12"],
        ["Angle", Engine.roundForDisplay(roof.angle, 3) + "\u00b0"],
        ["Slope", Engine.roundForDisplay(roof.slope, 3) + "%"],
        ["Rise", formatValue(Engine.makeValue(rise, "length", "ft"), engine.state.preferences)],
        ["Run", formatValue(Engine.makeValue(run, "length", "ft"), engine.state.preferences)],
        ["Common rafter", formatValue(Engine.makeValue(roof.diag, "length", "ft"), engine.state.preferences)],
        ["Common factor", Engine.roundForDisplay(roof.commonFactor, 4)],
        ["Hip factor", Engine.roundForDisplay(roof.hipFactor, 4)]
      ];
      engine.state.status = "Roof summary ready";
      engine.addHistory("Roof summary", rows.map((row) => row.join(": ")).join(" | "));
      return rows;
    } catch (error) {
      engine.setError(error.message);
      return [];
    }
  }

  function stair(engine) {
    try {
      const totalRise = requireLength(engine, "rise");
      const maxRiser = engine.state.preferences.stairRiserLimit || 7.75;
      const treadDepth = engine.state.preferences.treadDepth || 10;
      const risers = Math.ceil(totalRise / maxRiser);
      if (risers <= 0) {
        throw new Error("Invalid stair rise");
      }
      const actualRiser = totalRise / risers;
      const treads = Math.max(risers - 1, 0);
      const totalRun = treads * treadDepth;
      const angle = Math.atan(totalRise / totalRun) * 180 / PI;
      const stringer = Math.sqrt(totalRise * totalRise + totalRun * totalRun);
      const rows = [
        ["Risers", String(risers)],
        ["Actual riser", Engine.inchesToFeetInches(actualRiser, engine.state.preferences.fractionDenominator || 16)],
        ["Treads", String(treads)],
        ["Total run", Engine.inchesToFeetInches(totalRun, engine.state.preferences.fractionDenominator || 16)],
        ["Stair angle", Engine.roundForDisplay(angle, 3) + "\u00b0"],
        ["Stringer", Engine.inchesToFeetInches(stringer, engine.state.preferences.fractionDenominator || 16)],
        ["Note", "Estimating tool only. Verify local building-code requirements."]
      ];
      engine.setCurrent(Engine.makeValue(actualRiser, "length", "in"), "Stair riser");
      engine.addHistory("Stair", rows.map((row) => row.join(": ")).join(" | "));
      return rows;
    } catch (error) {
      engine.setError(error.message);
      return [];
    }
  }

  function setRiserLimit(engine) {
    try {
      const inches = currentAsLengthInches(engine);
      engine.updatePreferences({ stairRiserLimit: inches });
      engine.state.status = "Riser limit set";
    } catch (error) {
      const number = currentAsNumber(engine);
      if (number > 0) {
        engine.updatePreferences({ stairRiserLimit: number });
        engine.state.status = "Riser limit set";
      } else {
        engine.setError(error.message);
      }
    }
  }

  function circle(engine) {
    try {
      let radius = engine.getRegister("radius");
      if (!radius) {
        const current = engine.state.current;
        if (current && current.dimension === "length" && current.baseValue > 0) {
          radius = current;
        }
      }
      if (!radius) {
        throw new Error("Missing radius");
      }
      const r = radius.baseValue;
      const circumference = 2 * PI * r;
      const area = PI * r * r;
      const rows = [
        ["Radius", Engine.roundForDisplay(r / 12, 4) + " FT"],
        ["Diameter", Engine.roundForDisplay((r * 2) / 12, 4) + " FT"],
        ["Circumference", Engine.roundForDisplay(circumference / 12, 4) + " FT"],
        ["Area", formatValue(Engine.makeValue(area, "area", "sqft"), engine.state.preferences)]
      ];
      engine.setCurrent(Engine.makeValue(area, "area", "sqft"), "Circle area");
      engine.addHistory("Circle", rows.map((row) => row.join(": ")).join(" | "));
      return rows;
    } catch (error) {
      engine.setError(error.message);
      return [];
    }
  }

  function arc(engine) {
    try {
      const radius = requireLength(engine, "radius");
      const angleValue = engine.getRegister("springAngle") || (engine.state.current && engine.state.current.dimension === "angle" ? engine.state.current : null);
      const angle = angleValue ? angleValue.baseValue : currentAsNumber(engine);
      if (!angle) {
        throw new Error("Missing angle");
      }
      const radians = angle * PI / 180;
      const arcLength = radius * radians;
      const chord = 2 * radius * Math.sin(radians / 2);
      const sectorArea = (angle / 360) * PI * radius * radius;
      const rows = [
        ["Arc length", Engine.roundForDisplay(arcLength / 12, 4) + " FT"],
        ["Chord", Engine.roundForDisplay(chord / 12, 4) + " FT"],
        ["Sector area", formatValue(Engine.makeValue(sectorArea, "area", "sqft"), engine.state.preferences)]
      ];
      engine.setCurrent(Engine.makeValue(arcLength, "length", "ft"), "Arc length");
      engine.addHistory("Arc", rows.map((row) => row.join(": ")).join(" | "));
      return rows;
    } catch (error) {
      engine.setError(error.message);
      return [];
    }
  }

  function columnCone(engine, isCone) {
    try {
      const radiusValue = engine.getRegister("radius");
      const height = requireLength(engine, "height");
      if (!radiusValue) {
        throw new Error("Missing radius");
      }
      const radius = radiusValue.baseValue;
      let volume = PI * radius * radius * height;
      if (isCone) {
        volume /= 3;
      }
      const rows = [
        [isCone ? "Cone volume" : "Column volume", formatValue(Engine.makeValue(volume, "volume", "cuft"), engine.state.preferences)],
        ["Cubic yards", Engine.roundForDisplay(volume / 46656, 5) + " CU YD"],
        ["Cubic meters", Engine.roundForDisplay(volume / (Engine.constants.INCHES_PER_METER ** 3), 5) + " CU M"]
      ];
      engine.setCurrent(Engine.makeValue(volume, "volume", "cuft"), isCone ? "Cone volume" : "Column volume");
      return rows;
    } catch (error) {
      engine.setError(error.message);
      return [];
    }
  }

  function concrete(engine) {
    try {
      const length = requireLength(engine, "length");
      const width = requireLength(engine, "width");
      const height = requireLength(engine, "height");
      const waste = (engine.state.preferences.concreteWaste || 0) / 100;
      const volume = length * width * height;
      const adjusted = volume * (1 + waste);
      const rows = [
        ["Cubic feet", Engine.roundForDisplay(volume / 1728, 5) + " CU FT"],
        ["Cubic yards", Engine.roundForDisplay(volume / 46656, 5) + " CU YD"],
        ["Cubic meters", Engine.roundForDisplay(volume / (Engine.constants.INCHES_PER_METER ** 3), 5) + " CU M"],
        ["With waste", Engine.roundForDisplay(adjusted / 46656, 5) + " CU YD"]
      ];
      engine.setCurrent(Engine.makeValue(volume, "volume", "cuyd"), "Concrete volume");
      engine.addHistory("Concrete", rows.map((row) => row.join(": ")).join(" | "));
      return rows;
    } catch (error) {
      engine.setError(error.message);
      return [];
    }
  }

  function drywall(engine) {
    try {
      const length = requireLength(engine, "length");
      const height = requireLength(engine, "height");
      const areaSqFt = length * height / 144;
      const waste = (engine.state.preferences.drywallWaste || 0) / 100;
      const sheetArea = 32;
      const sheets = Math.ceil(areaSqFt * (1 + waste) / sheetArea);
      const rows = [
        ["Area", Engine.roundForDisplay(areaSqFt, 3) + " SQ FT"],
        ["4x8 sheets", String(sheets)],
        ["Waste", Engine.roundForDisplay((engine.state.preferences.drywallWaste || 0), 2) + "%"]
      ];
      engine.setCurrent(Engine.makeValue(areaSqFt * 144, "area", "sqft"), "Drywall area");
      return rows;
    } catch (error) {
      engine.setError(error.message);
      return [];
    }
  }

  function studs(engine) {
    try {
      const length = requireLength(engine, "length");
      const spacing = engine.state.preferences.studSpacing || 16;
      const count = Math.floor(length / spacing) + 1;
      const rows = [
        ["Wall length", formatValue(Engine.makeValue(length, "length", "ft"), engine.state.preferences)],
        ["Spacing", spacing + " IN OC"],
        ["Base studs", String(count)]
      ];
      engine.setCurrent(Engine.makeValue(count, "count", "count"), "Stud count");
      return rows;
    } catch (error) {
      engine.setError(error.message);
      return [];
    }
  }

  function boardFeet(engine) {
    try {
      const thickness = requireLength(engine, "height");
      const width = requireLength(engine, "width");
      const length = requireLength(engine, "length");
      const quantity = engine.state.registers.quantity ? engine.state.registers.quantity.baseValue : 1;
      const boardFeetValue = (thickness * width * (length / 12) * quantity) / 12;
      const rows = [
        ["Board feet", Engine.roundForDisplay(boardFeetValue, 4) + " BD FT"],
        ["Formula", "Thickness(in) x width(in) x length(ft) x qty / 12"]
      ];
      engine.setCurrent(Engine.makeValue(boardFeetValue, "volume-lumber", "boardft"), "Board feet");
      return rows;
    } catch (error) {
      engine.setError(error.message);
      return [];
    }
  }

  function blocks(engine) {
    try {
      const length = requireLength(engine, "length");
      const height = requireLength(engine, "height");
      const wallSqFt = length * height / 144;
      const blockSqFt = (16 * 8) / 144;
      const waste = 1.05;
      const count = Math.ceil((wallSqFt / blockSqFt) * waste);
      const rows = [
        ["Wall area", Engine.roundForDisplay(wallSqFt, 3) + " SQ FT"],
        ["Estimated blocks", String(count)]
      ];
      engine.setCurrent(Engine.makeValue(count, "count", "count"), "Blocks");
      return rows;
    } catch (error) {
      engine.setError(error.message);
      return [];
    }
  }

  function compoundMiter(engine) {
    try {
      const wallAngle = engine.getRegister("springAngle") ? currentAsNumber(engine) || 90 : currentAsNumber(engine) || 90;
      const spring = engine.state.preferences.springAngle || 38;
      const corner = wallAngle / 2 * PI / 180;
      const springRad = spring * PI / 180;
      const miter = Math.atan(Math.cos(springRad) / Math.tan(corner)) * 180 / PI;
      const bevel = Math.asin(Math.sin(springRad) * Math.sin(corner)) * 180 / PI;
      const rows = [
        ["Miter", Engine.roundForDisplay(miter, 3) + "\u00b0"],
        ["Bevel", Engine.roundForDisplay(bevel, 3) + "\u00b0"],
        ["Spring angle", Engine.roundForDisplay(spring, 3) + "\u00b0"]
      ];
      engine.setCurrent(Engine.makeValue(miter, "angle", "deg"), "Compound miter");
      return rows;
    } catch (error) {
      engine.setError(error.message);
      return [];
    }
  }

  function setSpringAngle(engine) {
    const number = currentAsNumber(engine);
    if (number > 0) {
      engine.updatePreferences({ springAngle: number });
      engine.state.registers.springAngle = Engine.makeValue(number, "angle", "deg");
      engine.state.status = "Spring angle set";
    } else {
      engine.setError("Invalid spring angle");
    }
  }

  function polygon(engine) {
    try {
      const sides = Math.round(currentAsNumber(engine));
      const sideLength = requireLength(engine, "length");
      if (sides < 3) {
        throw new Error("Polygon needs at least 3 sides");
      }
      const perimeter = sides * sideLength;
      const area = (sides * sideLength * sideLength) / (4 * Math.tan(PI / sides));
      const interior = ((sides - 2) * 180) / sides;
      const rows = [
        ["Perimeter", formatValue(Engine.makeValue(perimeter, "length", "ft"), engine.state.preferences)],
        ["Area", formatValue(Engine.makeValue(area, "area", "sqft"), engine.state.preferences)],
        ["Interior angle", Engine.roundForDisplay(interior, 3) + "\u00b0"]
      ];
      engine.setCurrent(Engine.makeValue(area, "area", "sqft"), "Polygon area");
      return rows;
    } catch (error) {
      engine.setError(error.message);
      return [];
    }
  }

  function rakeWall(engine) {
    try {
      const startHeight = requireLength(engine, "height");
      const run = requireLength(engine, "run");
      const pitch = engine.getRegister("pitch");
      const spacing = engine.state.preferences.studSpacing || 16;
      if (!pitch) {
        throw new Error("Missing pitch");
      }
      const count = Math.floor(run / spacing) + 1;
      const increment = spacing * (pitch.baseValue / 12);
      const rows = [["Studs", String(count)], ["Increment", Engine.inchesToFeetInches(increment, 16)]];
      for (let i = 0; i < Math.min(count, 20); i += 1) {
        rows.push(["Stud " + (i + 1), Engine.inchesToFeetInches(startHeight + i * increment, 16)]);
      }
      engine.addHistory("Rake wall", rows.map((row) => row.join(": ")).join(" | "));
      engine.state.status = "Rake wall list ready";
      return rows;
    } catch (error) {
      engine.setError(error.message);
      return [];
    }
  }

  function jack(engine) {
    try {
      const pitch = engine.getRegister("pitch");
      const spacing = engine.state.preferences.studSpacing || 16;
      const longest = requireLength(engine, "diag");
      if (!pitch) {
        throw new Error("Missing pitch");
      }
      const factor = Math.sqrt(12 * 12 + pitch.baseValue * pitch.baseValue) / 12;
      const increment = spacing * factor;
      const rows = [["Jack difference", Engine.inchesToFeetInches(increment, 16)]];
      for (let i = 0; i < 12; i += 1) {
        const length = longest - i * increment;
        if (length <= 0) {
          break;
        }
        rows.push(["Jack " + (i + 1), Engine.inchesToFeetInches(length, 16)]);
      }
      engine.setCurrent(Engine.makeValue(increment, "length", "ft"), "Jack increment");
      return rows;
    } catch (error) {
      engine.setError(error.message);
      return [];
    }
  }

  function cost(engine) {
    const unitCost = currentAsNumber(engine);
    const previous = engine.state.accumulator || engine.state.memory;
    if (!previous || !unitCost) {
      engine.setError("Need quantity and unit cost");
      return [];
    }
    const total = previous.baseValue * unitCost;
    engine.setCurrent(Engine.makeValue(total, "currency", "currency"), "Estimated cost");
    return [["Estimated cost", "$" + Engine.roundForDisplay(total, 2)]];
  }

  function dmsDecimal(engine) {
    const value = currentAsNumber(engine);
    const degrees = Math.trunc(value);
    const minutesDecimal = Math.abs(value - degrees) * 60;
    const minutes = Math.trunc(minutesDecimal);
    const seconds = (minutesDecimal - minutes) * 60;
    const text = degrees + "\u00b0 " + minutes + "\u2032 " + Engine.roundForDisplay(seconds, 2) + "\u2033";
    engine.state.status = text;
    engine.addHistory("DMS", text);
    return [["DMS", text]];
  }

  function reciprocalOrError(engine) {
    engine.reciprocal();
    return [];
  }

  global.JgcCalculatorFunctions = {
    pitchPrimary,
    risePrimary,
    runPrimary,
    diagPrimary,
    hipValley,
    roofSummary,
    stair,
    setRiserLimit,
    circle,
    arc,
    columnCone,
    concrete,
    drywall,
    studs,
    boardFeet,
    blocks,
    compoundMiter,
    setSpringAngle,
    polygon,
    rakeWall,
    jack,
    cost,
    dmsDecimal,
    reciprocalOrError
  };
})(typeof window !== "undefined" ? window : globalThis);
