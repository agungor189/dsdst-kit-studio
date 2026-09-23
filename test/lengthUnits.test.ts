import assert from "node:assert/strict";
import test from "node:test";
import { formatLengthFromMm, parseLengthToMm } from "../src/lengthUnits.js";

test("mm, cm and m display values round-trip through integer millimeters", () => {
  for (const [input, unit, millimeters] of [
    ["1800", "mm", 1800],
    ["180", "cm", 1800],
    ["1.8", "m", 1800],
    ["33.7", "cm", 337],
    ["1250", "mm", 1250],
    ["125", "cm", 1250],
    ["1.25", "m", 1250],
  ] as const) {
    assert.equal(parseLengthToMm(input, unit), millimeters);
    assert.equal(parseLengthToMm(formatLengthFromMm(millimeters, unit), unit), millimeters);
  }
});

test("display conversion rejects sub-millimeter precision", () => {
  assert.equal(parseLengthToMm("0.1", "mm"), null);
  assert.equal(parseLengthToMm("0.01", "cm"), null);
  assert.equal(parseLengthToMm("0.0001", "m"), null);
  assert.equal(parseLengthToMm("33.75", "cm"), null);
});
