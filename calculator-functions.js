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

  function currentOrRegisterLength(engine, name) {
    engine.commitInputAsScalar();
    if (engine.state.current && engine.state.current.dimension === "length" && engine.state.current.baseValue >= 0) {
      return engine.state.current.baseValue;
    }
    return requireLength(engine, name);
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
      if (!pitch) {
        engine.handleRegisterKey("rise");
        engine.state.lastFunction = "rise";
        return;
      }
      const run = requireLength(engine, "run");
      const rise = run * (pitch.baseValue / 12);
      engine.state.lastFunction = "rise";
      return setResult(engine, Engine.makeValue(rise, "length", "ft"), "Rise from pitch");
    } catch (error) {
      engine.setError(error.message);
    }
  }

  function runPrimary(engine) {
    try {
      const pitch = engine.getRegister("pitch");
      if (!pitch || !pitch.baseValue) {
        engine.handleRegisterKey("run");
        engine.state.lastFunction = "run";
        return;
      }
      const rise = requireLength(engine, "rise");
      const run = rise / (pitch.baseValue / 12);
      engine.state.lastFunction = "run";
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
      let riseValue = engine.getRegister("rise");
      if (!riseValue && engine.state.current && engine.state.current.dimension === "length" && engine.state.current.baseValue > 0) {
        riseValue = Engine.makeValue(engine.state.current.baseValue, "length", engine.state.current.unit || "in");
        engine.state.registers.rise = Engine.makeValue(riseValue.baseValue, "length", riseValue.unit);
      }
      if (!riseValue) {
        throw new Error("Missing rise");
      }
      if (riseValue.dimension !== "length" || riseValue.baseValue <= 0) {
        throw new Error("Rise must be a positive length");
      }
      const totalRise = riseValue.baseValue;
      const maxRiser = engine.state.preferences.stairRiserLimit || 7.75;
      const treadDepth = engine.state.preferences.treadDepth || 10;
      const headroom = engine.state.preferences.headroomHeight || 80;
      const floorThickness = engine.state.preferences.floorThickness || 10;
      const risers = Math.ceil(totalRise / maxRiser);
      if (risers <= 0) {
        throw new Error("Invalid stair rise");
      }
      const actualRiser = totalRise / risers;
      const treads = Math.max(risers - 1, 0);
      const totalRun = treads * treadDepth;
      const stairRiseForRun = actualRiser * treads;
      const angle = totalRun > 0 ? Math.atan(stairRiseForRun / totalRun) * 180 / PI : 0;
      const stringer = Math.sqrt(stairRiseForRun * stairRiseForRun + totalRun * totalRun);
      const opening = actualRiser > 0 ? (headroom + floorThickness) * treadDepth / actualRiser : 0;
      const totalRiseKey = Math.round(totalRise * 10000) / 10000;
      const cycle = (engine.state.lastFunction === "stair" && engine.state.stairTotalRise === totalRiseKey ? (engine.state.stairCycle || 0) + 1 : 0) % 12;
      engine.state.lastFunction = "stair";
      engine.state.stairCycle = cycle;
      engine.state.stairTotalRise = totalRiseKey;
      const stairLength = (inches) => Engine.makeValue(inches, "length", "in", { format: "inch-fraction", forceInches: true });

      const results = [
        { label: "Riser height", value: stairLength(actualRiser) },
        { label: "Risers", value: Engine.makeValue(risers, "count", "count") },
        { label: "Tread width stored", value: stairLength(treadDepth) },
        { label: "Treads", value: Engine.makeValue(treads, "count", "count") },
        { label: "Stairwell opening", value: stairLength(opening) },
        { label: "Stringer length", value: stairLength(stringer) },
        { label: "Stair angle", value: Engine.makeValue(Engine.roundForDisplay(angle, 2), "angle", "deg") },
        { label: "Run", value: stairLength(totalRun) },
        { label: "Rise stored", value: stairLength(totalRise) },
        { label: "Riser height stored", value: stairLength(maxRiser) },
        { label: "Staircase headroom stored", value: Engine.makeValue(headroom, "length", "ft", { format: "feet-inch" }) },
        { label: "Floor thickness stored", value: stairLength(floorThickness) }
      ];
      const result = results[cycle];
      engine.setCurrent(result.value, result.label);
      if (cycle === 0) {
        engine.addHistory("Stair", "Rise " + Engine.inchesToFeetInches(totalRise, engine.state.preferences.fractionDenominator || 16) + " | " + risers + " risers | " + treads + " treads");
      }
      return [];
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

  function circleCanContinue(engine) {
    const cycle = engine.state.circleCycle;
    const current = engine.state.current;
    return Boolean(cycle && current &&
      current.dimension === cycle.lastDimension &&
      Math.abs(current.baseValue - cycle.lastBaseValue) < 0.000001);
  }

  function circleSource(engine) {
    if (circleCanContinue(engine)) {
      return engine.state.circleCycle;
    }
    const current = engine.state.current;
    if (current && current.dimension === "length" && current.baseValue > 0) {
      return {
        diameter: current.baseValue,
        unit: current.unit || "in",
        step: -1
      };
    }
    const radius = engine.getRegister("radius");
    if (radius && radius.dimension === "length" && radius.baseValue > 0) {
      return {
        diameter: radius.baseValue * 2,
        unit: radius.unit || "in",
        step: -1
      };
    }
    throw new Error("Missing diameter");
  }

  function circleDisplayValue(diameter, step, unit) {
    if (step === 0) {
      return {
        label: "Diameter",
        value: Engine.makeValue(diameter, "length", unit || "in", {
          format: "decimal",
          noTrailingDecimal: true,
          unitLabel: unit === "in" ? "INCH" : undefined
        })
      };
    }
    if (step === 1) {
      return {
        label: "Circumference",
        value: Engine.makeValue(PI * diameter, "length", "in", {
          format: "inch-fraction",
          forceInches: true,
          unitLabel: "INCH"
        })
      };
    }
    return {
      label: "Area",
      value: Engine.makeValue(PI * (diameter / 2) * (diameter / 2), "area", "sqin", {
        precision: 6,
        noTrailingDecimal: true
      })
    };
  }

  function circle(engine) {
    try {
      const source = circleSource(engine);
      const nextStep = (source.step + 1) % 3;
      const result = circleDisplayValue(source.diameter, nextStep, source.unit);
      engine.setCurrent(result.value, result.label);
      engine.state.lastFunction = "circle";
      engine.state.circleCycle = {
        diameter: source.diameter,
        unit: source.unit,
        step: nextStep,
        lastBaseValue: engine.state.current.baseValue,
        lastDimension: engine.state.current.dimension
      };
      return [];
    } catch (error) {
      engine.setError(error.message);
      return [];
    }
  }

  function arcCanContinue(engine) {
    const cycle = engine.state.arcCycle;
    const current = engine.state.current;
    return Boolean(cycle && current &&
      current.dimension === cycle.lastDimension &&
      Math.abs(current.baseValue - cycle.lastBaseValue) < 0.000001);
  }

  function arcFromChordRise(engine) {
    const chord = requireLength(engine, "run");
    const rise = requireLength(engine, "rise");
    if (chord <= 0 || rise <= 0) {
      throw new Error("Run and rise are required");
    }
    const radius = (chord * chord) / (8 * rise) + rise / 2;
    const angle = 2 * Math.asin(Math.min(1, chord / (2 * radius))) * 180 / PI;
    const arcLength = radius * angle * PI / 180;
    const sectorArea = (angle / 360) * PI * radius * radius;
    return { radius, angle, arcLength, chord, rise, sectorArea, source: "chord-rise" };
  }

  function arcFromRadiusAngle(engine) {
    const radius = requireLength(engine, "radius");
    const angleValue = engine.getRegister("springAngle") || (engine.state.current && engine.state.current.dimension === "angle" ? engine.state.current : null);
    const angle = angleValue ? angleValue.baseValue : currentAsNumber(engine);
    if (!angle) {
      throw new Error("Missing angle");
    }
    const radians = angle * PI / 180;
    return {
      radius,
      angle,
      arcLength: radius * radians,
      chord: 2 * radius * Math.sin(radians / 2),
      sectorArea: (angle / 360) * PI * radius * radius,
      source: "radius-angle"
    };
  }

  function arcDiameterSource(engine) {
    const circle = engine.state.circleCycle;
    if (circle && circle.diameter > 0) {
      return circle.diameter;
    }
    const radius = engine.getRegister("radius");
    if (radius && radius.dimension === "length" && radius.baseValue > 0) {
      return radius.baseValue * 2;
    }
    return 0;
  }

  function arcFromDiameterArcLength(engine) {
    engine.commitInputAsScalar();
    const diameter = arcDiameterSource(engine);
    const current = engine.state.current;
    if (!diameter || !current || current.dimension !== "length" || current.baseValue <= 0) {
      throw new Error("Missing diameter or arc length");
    }
    const radius = diameter / 2;
    const arcLength = current.baseValue;
    const angleRadians = arcLength / radius;
    if (angleRadians <= 0 || angleRadians > PI * 2 + 0.000001) {
      throw new Error("Arc length is out of range");
    }
    const angle = angleRadians * 180 / PI;
    const chord = 2 * radius * Math.sin(angleRadians / 2);
    const rise = radius - Math.sqrt(Math.max(0, radius * radius - (chord / 2) * (chord / 2)));
    const pieSliceArea = 0.5 * radius * radius * angleRadians;
    const segmentArea = 0.5 * radius * radius * (angleRadians - Math.sin(angleRadians));
    return { radius, diameter, angle, arcLength, chord, rise, sectorArea: pieSliceArea, segmentArea, pieSliceArea, source: "diameter-arclength" };
  }

  function arcDisplayValue(data, step) {
    if (data.source === "diameter-arclength") {
      if (step === 0) {
        return {
          label: "Arc Length",
          value: Engine.makeValue(data.arcLength, "length", "ft", { format: "feet-inch" })
        };
      }
      if (step === 1) {
        return {
          label: "Arc Angle",
          value: Engine.makeValue(data.angle, "angle", "deg", { precision: 2, noTrailingDecimal: true })
        };
      }
      if (step === 2) {
        return {
          label: "Chord Length",
          value: Engine.makeValue(data.chord, "length", "ft", { format: "feet-inch" })
        };
      }
      if (step === 3) {
        return {
          label: "Segment Area",
          value: Engine.makeValue(data.segmentArea, "area", "sqft", { precision: 6, noTrailingDecimal: true })
        };
      }
      if (step === 4) {
        return {
          label: "Pie Slice Area",
          value: Engine.makeValue(data.pieSliceArea, "area", "sqft", { precision: 6, noTrailingDecimal: true })
        };
      }
      return {
        label: "Rise",
        value: Engine.makeValue(data.rise, "length", "ft", { format: "feet-inch", showZeroFeet: true })
      };
    }
    if (step === 0) {
      return {
        label: "Radius",
        value: Engine.makeValue(data.radius, "length", "ft", { format: "feet-inch" })
      };
    }
    if (step === 1) {
      return {
        label: "Arc Angle",
        value: Engine.makeValue(data.angle, "angle", "deg", { precision: 2, noTrailingDecimal: true })
      };
    }
    if (step === 2) {
      return {
        label: "Arc Length",
        value: Engine.makeValue(data.arcLength, "length", "ft", { format: "feet-inch" })
      };
    }
    if (step === 3) {
      return {
        label: "Chord",
        value: Engine.makeValue(data.chord, "length", "ft", { format: "feet-inch" })
      };
    }
    return {
      label: "Segment Area",
      value: Engine.makeValue(data.sectorArea, "area", "sqft", { precision: 6, noTrailingDecimal: true })
    };
  }

  function setArcResult(engine, data, step) {
    const result = arcDisplayValue(data, step);
    engine.setCurrent(result.value, result.label);
    engine.state.lastFunction = "arc";
    engine.state.arcCycle = Object.assign({}, data, {
      step,
      lastBaseValue: engine.state.current.baseValue,
      lastDimension: engine.state.current.dimension
    });
    return result.value;
  }

  function arcRadius(engine) {
    try {
      const data = arcFromChordRise(engine);
      setArcResult(engine, data, 0);
      engine.state.registers.radius = Engine.makeValue(data.radius, "length", "ft", { format: "feet-inch" });
      engine.addHistory("Arc radius", "Chord " + formatValue(Engine.makeValue(data.chord, "length", "ft"), engine.state.preferences) +
        " | Rise " + formatValue(Engine.makeValue(data.rise, "length", "ft"), engine.state.preferences) +
        " | Radius " + formatValue(engine.state.current, engine.state.preferences));
      return [];
    } catch (error) {
      engine.setError(error.message);
      return [];
    }
  }

  function arc(engine) {
    try {
      if (arcCanContinue(engine)) {
        const cycleLength = engine.state.arcCycle.source === "diameter-arclength"
          ? 6
          : engine.state.arcCycle.source === "chord-rise"
            ? 5
            : 4;
        const nextStep = (engine.state.arcCycle.step + 1) % cycleLength;
        setArcResult(engine, engine.state.arcCycle, nextStep);
        return [];
      }

      if (engine.state.current && engine.state.current.dimension === "length" && arcDiameterSource(engine)) {
        const data = arcFromDiameterArcLength(engine);
        setArcResult(engine, data, 0);
        engine.addHistory("Arc", "Diameter " + formatValue(Engine.makeValue(data.diameter, "length", "ft"), engine.state.preferences) +
          " | Arc length " + formatValue(engine.state.current, engine.state.preferences));
        return [];
      }

      const data = arcFromRadiusAngle(engine);
      setArcResult(engine, data, 2);
      engine.addHistory("Arc", "Radius " + formatValue(Engine.makeValue(data.radius, "length", "ft"), engine.state.preferences) +
        " | Angle " + Engine.roundForDisplay(data.angle, 3) + "\u00b0" +
        " | Length " + formatValue(engine.state.current, engine.state.preferences));
      return [];
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
      const tonsPerCubicYard = Number(engine.state.preferences.weightPerVolume) || 1.5;
      const tons = volume / 46656 * tonsPerCubicYard;
      const rows = [
        [isCone ? "Cone volume" : "Column volume", formatValue(Engine.makeValue(volume, "volume", "cuft"), engine.state.preferences)],
        ["Cubic yards", Engine.roundForDisplay(volume / 46656, 5) + " CU YD"],
        ["Cubic meters", Engine.roundForDisplay(volume / (Engine.constants.INCHES_PER_METER ** 3), 5) + " CU M"],
        ["Weight", Engine.roundForDisplay(tons, 3) + " TON"]
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
      const widthValue = engine.getRegister("width");
      const heightValue = engine.getRegister("height");
      const waste = (engine.state.preferences.concreteWaste || 0) / 100;
      const volume = widthValue && heightValue
        ? length * requireLength(engine, "width") * requireLength(engine, "height")
        : length * (Number(engine.state.preferences.footingArea) || 264);
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
      const length = currentOrRegisterLength(engine, "length");
      const spacing = engine.state.preferences.studSpacing || 16;
      const count = Math.ceil(length / spacing) + 1;
      engine.setCurrent(Engine.makeValue(count, "count", "count", { noTrailingDecimal: true }), "Stud count");
      engine.addHistory("Studs", formatValue(Engine.makeValue(length, "length", "ft"), engine.state.preferences) + " @ " + spacing + " IN OC = " + count);
      return [];
    } catch (error) {
      engine.setError(error.message);
      return [];
    }
  }

  function boardFeet(engine) {
    try {
      engine.commitInputAsScalar();
      if (engine.state.pendingOperator && engine.state.accumulator) {
        engine.equals();
        if (engine.state.error) {
          return [];
        }
      }
      if (engine.state.current && engine.state.current.dimension === "scalar" && engine.state.current.baseValue) {
        const boardFeetValue = engine.state.current.baseValue / 12;
        const rows = [
          ["Board feet", Engine.roundForDisplay(boardFeetValue, 5) + " BD FT"],
          ["Formula", "thickness x width x length / 12"]
        ];
        engine.setCurrent(Engine.makeValue(boardFeetValue, "volume-lumber", "boardft"), "Board feet");
        return rows;
      }
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
      const blockAreaSqIn = Number(engine.state.preferences.blockArea) || 128;
      const blockLength = Number(engine.state.preferences.blockLength) || 16;
      const blockSqFt = blockAreaSqIn / 144;
      const waste = 1.05;
      const count = Math.ceil((wallSqFt / blockSqFt) * waste);
      const rows = [
        ["Wall area", Engine.roundForDisplay(wallSqFt, 3) + " SQ FT"],
        ["Block area", Engine.roundForDisplay(blockAreaSqIn, 3) + " SQ IN"],
        ["Block length", Engine.roundForDisplay(blockLength, 3) + " IN"],
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
      const denom = engine.state.preferences.fractionDenominator || 16;
      if (!pitch) {
        throw new Error("Missing pitch");
      }
      const count = Math.floor(run / spacing) + 1;
      const increment = spacing * (pitch.baseValue / 12);
      const rows = [["Studs", String(count)], ["Increment", Engine.inchesToFeetInches(increment, denom, { fractionMode: engine.state.preferences.fractionMode })]];
      const studRows = [];
      for (let i = 0; i < Math.min(count, 20); i += 1) {
        studRows.push(["Stud " + (i + 1), Engine.inchesToFeetInches(startHeight + i * increment, denom, { fractionMode: engine.state.preferences.fractionMode })]);
      }
      if (engine.state.preferences.rakeWallOrder === "descending") {
        studRows.reverse();
      }
      rows.push.apply(rows, studRows);
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
      const denom = engine.state.preferences.fractionDenominator || 16;
      const longest = requireLength(engine, "diag");
      if (!pitch) {
        throw new Error("Missing pitch");
      }
      const factor = Math.sqrt(12 * 12 + pitch.baseValue * pitch.baseValue) / 12;
      const increment = spacing * factor;
      const rows = [["Jack difference", Engine.inchesToFeetInches(increment, denom, { fractionMode: engine.state.preferences.fractionMode })]];
      const jackRows = [];
      for (let i = 0; i < 12; i += 1) {
        const length = longest - i * increment;
        if (length <= 0) {
          break;
        }
        jackRows.push(["Jack " + (i + 1), Engine.inchesToFeetInches(length, denom, { fractionMode: engine.state.preferences.fractionMode })]);
      }
      if (engine.state.preferences.jackOrder === "ascending") {
        jackRows.reverse();
      }
      rows.push.apply(rows, jackRows);
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
    const precision = Number(engine.state.preferences.degreePrecision) || 2;
    const text = degrees + "\u00b0 " + minutes + "\u2032 " + Engine.roundForDisplay(seconds, precision) + "\u2033";
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
    arcRadius,
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
