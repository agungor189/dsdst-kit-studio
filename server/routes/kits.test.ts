import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type Database from "better-sqlite3";
import { createApp } from "../app.js";
import { openDatabase } from "../db/index.js";

let db: Database.Database; let server: ReturnType<ReturnType<typeof createApp>["listen"]>; let baseUrl = "";
before(async () => {
  db = openDatabase(":memory:"); server = createApp(db, { authDisabled: true }).listen(0); await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Server did not start"); baseUrl = `http://127.0.0.1:${address.port}`;
});
after(() => { server.close(); db.close(); });
const json = (method: string, body: unknown) => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

test("server rejects connector price override but stores incompatibility as a warning", async () => {
  const created = await (await fetch(`${baseUrl}/api/kits`, json("POST", { name: "Test Kit", profile_id: "profile-sq20" }))).json() as any;
  const variantId = created.variants[0].id;
  const override = await fetch(`${baseUrl}/api/variants/${variantId}`, json("PUT", { profile_id: "profile-sq20", connectors: [{ role: "ELB", quantity: 1, sale_price_cents: 1 }], cuts: [], complementary_items: [] }));
  assert.equal(override.status, 400);
  const incompatible = await fetch(`${baseUrl}/api/variants/${variantId}`, json("PUT", { profile_id: "profile-sq20", connectors: [{ role: "ELB", product_id: "panel-s40-elb", quantity: 1 }], cuts: [], complementary_items: [] }));
  assert.equal(incompatible.status, 200);
  assert.match(((await incompatible.json() as any).compatibility_warnings[0]), /SQ-40X40/);
});

test("kit center creates, reloads, edits, copies and soft-deletes a complete kit", async () => {
  const createdResponse = await fetch(`${baseUrl}/api/kits`, json("POST", {
    name: "Konsol Kit", sku: "KIT-KONSOL-01", description: "Acceptance kit", profile_id: "profile-sq20",
    sale_price_cents: 250000, labor_cost_cents: 10000, packaging_cost_cents: 5000, other_cost_cents: 2500,
  }));
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json() as any;
  const variantId = created.variants[0].id;
  const savedResponse = await fetch(`${baseUrl}/api/variants/${variantId}`, json("PUT", {
    profile_id: "profile-sq20",
    connectors: [{ role: "ELB", product_id: "panel-s20-elb", quantity: 4 }, { role: "TEE", product_id: "panel-s20-tee", quantity: 8 }],
    cuts: [{ quantity: 4, length_mm: 1200 }, { quantity: 2, length_mm: 600 }],
    complementary_items: [{ product_id: "comp-wheel", quantity: 4 }],
  }));
  assert.equal(savedResponse.status, 200);

  const reloaded = await (await fetch(`${baseUrl}/api/kits/${created.id}`)).json() as any;
  assert.equal(reloaded.sku, "KIT-KONSOL-01");
  assert.deepEqual(reloaded.variants[0].cuts.map((cut: any) => [cut.quantity, cut.length_mm]), [[4, 1200], [2, 600]]);
  assert.equal(reloaded.summary.extra_cost_cents, 17500);
  assert.equal(reloaded.summary.profit_cents, reloaded.summary.net_revenue_cents - reloaded.summary.total_cost_cents);
  assert.equal(reloaded.summary.output_vat_cents, reloaded.sale_price_cents - reloaded.summary.net_revenue_cents);

  const edited = await fetch(`${baseUrl}/api/variants/${variantId}`, json("PUT", {
    profile_id: "profile-sq20",
    connectors: [{ role: "ELB", product_id: "panel-s20-elb", quantity: 4 }, { role: "TEE", product_id: "panel-s20-tee", quantity: 8 }],
    cuts: [{ quantity: 4, length_mm: 1300 }, { quantity: 3, length_mm: 600 }],
    complementary_items: [{ product_id: "comp-wheel", quantity: 4 }],
  }));
  assert.equal(edited.status, 200);

  const copiedResponse = await fetch(`${baseUrl}/api/kits/${created.id}/copy`, json("POST", { sku: "KIT-KONSOL-02" }));
  assert.equal(copiedResponse.status, 201);
  const copied = await copiedResponse.json() as any;
  assert.notEqual(copied.id, created.id);
  assert.notEqual(copied.variants[0].id, variantId);
  assert.deepEqual(copied.variants[0].cuts.map((cut: any) => [cut.quantity, cut.length_mm]), [[4, 1300], [3, 600]]);
  const originalAgain = await (await fetch(`${baseUrl}/api/kits/${created.id}`)).json() as any;
  assert.equal(originalAgain.name, "Konsol Kit");

  const deleted = await fetch(`${baseUrl}/api/kits/${created.id}`, { method: "DELETE" });
  assert.equal(deleted.status, 200);
  assert.equal((await fetch(`${baseUrl}/api/kits/${created.id}`)).status, 404);
  const listed = await (await fetch(`${baseUrl}/api/kits`)).json() as any[];
  assert.equal(listed.some((kit) => kit.id === created.id), false);
  assert.equal(listed.some((kit) => kit.id === copied.id), true);
});

test("server stores BOM snapshots and recalculates totals", async () => {
  const created = await (await fetch(`${baseUrl}/api/kits`, json("POST", { name: "3 Katlı Raf", profile_id: "profile-sq20" }))).json() as any;
  const variantId = created.variants[0].id;
  const response = await fetch(`${baseUrl}/api/variants/${variantId}`, json("PUT", {
    profile_id: "profile-sq20", connectors: [{ role: "ELB", quantity: 8 }, { role: "TEE", quantity: 4 }],
    cuts: [{ quantity: 4, length_mm: 1800 }, { quantity: 8, length_mm: 1200 }], complementary_items: [{ product_id: "comp-wheel", quantity: 4 }, { product_id: "comp-mdf", quantity: 1.75 }],
  }));
  assert.equal(response.status, 200);
  const detail = await response.json() as any;
  assert.equal(detail.connectors[0].sale_price_snapshot_cents, 12000);
  assert.equal(detail.pricing.profiles.total_millimeters, 16800);
  assert.ok(detail.pricing.gross_profit_cents > 0);
});

test("variant conversion preserves roles, quantities and cuts while resolving new SKUs", async () => {
  const created = await (await fetch(`${baseUrl}/api/kits`, json("POST", { name: "Varyantlı Raf", profile_id: "profile-sq20" }))).json() as any;
  const sourceId = created.variants[0].id;
  await fetch(`${baseUrl}/api/variants/${sourceId}`, json("PUT", { profile_id: "profile-sq20", connectors: [{ role: "ELB", quantity: 8 }, { role: "TEE", quantity: 4 }], cuts: [{ quantity: 8, length_mm: 1200 }, { quantity: 8, length_mm: 600 }], complementary_items: [] }));
  const converted = await (await fetch(`${baseUrl}/api/variants/${sourceId}/clone`, json("POST", { target_profile_id: "profile-sq40" }))).json() as any;
  assert.equal(converted.status, "DRAFT");
  assert.deepEqual(converted.connectors.map((line: any) => [line.connector_role, line.quantity, line.sku_snapshot]), [["ELB", 8, "AL-S40-ELB"], ["TEE", 4, "AL-S40-TEE"]]);
  assert.deepEqual(converted.cuts.map((line: any) => [line.quantity, line.length_mm]), [[8, 1200], [8, 600]]);
});

test("Square to Round conversion marks missing role as INCOMPLETE and blocks approval", async () => {
  const created = await (await fetch(`${baseUrl}/api/kits`, json("POST", { name: "Eksik Varyant", profile_id: "profile-sq20" }))).json() as any;
  const sourceId = created.variants[0].id;
  await fetch(`${baseUrl}/api/variants/${sourceId}`, json("PUT", { profile_id: "profile-sq20", connectors: [{ role: "ELB", quantity: 8 }, { role: "3W", quantity: 2 }], cuts: [{ quantity: 4, length_mm: 1800 }], complementary_items: [] }));
  const converted = await (await fetch(`${baseUrl}/api/variants/${sourceId}/clone`, json("POST", { target_profile_id: "profile-rd337" }))).json() as any;
  assert.equal(converted.status, "INCOMPLETE");
  assert.deepEqual(converted.missing_mappings, ["3W"]);
  const approval = await fetch(`${baseUrl}/api/variants/${converted.id}/approve`, json("POST", {}));
  assert.equal(approval.status, 409);
});

test("kit keeps the original variant and returns both configurations for comparison", async () => {
  const created = await (await fetch(`${baseUrl}/api/kits`, json("POST", { name: "Karşılaştırmalı Kit", profile_id: "profile-sq20", sale_price_cents: 120000 }))).json() as any;
  const sourceId = created.variants[0].id;
  await fetch(`${baseUrl}/api/variants/${sourceId}`, json("PUT", { profile_id: "profile-sq20", connectors: [{ role: "ELB", quantity: 2 }], cuts: [{ quantity: 2, length_mm: 1000 }], complementary_items: [] }));
  const alternative = await (await fetch(`${baseUrl}/api/variants/${sourceId}/clone`, json("POST", { target_profile_id: "profile-sq40" }))).json() as any;
  const compare = await (await fetch(`${baseUrl}/api/kits/${created.id}/compare`)).json() as any;
  assert.deepEqual(compare.variants.map((variant: any) => variant.id), [sourceId, alternative.id]);
  assert.equal(compare.variants[0].configuration.wall_thickness_mm, 1.5);
  assert.equal(compare.variants[1].configuration.wall_thickness_mm, 2);
  assert.equal(compare.variants.every((variant: any) => typeof variant.summary.net_profit_cents === "number"), true);
});
