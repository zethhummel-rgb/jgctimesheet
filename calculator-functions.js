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

  function activeEntry(engine) {
    return engine.state.inputBuffer !== "" || engine.state.pendingFractionNumerator !== null;
  }

  function cloneForRegister(value) {
    return Engine.makeValue(value.baseValue, value.dimension, value.unit, Object.assign({}, value.meta || {}));
  }

  function registerInputKey(engine, names) {
    return names.map((name) => {
      const value = engine.getRegister(name);
      return value ? name + ":" + Engine.roundForDisplay(value.baseValue, 8) : name + ":";
    }).join("|");
  }

  function storeLengthRegister(engine, name, label) {
    engine.commitInputAsScalar();
    if (!engine.state.current || engine.state.current.dimension !== "length") {
      throw new Error(label + " must be a length");
    }
    engine.state.registers[name] = cloneForRegister(engine.state.current);
    engine.setCurrent(engine.state.registers[name], label);
    engine.state.lastFunction = name;
    if (name === "length") {
      engine.state.widthCycle = null;
      engine.state.widthInputKey = null;
      engine.state.heightCycle = null;
      engine.state.heightInputKey = null;
    } else if (name === "width") {
      engine.state.widthCycle = -1;
      engine.state.widthInputKey = registerInputKey(engine, ["length", "width"]);
      engine.state.heightCycle = null;
      engine.state.heightInputKey = null;
    } else if (name === "height") {
      engine.state.heightCycle = -1;
      engine.state.heightInputKey = registerInputKey(engine, ["length", "width", "height"]);
    }
  }

  function shouldStoreDimension(engine, name) {
    return activeEntry(engine) || (engine.state.current && engine.state.current.dimension === "length" && engine.state.current.baseValue > 0 && engine.state.lastFunction !== name);
  }

  function lengthPrimary(engine) {
    try {
      if (shouldStoreDimension(engine, "length")) {
        storeLengthRegister(engine, "length", "Length");
        return;
      }
      engine.recallRegister("length");
      engine.state.lastFunction = "length";
    } catch (error) {
      engine.setError(error.message);
    }
  }

  function widthPrimary(engine) {
    try {
      if (shouldStoreDimension(engine, "width")) {
        storeLengthRegister(engine, "width", "Width");
        return;
      }
      const length = requireLength(engine, "length");
      const width = requireLength(engine, "width");
      const key = registerInputKey(engine, ["length", "width"]);
      if (engine.state.widthInputKey !== key || engine.state.lastFunction !== "width") {
        engine.state.widthCycle = -1;
        engine.state.widthInputKey = key;
      }
      const cycle = (engine.state.widthCycle + 1) % 3;
      engine.state.widthCycle = cycle;
      engine.state.lastFunction = "width";
      if (cycle === 0) {
        return setResult(engine, Engine.makeValue(length * width, "area", "sqft", { noTrailingDecimal: true }), "Area");
      }
      if (cycle === 1) {
        return setResult(engine, Engine.makeValue(Math.sqrt(length * length + width * width), "length", "ft", { format: "feet-inch" }), "Square-Up");
      }
      return setResult(engine, Engine.makeValue(2 * (length + width), "length", "ft", { format: "feet-inch", showZeroFeet: true }), "Perimeter");
    } catch (error) {
      engine.setError(error.message);
    }
  }

  function heightPrimary(engine) {
    try {
      if (shouldStoreDimension(engine, "height")) {
        storeLengthRegister(engine, "height", "Height");
        return;
      }
      const length = requireLength(engine, "length");
      const width = requireLength(engine, "width");
      const height = requireLength(engine, "height");
      const key = registerInputKey(engine, ["length", "width", "height"]);
      if (engine.state.heightInputKey !== key || engine.state.lastFunction !== "height") {
        engine.state.heightCycle = -1;
        engine.state.heightInputKey = key;
      }
      const cycle = (engine.state.heightCycle + 1) % 3;
      engine.state.heightCycle = cycle;
      engine.state.lastFunction = "height";
      if (cycle === 0) {
        return setResult(engine, Engine.makeValue(length * width * height, "volume", "cuft", { noTrailingDecimal: true }), "Volume");
      }
      const wallArea = (2 * length * height) + (2 * width * height);
      if (cycle === 1) {
        return setResult(engine, Engine.makeValue(wallArea, "area", "sqft", { noTrailingDecimal: true }), "Wall Area");
      }
      return setResult(engine, Engine.makeValue(wallArea + (length * width), "area", "sqft", { noTrailingDecimal: true }), "Surface Area");
    } catch (error) {
      engine.setError(error.message);
    }
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

  function pitchSlopeRatio(pitch) {
    if (!pitch || !Number.isFinite(pitch.baseValue)) {
      throw new Error("Pitch is required");
    }
    if (pitch.dimension === "angle" || pitch.unit === "deg") {
      return Math.tan(pitch.baseValue * PI / 180);
    }
    if (pitch.unit === "percent") {
      return pitch.baseValue / 100;
    }
    return pitch.baseValue / 12;
  }

  function pitchPrimary(engine) {
    try {
      const storedRise = engine.getRegister("rise");
      const storedRun = engine.getRegister("run");
      engine.commitInputAsScalar();
      if (storedRise && !storedRun) {
        const storedDiag = engine.getRegister("diag");
        if (storedDiag && storedDiag.dimension === "length" && storedDiag.baseValue > 0) {
          const rise = storedRise.baseValue;
          const diag = storedDiag.baseValue;
          if (rise > diag) {
            throw new Error("Rise cannot exceed diagonal");
          }
          const angle = Math.asin(rise / diag) * 180 / PI;
          engine.state.registers.pitch = Engine.makeValue(angle, "angle", "deg", { precision: 2, noTrailingDecimal: true });
          engine.state.lastFunction = "pitch";
          return setResult(engine, engine.state.registers.pitch, "Pitch");
        }
      }
      if (!storedRise || !storedRun) {
        if (engine.state.current && Math.abs(engine.state.current.baseValue) > 0.000001) {
          if (engine.state.current.dimension === "scalar" && engine.state.current.unit === "percent") {
            const percentPitch = Engine.makeValue(engine.state.current.baseValue, "scalar", "percent", { noTrailingDecimal: true });
            engine.state.registers.pitch = percentPitch;
            engine.setCurrent(percentPitch, "Pitch");
            engine.state.lastFunction = "pitch";
            return;
          }
          if (engine.state.current.dimension === "scalar") {
            const anglePitch = Engine.makeValue(engine.state.current.baseValue, "angle", "deg", { noTrailingDecimal: true });
            engine.state.registers.pitch = anglePitch;
            engine.setCurrent(anglePitch, "Pitch");
            engine.state.lastFunction = "pitch";
            return;
          }
          const pitchMeta = Object.assign({}, engine.state.current.meta || {}, {
            noTrailingDecimal: true,
            unitLabel: engine.state.current.unit === "in" ? "INCH" : undefined
          });
          engine.state.registers.pitch = Engine.makeValue(engine.state.current.baseValue, engine.state.current.dimension, engine.state.current.unit, pitchMeta);
          engine.setCurrent(engine.state.registers.pitch, "Pitch");
          engine.state.lastFunction = "pitch";
          return;
        }
      }
      const rise = requireLength(engine, "rise");
      const run = requireLength(engine, "run");
      const roof = roofFromRiseRun(rise, run);
      const cycle = (engine.state.lastFunction === "pitch" ? (engine.state.pitchCycle || 0) + 1 : 0) % 3;
      engine.state.pitchCycle = cycle;
      engine.state.lastFunction = "pitch";
      if (cycle === 1) {
        return setResult(engine, Engine.makeValue(roof.angle, "angle", "deg", { precision: 2, noTrailingDecimal: true }), "Pitch");
      }
      if (cycle === 2) {
        return setResult(engine, Engine.makeValue(roof.slope, "scalar", "percent", { precision: 2, noTrailingDecimal: true }), "Pitch");
      }
      return setResult(engine, Engine.makeValue(roof.pitch, "length", "in", {
        format: "inch-fraction",
        forceInches: true,
        unitLabel: "INCH"
      }), "Pitch");
    } catch (error) {
      engine.setError(error.message);
    }
  }

  function risePrimary(engine) {
    try {
      const pitch = engine.getRegister("pitch");
      if (!pitch) {
        engine.commitInputAsScalar();
        if (engine.state.current && engine.state.current.dimension === "length" && engine.state.current.baseValue > 0) {
          engine.state.registers.rise = Engine.makeValue(engine.state.current.baseValue, "length", engine.state.current.unit || "ft", engine.state.current.meta || {});
          engine.setCurrent(engine.state.registers.rise, "Rise");
          engine.state.lastFunction = "rise";
          return;
        }
        engine.handleRegisterKey("rise");
        engine.state.lastFunction = "rise";
        return;
      }
      const run = requireLength(engine, "run");
      const rise = run * pitchSlopeRatio(pitch);
      engine.state.lastFunction = "rise";
      return setResult(engine, Engine.makeValue(rise, "length", "ft", { format: "feet-inch" }), "Rise");
    } catch (error) {
      engine.setError(error.message);
    }
  }

  function runPrimary(engine) {
    try {
      if (polygonCanContinue(engine)) {
        polygonCycleNext(engine);
        return;
      }
      const pitch = engine.getRegister("pitch");
      const rise = engine.getRegister("rise");
      engine.commitInputAsScalar();
      if ((!pitch || !rise) && engine.state.current && engine.state.current.dimension === "length" && engine.state.current.baseValue > 0) {
        engine.state.registers.run = Engine.makeValue(engine.state.current.baseValue, "length", engine.state.current.unit || "ft", engine.state.current.meta || {});
        engine.setCurrent(engine.state.registers.run, "Run");
        engine.state.lastFunction = "run";
        return;
      }
      if (!pitch || !pitch.baseValue) {
        engine.handleRegisterKey("run");
        engine.state.lastFunction = "run";
        return;
      }
      const storedRise = requireLength(engine, "rise");
      const ratio = pitchSlopeRatio(pitch);
      if (!ratio) {
        throw new Error("Pitch is required");
      }
      const run = storedRise / ratio;
      engine.state.lastFunction = "run";
      return setResult(engine, Engine.makeValue(run, "length", "ft", { format: "feet-inch" }), "Run");
    } catch (error) {
      engine.setError(error.message);
    }
  }

  function diagPrimary(engine) {
    try {
      if (activeEntry(engine) || (engine.state.current && engine.state.current.dimension === "length" && engine.state.current.baseValue > 0 && !engine.getRegister("run"))) {
        engine.commitInputAsScalar();
        if (!engine.state.current || engine.state.current.dimension !== "length") {
          throw new Error("Diagonal must be a length");
        }
        engine.state.registers.diag = Engine.makeValue(engine.state.current.baseValue, "length", engine.state.current.unit || "ft", Object.assign({}, engine.state.current.meta || {}, { format: "feet-inch" }));
        engine.setCurrent(engine.state.registers.diag, "Diagonal");
        engine.state.lastFunction = "diag";
        return;
      }
      const run = requireLength(engine, "run");
      let rise = engine.getRegister("rise");
      if (!rise) {
        const pitch = engine.getRegister("pitch");
        if (pitch) {
          rise = Engine.makeValue(run * pitchSlopeRatio(pitch), "length", "in", { format: "feet-inch" });
          engine.state.registers.rise = rise;
        }
      }
      rise = rise && rise.dimension === "length" ? rise.baseValue : requireLength(engine, "rise");
      const roof = roofFromRiseRun(rise, run);
      const inputKey = Math.round(rise * 10000) + ":" + Math.round(run * 10000);
      const cycle = (engine.state.lastFunction === "diag" && engine.state.diagInputKey === inputKey ? (engine.state.diagCycle || 0) + 1 : 0) % 3;
      engine.state.lastFunction = "diag";
      engine.state.diagCycle = cycle;
      engine.state.diagInputKey = inputKey;
      if (cycle === 1) {
        return setResult(engine, Engine.makeValue(roof.angle, "angle", "deg", { precision: 2, noTrailingDecimal: true }), "Plumb Cut");
      }
      if (cycle === 2) {
        return setResult(engine, Engine.makeValue(90 - roof.angle, "angle", "deg", { precision: 2, noTrailingDecimal: true }), "Level Cut");
      }
      return setResult(engine, Engine.makeValue(roof.diag, "length", "ft", { format: "feet-inch" }), "Diagonal");
    } catch (error) {
      engine.setError(error.message);
    }
  }

  function hipValley(engine) {
    try {
      const run = requireLength(engine, "run");
      const pitch = engine.getRegister("pitch");
      if (!pitch) {
        throw new Error("Pitch is required");
      }
      const pitchRatio = pitchSlopeRatio(pitch);
      const irregularPitch = engine.getRegister("irregularPitch");
      const irregularRatio = irregularPitch ? pitchSlopeRatio(irregularPitch) : null;
      const rise = run * pitchRatio;
      let horizontalRun;
      let length;
      let plumbCut;
      let levelCut;
      let cheekCut1;
      let cheekCut2;
      let labels;
      let inputKey;

      if (irregularRatio) {
        if (Math.abs(irregularRatio) < 0.000001) {
          throw new Error("Irregular pitch is invalid");
        }
        const adjacentRun = rise / irregularRatio;
        horizontalRun = Math.sqrt((run * run) + (adjacentRun * adjacentRun));
        length = Math.sqrt((horizontalRun * horizontalRun) + (rise * rise));
        plumbCut = Math.atan(rise / horizontalRun) * 180 / PI;
        levelCut = 90 - plumbCut;
        cheekCut1 = Math.atan(adjacentRun / run) * 180 / PI;
        cheekCut2 = 90 - cheekCut1;
        labels = [
          ["Irregular Hip/Valley Rafter Length", Engine.makeValue(length, "length", "ft", { format: "feet-inch" })],
          ["Plumb Cut", Engine.makeValue(plumbCut, "angle", "deg", { precision: 2, noTrailingDecimal: true })],
          ["Level Cut", Engine.makeValue(levelCut, "angle", "deg", { precision: 2, noTrailingDecimal: true })],
          ["Cheek Cut 1", Engine.makeValue(cheekCut1, "angle", "deg", { precision: 2, noTrailingDecimal: true })],
          ["Cheek Cut 2", Engine.makeValue(cheekCut2, "angle", "deg", { precision: 2, noTrailingDecimal: true })]
        ];
        inputKey = ["ir", Math.round(run * 10000), Math.round(pitchRatio * 10000), Math.round(irregularRatio * 10000)].join(":");
      } else {
        horizontalRun = Math.sqrt(run * run * 2);
        length = Math.sqrt((horizontalRun * horizontalRun) + (rise * rise));
        plumbCut = Math.atan(rise / horizontalRun) * 180 / PI;
        levelCut = 90 - plumbCut;
        labels = [
          ["Hip/Valley Rafter Length", Engine.makeValue(length, "length", "ft", { format: "feet-inch" })],
          ["Plumb Cut", Engine.makeValue(plumbCut, "angle", "deg", { precision: 2, noTrailingDecimal: true })],
          ["Level Cut", Engine.makeValue(levelCut, "angle", "deg", { precision: 2, noTrailingDecimal: true })],
          ["Cheek Cut 1", Engine.makeValue(45, "angle", "deg", { precision: 2, noTrailingDecimal: true })]
        ];
        inputKey = ["hip", Math.round(run * 10000), Math.round(pitchRatio * 10000)].join(":");
      }

      const cycle = (engine.state.lastFunction === "hip" && engine.state.hipInputKey === inputKey ? (engine.state.hipCycle || 0) + 1 : 0) % labels.length;
      engine.state.lastFunction = "hip";
      engine.state.hipCycle = cycle;
      engine.state.hipInputKey = inputKey;
      return setResult(engine, labels[cycle][1], labels[cycle][0]);
    } catch (error) {
      engine.setError(error.message);
    }
  }

  function irregularPitch(engine) {
    try {
      engine.commitInputAsScalar();
      const current = engine.state.current;
      if (!current || Math.abs(current.baseValue) < 0.000001) {
        throw new Error("Irregular pitch is required");
      }
      let value;
      if (current.dimension === "length") {
        value = Engine.makeValue(current.baseValue, "length", current.unit || "in", Object.assign({}, current.meta || {}, {
          noTrailingDecimal: true,
          unitLabel: current.unit === "in" ? "INCH" : undefined
        }));
      } else if (current.dimension === "angle" || current.unit === "deg") {
        value = Engine.makeValue(current.baseValue, "angle", "deg", { precision: 2, noTrailingDecimal: true });
      } else if (current.unit === "percent") {
        value = Engine.makeValue(current.baseValue, "scalar", "percent", { precision: 2, noTrailingDecimal: true });
      } else {
        value = Engine.makeValue(current.baseValue, "angle", "deg", { precision: 2, noTrailingDecimal: true });
      }
      engine.state.registers.irregularPitch = value;
      engine.state.lastFunction = "irregular-pitch";
      engine.state.hipCycle = 0;
      engine.state.hipInputKey = "";
      engine.setCurrent(value, "Irregular Pitch");
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
      const stairPrefs = normalizeStairPreferences(engine);
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
      const maxRiser = stairPrefs.stairRiserLimit;
      const treadDepth = stairPrefs.treadDepth;
      const headroom = stairPrefs.headroomHeight;
      const floorThickness = stairPrefs.floorThickness;
      const runValue = engine.getRegister("run");
      const storedRun = runValue && runValue.dimension === "length" && runValue.baseValue > 0 ? runValue.baseValue : 0;
      const risers = Math.ceil(totalRise / maxRiser);
      if (risers <= 0) {
        throw new Error("Invalid stair rise");
      }
      const denom = engine.state.preferences.fractionDenominator || 16;
      const roundToFraction = (inches) => Math.round(inches * denom) / denom;
      const actualRiser = totalRise / risers;
      const displayedRiser = roundToFraction(actualRiser);
      const treads = Math.max(risers - 1, 0);
      const actualTread = storedRun && treads > 0 ? storedRun / treads : treadDepth;
      const displayedTread = roundToFraction(actualTread);
      const totalRun = storedRun || (treads * treadDepth);
      const stairRunForCalc = storedRun ? displayedTread * treads : totalRun;
      const stairRiseForRun = displayedRiser * treads;
      const angle = totalRun > 0 ? Math.atan(stairRiseForRun / totalRun) * 180 / PI : 0;
      const stringer = Math.sqrt(stairRiseForRun * stairRiseForRun + stairRunForCalc * stairRunForCalc);
      const opening = displayedRiser > 0 ? (headroom + floorThickness) * displayedTread / displayedRiser : 0;
      const riserOverage = Math.abs((displayedRiser * risers) - totalRise);
      const treadOverage = storedRun ? Math.abs((displayedTread * treads) - storedRun) : 0;
      const totalRiseKey = Math.round(totalRise * 10000) / 10000 + ":" + Math.round(totalRun * 10000) / 10000;
      const continuingStair = engine.state.lastFunction === "stair" && engine.state.stairTotalRise === totalRiseKey;
      const stairLength = (inches) => Engine.makeValue(inches, "length", "in", { format: "inch-fraction", forceInches: true, unitLabel: "INCH" });
      const stairFeet = (inches) => Engine.makeValue(inches, "length", "ft", { format: "feet-inch" });

      const results = storedRun ? [
        { label: "Riser Height", value: stairLength(displayedRiser) },
        { label: "Risers", value: Engine.makeValue(risers, "count", "count") },
        { label: "Riser Overage/Underage", value: stairLength(riserOverage) },
        { label: "Tread Width", value: stairLength(displayedTread) },
        { label: "Treads", value: Engine.makeValue(treads, "count", "count") },
        { label: "Tread Overage/Underage", value: stairLength(treadOverage) },
        { label: "Stairwell Opening", value: stairFeet(opening) },
        { label: "Stringer Length", value: stairFeet(stringer) },
        { label: "Stair Angle of Incline", value: Engine.makeValue(Engine.roundForDisplay(angle, 2), "angle", "deg") },
        { label: "Run STORED", value: stairFeet(storedRun) },
        { label: "Rise STORED", value: stairFeet(totalRise) },
        { label: "Riser Height STORED", value: stairLength(maxRiser) },
        { label: "Tread Width STORED", value: stairLength(treadDepth) },
        { label: "Staircase Headroom STORED", value: stairFeet(headroom) },
        { label: "Floor Thickness STORED", value: stairLength(floorThickness) }
      ] : [
        { label: "Riser height", value: stairLength(displayedRiser) },
        { label: "Risers", value: Engine.makeValue(risers, "count", "count") },
        { label: "Tread width stored", value: stairLength(treadDepth) },
        { label: "Treads", value: Engine.makeValue(treads, "count", "count") },
        { label: "Stairwell opening", value: stairFeet(opening) },
        { label: "Stringer length", value: stairFeet(stringer) },
        { label: "Stair angle", value: Engine.makeValue(Engine.roundForDisplay(angle, 2), "angle", "deg") },
        { label: "Run", value: stairLength(totalRun) },
        { label: "Rise stored", value: stairLength(totalRise) },
        { label: "Riser height stored", value: stairLength(maxRiser) },
        { label: "Staircase headroom stored", value: stairFeet(headroom) },
        { label: "Floor thickness stored", value: stairLength(floorThickness) }
      ];
      const cycle = (continuingStair ? (engine.state.stairCycle || 0) + 1 : 0) % results.length;
      engine.state.lastFunction = "stair";
      engine.state.stairTotalRise = totalRiseKey;
      engine.state.stairCycle = cycle;
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
      const rise = engine.getRegister("rise");
      const run = engine.getRegister("run");
      if (rise && run && rise.dimension === "length" && run.dimension === "length") {
        engine.state.lastFunction = "";
        engine.state.stairCycle = -1;
        return stair(engine);
      }
      const inches = currentAsLengthInches(engine);
      setValidatedRiserLimit(engine, inches);
    } catch (error) {
      const number = currentAsNumber(engine);
      if (number > 0) {
        setValidatedRiserLimit(engine, number);
      } else {
        engine.setError(error.message);
      }
    }
  }

  function boundedPreference(value, fallback, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < min || number > max) {
      return fallback;
    }
    return number;
  }

  function normalizeStairPreferences(engine) {
    const prefs = engine.state.preferences || {};
    const clean = {
      stairRiserLimit: boundedPreference(prefs.stairRiserLimit, 7.5, 4, 7.875),
      treadDepth: boundedPreference(prefs.treadDepth, 10, 4, 24),
      headroomHeight: boundedPreference(prefs.headroomHeight, 80, 48, 120),
      floorThickness: boundedPreference(prefs.floorThickness, 10, 0, 36)
    };
    const changed = clean.stairRiserLimit !== prefs.stairRiserLimit ||
      clean.treadDepth !== prefs.treadDepth ||
      clean.headroomHeight !== prefs.headroomHeight ||
      clean.floorThickness !== prefs.floorThickness;
    if (changed) {
      engine.updatePreferences(clean);
    }
    return clean;
  }

  function setValidatedRiserLimit(engine, inches) {
    const value = Number(inches);
    if (!Number.isFinite(value) || value < 4 || value > 7.875) {
      engine.setError("Riser height must be 4-7 7/8 inches");
      return;
    }
    engine.updatePreferences({ stairRiserLimit: value });
    engine.setCurrent(Engine.makeValue(value, "length", "in", {
      format: "inch-fraction",
      forceInches: true,
      unitLabel: "INCH"
    }), "Riser limit set");
    engine.state.status = "Riser limit set";
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
      if (columnConeCanContinue(engine)) {
        columnCone(engine, !engine.state.columnConeCycle.isCone);
        return [];
      }
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
    const minorAngleRadians = 2 * Math.asin(Math.min(1, chord / (2 * radius)));
    const angleRadians = rise > radius ? (2 * PI) - minorAngleRadians : minorAngleRadians;
    const angle = angleRadians * 180 / PI;
    const arcLength = radius * angleRadians;
    const triangleArea = 0.5 * radius * radius * Math.sin(minorAngleRadians);
    const pieSliceArea = 0.5 * radius * radius * angleRadians;
    const segmentArea = rise > radius ? pieSliceArea + triangleArea : pieSliceArea - triangleArea;
    return { radius, angle, arcLength, chord, rise, segmentArea, pieSliceArea, source: "chord-rise" };
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
        label: "Chord Length",
        value: Engine.makeValue(data.chord, "length", "ft", { format: "feet-inch" })
      };
    }
    if (step === 4) {
      return {
        label: "Segment Area",
        value: Engine.makeValue(data.segmentArea, "area", "sqft", { precision: 6, noTrailingDecimal: true })
      };
    }
    if (step === 5) {
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
      engine.commitInputAsScalar();
      if (engine.getRegister("run") && engine.getRegister("rise")) {
        const data = arcFromChordRise(engine);
        setArcResult(engine, data, 0);
        engine.state.registers.radius = Engine.makeValue(data.radius, "length", "ft", { format: "feet-inch" });
        engine.addHistory("Arc radius", "Chord " + formatValue(Engine.makeValue(data.chord, "length", "ft"), engine.state.preferences) +
          " | Rise " + formatValue(Engine.makeValue(data.rise, "length", "ft"), engine.state.preferences) +
          " | Radius " + formatValue(engine.state.current, engine.state.preferences));
        return [];
      }
      if (engine.state.current && engine.state.current.dimension === "length" && engine.state.current.baseValue > 0) {
        const radiusValue = Engine.makeValue(engine.state.current.baseValue, "length", engine.state.current.unit || "ft", {
          format: "feet-inch",
          showZeroFeet: true
        });
        engine.state.registers.radius = radiusValue;
        engine.setCurrent(radiusValue, "Radius");
        engine.state.lastFunction = "arc-radius";
        engine.addHistory("Radius", formatValue(radiusValue, engine.state.preferences));
        return [];
      }
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
            ? 7
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
      const circle = engine.state.circleCycle;
      const radiusValue = engine.getRegister("radius");
      const height = requireLength(engine, "height");
      let radius = 0;
      if (circle && circle.diameter > 0) {
        radius = circle.diameter / 2;
      } else if (radiusValue && radiusValue.dimension === "length") {
        radius = radiusValue.baseValue;
      }
      if (!radius) {
        throw new Error("Missing diameter");
      }
      let volume = PI * radius * radius * height;
      if (isCone) {
        volume /= 3;
      }
      engine.setCurrent(Engine.makeValue(volume, "volume", "cuft", { precision: 6, noTrailingDecimal: true }), isCone ? "Cone Volume" : "Column Volume");
      engine.state.columnConeCycle = {
        radius,
        height,
        isCone: Boolean(isCone),
        lastBaseValue: engine.state.current.baseValue,
        lastDimension: engine.state.current.dimension
      };
      engine.addHistory(isCone ? "Cone volume" : "Column volume", formatValue(engine.state.current, engine.state.preferences));
      return [];
    } catch (error) {
      engine.setError(error.message);
      return [];
    }
  }

  function columnConeCanContinue(engine) {
    const cycle = engine.state.columnConeCycle;
    const current = engine.state.current;
    return Boolean(cycle && current &&
      current.dimension === cycle.lastDimension &&
      Math.abs(current.baseValue - cycle.lastBaseValue) < 0.000001);
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

  function polygonCanContinue(engine) {
    const cycle = engine.state.polygonCycle;
    const current = engine.state.current;
    return Boolean(cycle && current &&
      current.dimension === cycle.lastDimension &&
      Math.abs(current.baseValue - cycle.lastBaseValue) < 0.000001);
  }

  function polygonDisplayValue(data, step) {
    if (step === 0) {
      return {
        label: "Full Angle",
        value: Engine.makeValue(data.fullAngle, "angle", "deg", { precision: 2, noTrailingDecimal: true })
      };
    }
    if (step === 1) {
      return {
        label: "Half Angle",
        value: Engine.makeValue(data.halfAngle, "angle", "deg", { precision: 2, noTrailingDecimal: true })
      };
    }
    if (step === 2) {
      return {
        label: "Side Length",
        value: Engine.makeValue(data.sideLength, "length", "ft", { format: "feet-inch", showZeroFeet: true })
      };
    }
    if (step === 3) {
      return {
        label: "Perimeter",
        value: Engine.makeValue(data.perimeter, "length", "ft", { format: "feet-inch", showZeroFeet: true })
      };
    }
    return {
      label: "Area",
      value: Engine.makeValue(data.area, "area", "sqft", { precision: 6, noTrailingDecimal: true })
    };
  }

  function setPolygonResult(engine, data, step) {
    const result = polygonDisplayValue(data, step);
    engine.setCurrent(result.value, result.label);
    engine.state.lastFunction = "polygon";
    engine.state.polygonCycle = Object.assign({}, data, {
      step,
      lastBaseValue: engine.state.current.baseValue,
      lastDimension: engine.state.current.dimension
    });
    return result.value;
  }

  function polygonCycleNext(engine) {
    const nextStep = (engine.state.polygonCycle.step + 1) % 5;
    setPolygonResult(engine, engine.state.polygonCycle, nextStep);
  }

  function polygon(engine) {
    try {
      const sides = Math.round(currentAsNumber(engine));
      const radius = requireLength(engine, "radius");
      if (sides < 3) {
        throw new Error("Polygon needs at least 3 sides");
      }
      const fullAngle = ((sides - 2) * 180) / sides;
      const halfAngle = fullAngle / 2;
      const sideLength = 2 * radius * Math.sin(PI / sides);
      const perimeter = sideLength * sides;
      const area = (sides / 2) * radius * radius * Math.sin((2 * PI) / sides);
      const data = { sides, radius, fullAngle, halfAngle, sideLength, perimeter, area };
      setPolygonResult(engine, data, 0);
      engine.addHistory("Polygon", sides + " sides @ radius " +
        formatValue(Engine.makeValue(radius, "length", "ft", { format: "feet-inch", showZeroFeet: true }), engine.state.preferences));
      return [];
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
    try {
      engine.commitInputAsScalar();
      const current = engine.state.current || Engine.makeValue(0, "scalar", "scalar");
      const meta = current.meta || {};
      if (current.dimension === "angle" && meta.format === "dms") {
        engine.setCurrent(Engine.makeValue(current.baseValue, "angle", "deg", {
          noTrailingDecimal: true,
          precision: Number(engine.state.preferences.degreePrecision) || 2
        }), "Decimal Degrees");
        engine.addHistory("DMS to decimal", engine.state.current);
        return [];
      }
      const degrees = current.dimension === "angle" ? current.baseValue : current.baseValue;
      const text = Engine.decimalDegreesToDmsText(degrees);
      engine.setCurrent(Engine.makeValue(degrees, "angle", "deg", {
        format: "dms",
        dmsText: text
      }), "DMS");
      engine.addHistory("Decimal to DMS", text);
      return [];
    } catch (error) {
      engine.setError(error.message);
      return [];
    }
  }

  function reciprocalOrError(engine) {
    engine.reciprocal();
    return [];
  }

  global.JgcCalculatorFunctions = {
    lengthPrimary,
    widthPrimary,
    heightPrimary,
    pitchPrimary,
    risePrimary,
    runPrimary,
    diagPrimary,
    hipValley,
    irregularPitch,
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
