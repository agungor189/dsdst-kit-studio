import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type Database from "better-sqlite3";
import { openDatabase } from "../db/index.js";
import { compatibleConnectorsForProfile, compatibleProfilesForConnector, isCompatible, resolveConnector, validateConnectorSelection } from "./compatibility.js";

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
  assert.deepEqual(new Set(rows.map((row) => row.compatibility_group)), new Set(["SQ-20"]));
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
