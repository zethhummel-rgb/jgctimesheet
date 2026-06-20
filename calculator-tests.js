/* eslint-disable no-console */
require("./calculator-engine.js");
require("./calculator-functions.js");

const Engine = globalThis.JgcCalculatorEngine;
const Fn = globalThis.JgcCalculatorFunctions;

function approx(actual, expected, tolerance, label) {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(label + " expected " + expected + " but got " + actual);
  }
}

function assert(condition, label) {
  if (!condition) {
    throw new Error(label);
  }
}

function newCalc() {
  return new Engine.CalculatorEngine();
}

function pressSequence(calc, items) {
  items.forEach((item) => {
    if (/^\d$/.test(item)) calc.pressDigit(item);
    else if (item === ".") calc.pressDecimal();
    else if (item === "ft") calc.applyUnit("ft");
    else if (item === "in") calc.applyUnit("in");
    else if (item === "yd") calc.applyUnit("yd");
    else if (item === "mm") calc.applyUnit("mm");
    else if (item === "/") calc.pressFraction();
    else if (["+", "-", "*", "/op"].includes(item)) calc.pressOperator(item === "/op" ? "/" : item);
    else if (item === "=") calc.equals();
    else throw new Error("Unknown sequence item " + item);
  });
}

function runTests() {
  let calc = newCalc();
  pressSequence(calc, ["4", "ft", "6", "in", "+", "2", "ft", "3", "in", "="]);
  assert(Engine.formatValue(calc.state.current, calc.state.preferences).main === "6\u2032-9\u2033", "4 ft 6 in + 2 ft 3 in");

  calc = newCalc();
  pressSequence(calc, ["5", "ft", "1", "in", "1", "/", "2"]);
  assert(calc.getDisplay().main === "5\u2032-1 1/2\u2033", "5 ft 1 in 1/2 appends fraction without second inch key");

  calc = newCalc();
  pressSequence(calc, ["8", "in", "1", "/", "8"]);
  assert(calc.getDisplay().main === "8 1/8" && calc.getDisplay().unit === "IN", "8 in 1/8 displays fractional inches");

  calc = newCalc();
  calc.pressDigit("1");
  calc.pressDigit("5");
  calc.pressFraction();
  calc.equals();
  assert(calc.getDisplay().main === "0-15/16" && calc.getDisplay().unit === "IN", "bare fraction uses default denominator");

  calc = newCalc();
  calc.updatePreferences({ fractionDenominator: 64, fractionMode: "fixed" });
  calc.state.current = Engine.valueFromDisplay(0.6875, "in", { format: "inch-fraction", forceInches: true });
  assert(calc.getDisplay().main === "0-44/64", "constant fraction mode keeps denominator");

  calc = newCalc();
  calc.setFractionResolution(8);
  calc.pressDigit("1");
  calc.pressFraction();
  calc.equals();
  assert(calc.getDisplay().main === "0-1/8" && calc.getDisplay().unit === "IN", "fraction resolution shortcut changes default denominator");

  calc = newCalc();
  calc.state.current = Engine.valueFromDisplay(11.75, "in");
  calc.pressOperator("+");
  calc.pressDigit("1");
  calc.pressFraction();
  calc.pressDigit("2");
  calc.applyUnit("in");
  calc.equals();
  assert(Engine.formatValue(calc.state.current, calc.state.preferences).main === "1\u2032-0 1/4\u2033", "11 3/4 in + 1/2 in");

  calc = newCalc();
  pressSequence(calc, ["1", "0", "ft", "*", "1", "2", "ft", "="]);
  approx(calc.state.current.baseValue / 144, 120, 0.0001, "10 ft x 12 ft sq ft");
  calc.updatePreferences({ areaDisplay: "sqm" });
  assert(Engine.formatValue(calc.state.current, calc.state.preferences).unit === "SQUARE METER", "area display preference changes formatted unit");
  approx(Number(Engine.formatValue(calc.state.current, calc.state.preferences).main.replace(/,/g, "")), 11.1484, 0.0001, "area display preference converts to square meters");
  calc.applyUnit("ft");
  assert(calc.getDisplay().unit === "SQUARE FEET", "manual area conversion overrides area display preference");
  approx(Engine.convertDisplay(calc.state.current, "sqft"), 120, 0.0001, "manual square feet conversion keeps area value");

  calc = newCalc();
  pressSequence(calc, ["7", "ft", "*", "7", "ft", "1", "in", "3", "/", "4"]);
  assert(calc.getDisplay().main === "7\u2032-1 3/4\u2033", "fraction appends to compound second operand while multiplying");
  calc.equals();
  approx(calc.state.current.baseValue / 144, 50.020833, 0.000001, "7 ft x 7 ft 1 3/4 in sq ft");

  calc = newCalc();
  pressSequence(calc, ["1", "0", "0", "ft", "ft"]);
  assert(calc.state.current.dimension === "area" && calc.state.current.unit === "sqft", "100 ft ft becomes square feet");
  approx(Engine.convertDisplay(calc.state.current, "sqft"), 100, 0.0001, "100 square feet display value");

  calc = newCalc();
  pressSequence(calc, ["1", "0", "0", "ft", "ft", "ft"]);
  assert(calc.state.current.dimension === "volume" && calc.state.current.unit === "cuft", "100 ft ft ft becomes cubic feet");
  approx(Engine.convertDisplay(calc.state.current, "cuft"), 100, 0.0001, "100 cubic feet display value");
  calc.applyUnit("ft");
  assert(calc.state.current.dimension === "length" && calc.state.current.unit === "ft", "repeated feet cycles cubic back to linear");
  approx(Engine.convertDisplay(calc.state.current, "ft"), 100, 0.0001, "cycled linear feet display value");

  calc = newCalc();
  calc.state.current = Engine.valueFromDisplay(55296, "cuin");
  assert(calc.getDisplay().main === "55,296." && calc.getDisplay().unit === "CUBIC INCH", "calculator display formats cubic inches like field calculator");

  calc = newCalc();
  pressSequence(calc, ["5", "yd", "yd", "yd"]);
  assert(calc.state.current.dimension === "volume" && calc.state.current.unit === "cuyd", "5 yds yds yds becomes cubic yards");

  calc = newCalc();
  pressSequence(calc, ["2", ".", "7", "8", "yd", "yd", "yd"]);
  assert(calc.state.current.dimension === "volume" && calc.state.current.unit === "cuyd", "2.78 yds yds yds becomes decimal cubic yards");
  approx(Engine.convertDisplay(calc.state.current, "cuyd"), 2.78, 0.000001, "2.78 cubic yards value is preserved");

  calc = newCalc();
  pressSequence(calc, ["1", "0", "ft", "*", "1", "2", "ft", "*", "4", "in", "="]);
  approx(calc.state.current.baseValue / 46656, 1.481481, 0.0001, "10 ft x 12 ft x 4 in cu yd");
  calc.updatePreferences({ volumeDisplay: "cuyd" });
  assert(Engine.formatValue(calc.state.current, calc.state.preferences).unit === "CUBIC YARD", "volume display preference changes formatted unit");
  calc.applyUnit("ft");
  assert(calc.getDisplay().unit === "CUBIC FEET", "manual volume conversion overrides volume display preference");
  approx(Engine.convertDisplay(calc.state.current, "cuft"), 40, 0.0001, "manual cubic feet conversion keeps volume value");

  calc = newCalc();
  pressSequence(calc, ["1", "0", "ft"]);
  calc.convertCurrent("m");
  approx(Engine.convertDisplay(calc.state.current, "m"), 3.048, 0.00001, "10 ft to m");
  calc.updatePreferences({ meterPrecision: 2 });
  assert(calc.getDisplay().main === "3.05", "meter precision preference affects display");

  calc = newCalc();
  calc.pressDigit("1");
  calc.pressDigit("0");
  calc.pressDigit("0");
  calc.applyUnit("cm");
  calc.convertCurrent("in");
  approx(Engine.convertDisplay(calc.state.current, "in"), 39.3701, 0.0001, "100 cm to inches");

  calc = newCalc();
  calc.pressDigit("5");
  calc.convertCurrent("mm");
  calc.applyUnit("mm");
  calc.applyUnit("mm");
  assert(calc.state.current.dimension === "volume" && calc.state.current.unit === "cumm", "5 conv 9 9 9 engine path becomes cubic millimeters");

  calc = newCalc();
  pressSequence(calc, ["1", "7", ".", "3", "2", "ft"]);
  assert(calc.getDisplay().main === "17.32" && calc.getDisplay().unit === "FT", "17.32 feet stays decimal feet");
  calc.convertCurrent("ft");
  assert(calc.getDisplay().main === "17\u2032-3 13/16\u2033", "conv feet toggles decimal feet to feet-inch-fraction");
  calc.applyUnit("ft");
  assert(calc.getDisplay().main === "17.32" && calc.getDisplay().unit === "FT", "feet toggles feet-inch-fraction back to decimal feet");

  calc = newCalc();
  pressSequence(calc, ["9", ".", "0", "6", "2", "5", "in"]);
  assert(calc.getDisplay().main === "9.0625" && calc.getDisplay().unit === "IN", "9.0625 inches stays decimal inches");
  calc.convertCurrent("in");
  assert(calc.getDisplay().main === "9 1/16" && calc.getDisplay().unit === "IN", "conv inch toggles decimal inches to fractional inches");
  calc.applyUnit("ft");
  assert(calc.getDisplay().main === "0.75521" && calc.getDisplay().unit === "FT", "feet feet returns decimal feet after fractional inches");
  calc.applyUnit("ft");
  assert(calc.getDisplay().main === "0\u2032-9 1/16\u2033" && calc.getDisplay().unit === "FEET INCH", "feet toggles decimal feet to feet-inch after fractional inches");

  calc = newCalc();
  pressSequence(calc, ["5", ".", "2", "5", "in"]);
  assert(calc.getDisplay().main === "5.25" && calc.getDisplay().unit === "IN", "5.25 inches stays decimal after entry");
  calc.applyUnit("ft");
  assert(calc.getDisplay().main === "0.4375" && calc.getDisplay().unit === "FT", "5.25 inches converts to decimal feet");
  calc.applyUnit("ft");
  assert(calc.getDisplay().main === "0\u2032-5 1/4\u2033" && calc.getDisplay().unit === "FEET INCH", "feet toggles to feet-inch-fraction");
  calc.applyUnit("ft");
  assert(calc.getDisplay().main === "0.4375" && calc.getDisplay().unit === "FT", "feet toggles back to decimal feet");
  calc.applyUnit("in");
  assert(calc.getDisplay().main === "5 1/4" && calc.getDisplay().unit === "IN", "inches shows fractional inches after feet");
  calc.applyUnit("in");
  assert(calc.getDisplay().main === "5.25" && calc.getDisplay().unit === "IN", "inches toggles back to decimal inches");

  calc = newCalc();
  calc.state.registers.rise = Engine.valueFromDisplay(6, "in");
  calc.state.registers.run = Engine.valueFromDisplay(12, "in");
  Fn.pitchPrimary(calc);
  approx(calc.state.current.baseValue, 6, 0.0001, "6/12 pitch");
  Fn.pitchPrimary(calc);
  approx(calc.state.current.baseValue, 26.565, 0.001, "roof angle");
  Fn.pitchPrimary(calc);
  approx(calc.state.current.baseValue, 50, 0.001, "roof slope percent");

  calc = newCalc();
  calc.state.registers.rise = Engine.valueFromDisplay(6, "in");
  calc.state.registers.run = Engine.valueFromDisplay(12, "in");
  calc.state.circleCycle = { step: 1, lastBaseValue: 1, lastDimension: "length" };
  calc.clear();
  assert(calc.getRegister("rise") && calc.getRegister("run"), "single clear keeps temporary construction registers");
  calc.clear();
  assert(!calc.getRegister("rise") && !calc.getRegister("run"), "double clear removes temporary construction registers");
  assert(!calc.state.circleCycle && calc.state.status === "Working values cleared", "double clear removes temporary cycles");

  calc = newCalc();
  pressSequence(calc, ["7", "in"]);
  Fn.pitchPrimary(calc);
  assert(calc.state.registers.pitch && calc.state.registers.pitch.baseValue === 7, "manual pitch stores 7 inch pitch");
  assert(calc.getDisplay().mode === "Pitch" && calc.getDisplay().main === "7" && calc.getDisplay().unit === "INCH", "pitch display matches manual entry");
  pressSequence(calc, ["1", "1", "ft", "6", "in"]);
  Fn.runPrimary(calc);
  approx(calc.state.registers.run.baseValue, 138, 0.0001, "manual run stores 11 ft 6 in");
  assert(calc.getDisplay().mode === "Run" && calc.getDisplay().main === "11\u2032-6\u2033", "run display matches manual entry");
  Fn.risePrimary(calc);
  approx(calc.state.current.baseValue, 80.5, 0.0001, "rise from 7/12 pitch and 11 ft 6 in run");
  assert(calc.getDisplay().mode === "Rise" && calc.getDisplay().main === "6\u2032-8 1/2\u2033", "rise display matches manual");

  calc = newCalc();
  pressSequence(calc, ["9", "ft"]);
  Fn.risePrimary(calc);
  approx(calc.state.registers.rise.baseValue, 108, 0.0001, "manual rise stores 9 feet");
  pressSequence(calc, ["3", "5", ".", "5"]);
  Fn.pitchPrimary(calc);
  assert(calc.getDisplay().mode === "Pitch" && calc.getDisplay().unit === "DEG", "decimal pitch stores as roof angle");
  Fn.runPrimary(calc);
  assert(calc.getDisplay().mode === "Run" && calc.getDisplay().main === "12\u2032-7 7/16\u2033", "run from 9 ft rise and 35.5 degree pitch matches CMPro");

  calc = newCalc();
  pressSequence(calc, ["9", "ft"]);
  Fn.risePrimary(calc);
  pressSequence(calc, ["1", "5", "ft"]);
  Fn.runPrimary(calc);
  Fn.diagPrimary(calc);
  assert(calc.getDisplay().mode === "Diagonal" && calc.getDisplay().main === "17\u2032-5 15/16\u2033", "diag from 9 ft rise and 15 ft run matches CMPro");
  Fn.diagPrimary(calc);
  assert(calc.getDisplay().mode === "Plumb Cut", "diag cycles to plumb cut");
  approx(calc.state.current.baseValue, 30.96, 0.01, "plumb cut from 9 ft rise and 15 ft run matches CMPro");
  Fn.diagPrimary(calc);
  assert(calc.getDisplay().mode === "Level Cut", "diag cycles to level cut");
  approx(calc.state.current.baseValue, 59.04, 0.01, "level cut from 9 ft rise and 15 ft run matches CMPro");
  Fn.diagPrimary(calc);
  assert(calc.getDisplay().mode === "Diagonal" && calc.getDisplay().main === "17\u2032-5 15/16\u2033", "diag cycles back to diagonal");

  calc = newCalc();
  pressSequence(calc, ["8", "in"]);
  Fn.circle(calc);
  assert(calc.getDisplay().mode === "Diameter" && calc.getDisplay().main === "8" && calc.getDisplay().unit === "INCH", "circle starts with diameter");
  Fn.circle(calc);
  assert(calc.getDisplay().mode === "Circumference" && calc.getDisplay().main === "25 1/8" && calc.getDisplay().unit === "INCH", "circle circumference cycles as fractional inches");
  Fn.circle(calc);
  approx(calc.state.current.baseValue, 50.265482, 0.000001, "8 inch circle area");
  assert(calc.getDisplay().mode === "Area" && calc.getDisplay().unit === "SQUARE INCH", "circle area displays square inches");

  calc = newCalc();
  pressSequence(calc, ["3", "ft", "4", "in", "1", "/", "1", "2"]);
  Fn.circle(calc);
  assert(calc.getDisplay().mode === "Diameter" && calc.getDisplay().main === "3.34028", "fractional feet-inch circle starts with entered diameter");
  Fn.circle(calc);
  assert(calc.getDisplay().mode === "Circumference" && calc.getDisplay().main !== "3\u2032-4 1/16\u2033", "fractional feet-inch circle updates value when cycling");
  approx(calc.state.current.baseValue, Math.PI * (40 + 1 / 12), 0.000001, "fractional feet-inch circumference uses entered diameter");
  Fn.circle(calc);
  approx(calc.state.current.baseValue, Math.PI * Math.pow((40 + 1 / 12) / 2, 2), 0.000001, "fractional feet-inch circle area uses entered diameter");
  assert(calc.getDisplay().mode === "Area" && calc.getDisplay().unit === "SQUARE INCH", "fractional feet-inch circle cycles to area");

  calc = newCalc();
  calc.state.registers.radius = Engine.valueFromDisplay(10, "ft");
  calc.state.current = Engine.makeValue(90, "angle", "deg");
  Fn.arc(calc);
  approx(calc.state.current.baseValue / 12, 15.708, 0.001, "arc length");
  assert(calc.getDisplay().mode === "Arc Length", "radius plus angle arc displays on main screen");

  calc = newCalc();
  pressSequence(calc, ["3", "ft", "6", "in"]);
  Fn.runPrimary(calc);
  pressSequence(calc, ["1", "ft", "3", "in"]);
  Fn.risePrimary(calc);
  Fn.arcRadius(calc);
  approx(calc.state.current.baseValue, 22.2, 0.001, "arc radius from chord and segment rise");
  assert(calc.getDisplay().mode === "Radius" && calc.getDisplay().main === "1\u2032-10 3/16\u2033", "arc radius displays like manual");
  Fn.arc(calc);
  approx(calc.state.current.baseValue, 142.15, 0.05, "arc angle from chord and segment rise");
  assert(calc.getDisplay().mode === "Arc Angle", "arc cycles to angle");
  Fn.arc(calc);
  approx(calc.state.current.baseValue, 55.05, 0.05, "arc length from chord and segment rise");
  assert(calc.getDisplay().mode === "Arc Length" && calc.getDisplay().main === "4\u2032-7 1/16\u2033", "arc cycles to arc length");
  Fn.arc(calc);
  assert(calc.getDisplay().mode === "Chord Length" && calc.getDisplay().main === "3\u2032-6\u2033", "arc cycles to chord length");
  Fn.arc(calc);
  approx(calc.state.current.baseValue / 144, 3.195608, 0.00001, "arc segment area from chord and rise");
  Fn.arc(calc);
  approx(calc.state.current.baseValue / 144, 4.245608, 0.00001, "arc pie slice area from chord and rise");

  calc = newCalc();
  pressSequence(calc, ["2", "ft", "9", "in"]);
  Fn.runPrimary(calc);
  pressSequence(calc, ["1", "ft", "3", "in"]);
  Fn.risePrimary(calc);
  Fn.arcRadius(calc);
  assert(calc.getDisplay().mode === "Radius" && calc.getDisplay().main === "1′-4 9/16″", "minor arc radius matches CMPro tape");
  Fn.arc(calc);
  approx(calc.state.current.baseValue, 169.09, 0.01, "minor arc angle");
  Fn.arc(calc);
  assert(calc.getDisplay().mode === "Arc Length" && calc.getDisplay().main === "4′-0 15/16″", "minor arc length matches CMPro tape");
  Fn.arc(calc);
  assert(calc.getDisplay().mode === "Chord Length" && calc.getDisplay().main === "2′-9″", "minor arc chord length matches CMPro tape");
  Fn.arc(calc);
  approx(calc.state.current.baseValue / 144, 2.634814, 0.00001, "minor arc segment area");
  Fn.arc(calc);
  approx(calc.state.current.baseValue / 144, 2.815283, 0.00001, "minor arc pie slice area");
  Fn.arc(calc);
  assert(calc.getDisplay().mode === "Rise" && calc.getDisplay().main === "1′-3″", "minor arc cycles to rise");

  calc = newCalc();
  pressSequence(calc, ["6", "ft", "6", "in"]);
  Fn.runPrimary(calc);
  pressSequence(calc, ["5", "ft", "5", "in"]);
  Fn.risePrimary(calc);
  Fn.arcRadius(calc);
  assert(calc.getDisplay().mode === "Radius" && calc.getDisplay().main === "3\u2032-8 3/16\u2033", "major arc radius matches CMPro tape");
  Fn.arc(calc);
  approx(calc.state.current.baseValue, 236.14, 0.01, "major arc angle");
  Fn.arc(calc);
  assert(calc.getDisplay().mode === "Arc Length" && calc.getDisplay().main === "15\u2032-2 3/16\u2033", "major arc length matches CMPro tape");
  Fn.arc(calc);
  assert(calc.getDisplay().mode === "Chord Length" && calc.getDisplay().main === "6\u2032-6\u2033", "major arc chord length matches CMPro tape");
  Fn.arc(calc);
  approx(calc.state.current.baseValue / 144, 33.591464, 0.00001, "major arc segment area");
  Fn.arc(calc);
  approx(calc.state.current.baseValue / 144, 27.95813, 0.00001, "major arc pie slice area");
  Fn.arc(calc);
  assert(calc.getDisplay().mode === "Rise" && calc.getDisplay().main === "5\u2032-5\u2033", "major arc cycles to rise");

  calc = newCalc();
  pressSequence(calc, ["5", "ft"]);
  Fn.circle(calc);
  assert(calc.getDisplay().mode === "Diameter", "circle stores diameter for arc");
  pressSequence(calc, ["3", "ft", "3", "in"]);
  Fn.arc(calc);
  assert(calc.getDisplay().mode === "Arc Length" && calc.getDisplay().main === "3\u2032-3\u2033", "diameter arc starts with arc length");
  Fn.arc(calc);
  approx(calc.state.current.baseValue, 74.48, 0.01, "diameter arc angle");
  assert(calc.getDisplay().mode === "Arc Angle", "diameter arc cycles to angle");
  Fn.arc(calc);
  assert(calc.getDisplay().mode === "Chord Length" && calc.getDisplay().main === "3\u2032-0 5/16\u2033", "diameter arc cycles to chord length");
  Fn.arc(calc);
  approx(calc.state.current.baseValue / 144, 1.051381, 0.00001, "diameter arc segment area");
  assert(calc.getDisplay().mode === "Segment Area", "diameter arc cycles to segment area");
  Fn.arc(calc);
  approx(calc.state.current.baseValue / 144, 4.0625, 0.00001, "diameter arc pie slice area");
  assert(calc.getDisplay().mode === "Pie Slice Area", "diameter arc cycles to pie slice area");
  Fn.arc(calc);
  assert(calc.getDisplay().mode === "Rise" && calc.getDisplay().main === "0\u2032-6 1/8\u2033", "diameter arc cycles to rise");

  calc = newCalc();
  pressSequence(calc, ["1", "5", "ft"]);
  Fn.arcRadius(calc);
  assert(calc.getDisplay().mode === "Radius" && calc.getDisplay().main === "15\u2032", "conv arc stores radius from current length");
  pressSequence(calc, ["6"]);
  Fn.polygon(calc);
  approx(calc.state.current.baseValue, 120, 0.0001, "polygon full angle from radius and sides");
  assert(calc.getDisplay().mode === "Full Angle" && calc.getDisplay().main === "120", "polygon starts with full angle");
  Fn.runPrimary(calc);
  approx(calc.state.current.baseValue, 60, 0.0001, "polygon half angle");
  assert(calc.getDisplay().mode === "Half Angle" && calc.getDisplay().main === "60", "polygon cycles to half angle");
  Fn.runPrimary(calc);
  assert(calc.getDisplay().mode === "Side Length" && calc.getDisplay().main === "15\u2032", "polygon cycles to side length");
  Fn.runPrimary(calc);
  assert(calc.getDisplay().mode === "Perimeter" && calc.getDisplay().main === "90\u2032", "polygon cycles to perimeter");
  Fn.runPrimary(calc);
  approx(calc.state.current.baseValue / 144, 584.567148, 0.000001, "polygon area");
  assert(calc.getDisplay().mode === "Area" && calc.getDisplay().unit === "SQUARE FEET", "polygon cycles to area");

  calc = newCalc();
  pressSequence(calc, ["2", "ft", "4", "in"]);
  Fn.circle(calc);
  Fn.circle(calc);
  pressSequence(calc, ["4", "ft", "6", "in"]);
  calc.handleRegisterKey("height");
  Fn.columnCone(calc, false);
  approx(calc.state.current.baseValue / 1728, 19.242255, 0.00001, "column volume from circle diameter and height");
  assert(calc.getDisplay().mode === "Column Volume" && calc.getDisplay().unit === "CUBIC FEET", "column volume displays on main screen");

  calc = newCalc();
  pressSequence(calc, ["3", "ft", "6", "in"]);
  Fn.circle(calc);
  Fn.circle(calc);
  pressSequence(calc, ["5", "ft"]);
  calc.handleRegisterKey("height");
  Fn.columnCone(calc, false);
  Fn.circle(calc);
  approx(calc.state.current.baseValue / 1728, 16.035213, 0.00001, "cone volume cycles from column/cone");
  assert(calc.getDisplay().mode === "Cone Volume" && calc.getDisplay().unit === "CUBIC FEET", "cone volume displays on main screen");

  calc = newCalc();
  calc.state.registers.height = Engine.valueFromDisplay(2, "in");
  calc.state.registers.width = Engine.valueFromDisplay(10, "in");
  calc.state.registers.length = Engine.valueFromDisplay(12, "ft");
  Fn.boardFeet(calc);
  approx(calc.state.current.baseValue, 20, 0.0001, "board feet");

  calc = newCalc();
  pressSequence(calc, ["2", "*", "4", "*", "1", "6"]);
  Fn.boardFeet(calc);
  approx(calc.state.current.baseValue, 10.666667, 0.00001, "board feet from live multiplication");

  calc = newCalc();
  pressSequence(calc, ["2", "*", "4", "*", "1", "6"]);
  Fn.boardFeet(calc);
  calc.memoryPlus(1);
  pressSequence(calc, ["2", "*", "1", "0", "*", "1", "8"]);
  Fn.boardFeet(calc);
  calc.memoryPlus(1);
  pressSequence(calc, ["2", "*", "1", "2", "*", "2", "0"]);
  Fn.boardFeet(calc);
  calc.memoryPlus(1);
  approx(calc.state.memory.baseValue, 80.666667, 0.00001, "board feet accumulates with M+");

  calc = newCalc();
  calc.state.registers.length = Engine.valueFromDisplay(20, "ft");
  Fn.studs(calc);
  approx(calc.state.current.baseValue, 16, 0.0001, "studs");

  calc = newCalc();
  pressSequence(calc, ["1", "8", "ft", "7", "in", "1", "/", "2"]);
  const studRows = Fn.studs(calc);
  approx(calc.state.current.baseValue, 15, 0.0001, "studs uses current wall length");
  assert(calc.getDisplay().mode === "Stud count" && calc.getDisplay().main === "15", "studs displays in main screen");
  assert(Array.isArray(studRows) && studRows.length === 0, "studs does not open an overlay");

  calc = newCalc();
  calc.state.registers.length = Engine.valueFromDisplay(10, "ft");
  calc.updatePreferences({ footingArea: 288, volumeDisplay: "cuft" });
  Fn.concrete(calc);
  approx(calc.state.current.baseValue / 1728, 20, 0.0001, "footing area preference creates footing volume without width/height");

  calc = newCalc();
  calc.state.registers.length = Engine.valueFromDisplay(10, "ft");
  calc.state.registers.height = Engine.valueFromDisplay(8, "ft");
  calc.updatePreferences({ blockArea: 160, blockLength: 20 });
  Fn.blocks(calc);
  assert(calc.state.current.baseValue === 76, "block area preference changes block estimate");

  calc = newCalc();
  calc.state.current = Engine.valueFromDisplay(2, "cuyd");
  calc.updatePreferences({ weightPerVolume: 1.25 });
  calc.convertVolumeToWeight("ton");
  approx(Engine.convertDisplay(calc.state.current, "ton"), 2.5, 0.0001, "weight per volume preference converts cubic yards to tons");

  calc = newCalc();
  pressSequence(calc, ["2", "0", "ft", "6", "in"]);
  Fn.lengthPrimary(calc);
  pressSequence(calc, ["2", "5", "ft", "6", "in"]);
  Fn.widthPrimary(calc);
  Fn.widthPrimary(calc);
  approx(Engine.convertDisplay(calc.state.current, "sqft"), 522.75, 0.0001, "width cycle area");
  assert(calc.state.status === "Area", "width cycle starts at area");
  Fn.widthPrimary(calc);
  approx(calc.state.current.baseValue, Math.sqrt((20.5 * 12) ** 2 + (25.5 * 12) ** 2), 0.001, "width cycle square-up");
  assert(calc.state.status === "Square-Up", "width cycle square-up label");
  Fn.widthPrimary(calc);
  approx(calc.state.current.baseValue, 92 * 12, 0.001, "width cycle perimeter");
  assert(calc.state.status === "Perimeter", "width cycle perimeter label");

  calc = newCalc();
  pressSequence(calc, ["1", "5", "ft"]);
  Fn.lengthPrimary(calc);
  pressSequence(calc, ["2", "0", "ft"]);
  Fn.widthPrimary(calc);
  pressSequence(calc, ["1", "2", "ft"]);
  Fn.heightPrimary(calc);
  Fn.heightPrimary(calc);
  approx(Engine.convertDisplay(calc.state.current, "cuft"), 3600, 0.0001, "height cycle volume");
  assert(calc.state.status === "Volume", "height cycle starts at volume");
  Fn.heightPrimary(calc);
  approx(Engine.convertDisplay(calc.state.current, "sqft"), 840, 0.0001, "height cycle wall area");
  assert(calc.state.status === "Wall Area", "height cycle wall area label");
  Fn.heightPrimary(calc);
  approx(Engine.convertDisplay(calc.state.current, "sqft"), 1140, 0.0001, "height cycle surface area");
  assert(calc.state.status === "Surface Area", "height cycle surface area label");

  calc = newCalc();
  calc.state.registers.rise = Engine.valueFromDisplay(108, "in");
  Fn.stair(calc);
  approx(calc.state.current.baseValue, 7.7142857, 0.0001, "actual stair riser");
  assert(calc.state.status === "Riser height", "stair starts with riser height");
  Fn.stair(calc);
  assert(calc.state.current.baseValue === 14 && calc.state.status === "Risers", "stair risers");
  Fn.stair(calc);
  Fn.stair(calc);
  assert(calc.state.current.baseValue === 13 && calc.state.status === "Treads", "stair treads");

  calc = newCalc();
  calc.updatePreferences({ stairRiserLimit: 7.5, treadDepth: 10, headroomHeight: 80, floorThickness: 10 });
  calc.state.current = Engine.valueFromDisplay(49, "in");
  Fn.risePrimary(calc);
  assert(calc.state.registers.rise && calc.state.registers.rise.baseValue === 49, "rise stores without run");
  Fn.stair(calc);
  approx(calc.state.current.baseValue, 7, 0.0001, "49 inch stair riser height");
  Fn.stair(calc);
  assert(calc.state.current.baseValue === 7 && calc.state.status === "Risers", "49 inch stair risers");
  Fn.stair(calc);
  approx(calc.state.current.baseValue, 10, 0.0001, "49 inch stair tread width");
  Fn.stair(calc);
  assert(calc.state.current.baseValue === 6 && calc.state.status === "Treads", "49 inch stair treads");
  Fn.stair(calc);
  approx(calc.state.current.baseValue, 128.5714, 0.001, "49 inch stairwell opening");
  Fn.stair(calc);
  approx(calc.state.current.baseValue, 73.2393, 0.001, "49 inch stringer length");
  Fn.stair(calc);
  approx(calc.state.current.baseValue, 34.992, 0.01, "49 inch stair angle");
  Fn.stair(calc);
  approx(calc.state.current.baseValue, 60, 0.0001, "49 inch stair run");
  Fn.stair(calc);
  approx(calc.state.current.baseValue, 49, 0.0001, "49 inch stored rise");
  Fn.stair(calc);
  approx(calc.state.current.baseValue, 7.5, 0.0001, "stored riser preference");
  Fn.stair(calc);
  approx(calc.state.current.baseValue, 80, 0.0001, "stored headroom");
  Fn.stair(calc);
  approx(calc.state.current.baseValue, 10, 0.0001, "stored floor thickness");

  calc = newCalc();
  calc.state.current = Engine.makeValue(1, "scalar", "scalar");
  calc.pressOperator("/");
  calc.state.current = Engine.makeValue(0, "scalar", "scalar");
  calc.equals();
  assert(calc.state.error === "Divide by zero", "divide by zero error");

  calc = newCalc();
  calc.state.current = Engine.valueFromDisplay(5, "ft");
  calc.pressOperator("+");
  calc.state.current = Engine.valueFromDisplay(3, "sqft");
  calc.equals();
  assert(calc.state.error === "Incompatible units", "incompatible units error");

  console.log("calculator tests passed");
}

if (require.main === module) {
  runTests();
}

module.exports = { runTests };
