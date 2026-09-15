import assert from "node:assert/strict";
import test from "node:test";
import { calculatePricing } from "./pricing.js";

test("pricing calculates connector snapshots, profile meters, fractional complementary units and VAT", () => {
  const result = calculatePricing({
    connectors: [{ quantity: 8, purchase_price_snapshot_cents: 7200, sale_price_snapshot_cents: 12000 }],
    profile: { purchase_price_snapshot_cents: 8000, sale_price_snapshot_cents: 12000, weight_per_meter_snapshot_kg: 0.32 },
    cuts: [{ quantity: 4, length_mm: 1800 }],
    complementary: [
      { quantity_milli: 4_000, purchase_price_snapshot_cents: 8500, sale_price_snapshot_cents: 13500 },
      { quantity_milli: 1_750, purchase_price_snapshot_cents: 19500, sale_price_snapshot_cents: 28500 },
      { quantity_milli: 3_400, purchase_price_snapshot_cents: 2200, sale_price_snapshot_cents: 3900 },
    ],
    vatRateBasisPoints: 2000,
  });
  assert.equal(result.connectors.sale_cents, 96_000);
  assert.equal(result.profiles.total_millimeters, 7200);
  assert.equal(result.profiles.cost_cents, 57_600);
  assert.equal(result.profiles.sale_cents, 86_400);
  assert.equal(result.profiles.weight_grams, 2304);
  assert.equal(result.complementary.cost_cents, 75_605);
  assert.equal(result.complementary.sale_cents, 117_135);
  assert.equal(result.total_cost_cents, 190_805);
  assert.equal(result.sale_ex_vat_cents, 299_535);
  assert.equal(result.gross_profit_cents, 108_730);
  assert.equal(result.vat_cents, 59_907);
  assert.equal(result.sale_inc_vat_cents, 359_442);
});
