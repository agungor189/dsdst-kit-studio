import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type Database from "better-sqlite3";
import { openDatabase } from "../db/index.js";
import { canonicalSizeKey, compatibleConnectorsForProfile, compatibleProfilesForConnector, isCompatible, resolveConnector, validateConnectorSelection } from "./compatibility.js";

let db: Database.Database;
before(() => { db = openDatabase(":memory:"); });
after(() => db.close());

test("Square 20×20 connector accepts Square 20×20 profile", () => {
  assert.equal(validateConnectorSelection(db, "profile-sq20", "panel-s20-elb"), true);
});

test("Square 20×20 connector rejects Square 40×40 profile", () => {
  assert.equal(validateConnectorSelection(db, "profile-sq40", "panel-s20-elb"), false);
});

test("Square connector rejects Round profile", () => {
  assert.equal(validateConnectorSelection(db, "profile-rd337", "panel-s20-elb"), false);
});

test("profile-first filtering only returns the selected compatibility group", () => {
  const rows = compatibleConnectorsForProfile(db, "profile-sq20") as any[];
  assert.ok(rows.length > 0);
  assert.deepEqual(new Set(rows.map((row) => row.compatibility_group)), new Set(["SQ-20X20"]));
});

test("connector-first filtering only returns compatible profiles", () => {
  const rows = compatibleProfilesForConnector(db, "panel-s20-tee") as any[];
  assert.deepEqual(rows.map((row) => row.id), ["profile-sq20"]);
});

test("resolver maps roles through metadata rather than parsing SKU", () => {
  assert.equal((resolveConnector(db, "ELB", "profile-sq20") as any).sku, "AL-S20-ELB");
  assert.equal((resolveConnector(db, "ELB", "profile-sq40") as any).sku, "AL-S40-ELB");
  assert.equal((resolveConnector(db, "ELB", "profile-rd337") as any).sku, "AL-R100-ELB");
  assert.equal(resolveConnector(db, "3W", "profile-rd337"), null);
});

test("wall thickness outside declared range is incompatible", () => {
  assert.equal(isCompatible({ connector_role: "ELB", profile_shape: "SQUARE", profile_width_mm: 20, profile_height_mm: 20, outside_diameter_mm: null, nominal_size: null, compatible_material_group: "ALUMINUM", wall_min_mm: 1, wall_max_mm: 2, compatibility_group: "SQ-20" }, { shape: "SQUARE", material: "Aluminum", width_mm: 20, height_mm: 20, outside_diameter_mm: null, nominal_size: null, wall_thickness_mm: 3, compatibility_group: "SQ-20" }), false);
});

test("R100, one inch, 33.7 mm and RD-33.7 resolve to the same physical size", () => {
  assert.equal(canonicalSizeKey({ profile_shape: "ROUND", profile_width_mm: null, profile_height_mm: null, outside_diameter_mm: null, nominal_size: "R100", compatibility_group: "R100" }), "ROUND:33.7");
  assert.equal(canonicalSizeKey({ shape: "ROUND", width_mm: null, height_mm: null, outside_diameter_mm: null, nominal_size: "1 inch", compatibility_group: "legacy-inch" }), "ROUND:33.7");
  assert.equal(canonicalSizeKey({ shape: "ROUND", width_mm: null, height_mm: null, outside_diameter_mm: null, nominal_size: "33.7 mm", compatibility_group: "legacy-mm" }), "ROUND:33.7");
  assert.equal(canonicalSizeKey({ shape: "ROUND", width_mm: null, height_mm: null, outside_diameter_mm: null, nominal_size: null, compatibility_group: "RD-33.7" }), "ROUND:33.7");
});

test("physical compatibility permits different connector and profile materials", () => {
  assert.equal(isCompatible(
    { connector_role: "ELB", profile_shape: "ROUND", profile_width_mm: null, profile_height_mm: null, outside_diameter_mm: 33.7, nominal_size: '1"', compatible_material_group: "ALUMINUM", wall_min_mm: 1, wall_max_mm: 4, compatibility_group: "RD-33.7" },
    { shape: "ROUND", material: "PPR", width_mm: null, height_mm: null, outside_diameter_mm: 33.7, nominal_size: "1 inch", wall_thickness_mm: 2, compatibility_group: "R100" },
  ), true);
});
