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
  pressSequence(calc, ["1", "0", "ft", "*", "1", "2", "ft", "*", "4", "in", "="]);
  approx(calc.state.current.baseValue / 46656, 1.481481, 0.0001, "10 ft x 12 ft x 4 in cu yd");

  calc = newCalc();
  pressSequence(calc, ["1", "0", "ft"]);
  calc.convertCurrent("m");
  approx(Engine.convertDisplay(calc.state.current, "m"), 3.048, 0.00001, "10 ft to m");

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
  calc.applyUnit("ft");
  assert(calc.getDisplay().main === "0.75521" && calc.getDisplay().unit === "FT", "feet feet returns decimal feet after fractional inches");

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
  pressSequence(calc, ["8", "in"]);
  Fn.circle(calc);
  assert(calc.getDisplay().mode === "Diameter" && calc.getDisplay().main === "8" && calc.getDisplay().unit === "INCH", "circle starts with diameter");
  Fn.circle(calc);
  assert(calc.getDisplay().mode === "Circumference" && calc.getDisplay().main === "25 1/8" && calc.getDisplay().unit === "INCH", "circle circumference cycles as fractional inches");
  Fn.circle(calc);
  approx(calc.state.current.baseValue, 50.265482, 0.000001, "8 inch circle area");
  assert(calc.getDisplay().mode === "Area" && calc.getDisplay().unit === "SQUARE INCH", "circle area displays square inches");

  calc = newCalc();
  calc.state.registers.radius = Engine.valueFromDisplay(10, "ft");
  calc.state.current = Engine.makeValue(90, "angle", "deg");
  Fn.arc(calc);
  approx(calc.state.current.baseValue / 12, 15.708, 0.001, "arc length");

  calc = newCalc();
  calc.state.registers.height = Engine.valueFromDisplay(2, "in");
  calc.state.registers.width = Engine.valueFromDisplay(10, "in");
  calc.state.registers.length = Engine.valueFromDisplay(12, "ft");
  Fn.boardFeet(calc);
  approx(calc.state.current.baseValue, 20, 0.0001, "board feet");

  calc = newCalc();
  calc.state.registers.length = Engine.valueFromDisplay(20, "ft");
  Fn.studs(calc);
  approx(calc.state.current.baseValue, 16, 0.0001, "studs");

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
