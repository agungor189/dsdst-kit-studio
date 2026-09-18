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

test("server rejects connector price overrides and incompatible normal selections", async () => {
  const created = await (await fetch(`${baseUrl}/api/kits`, json("POST", { name: "Test Kit", profile_id: "profile-sq20" }))).json() as any;
  const variantId = created.variants[0].id;
  const override = await fetch(`${baseUrl}/api/variants/${variantId}`, json("PUT", { profile_id: "profile-sq20", connectors: [{ role: "ELB", quantity: 1, sale_price_cents: 1 }], cuts: [], complementary_items: [] }));
  assert.equal(override.status, 400);
  const incompatible = await fetch(`${baseUrl}/api/variants/${variantId}`, json("PUT", { profile_id: "profile-sq20", connectors: [{ role: "ELB", product_id: "panel-s40-elb", quantity: 1 }], cuts: [], complementary_items: [] }));
  assert.equal(incompatible.status, 409);
  assert.equal((await incompatible.json() as any).error, "INCOMPATIBLE_CONNECTOR");
  const duplicateRole = await fetch(`${baseUrl}/api/variants/${variantId}`, json("PUT", { profile_id: "profile-sq20", connectors: [{ role: "ELB", product_id: "panel-s20-elb", quantity: 1 }, { role: "ELB", product_id: "panel-s20-elb", quantity: 2 }], cuts: [], complementary_items: [] }));
  assert.equal(duplicateRole.status, 400);
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
  assert.equal(reloaded.summary.profit_cents, reloaded.variants[0].pricing.subtotal_ex_vat_cents - reloaded.summary.total_cost_cents);
  assert.equal(reloaded.variants[0].pricing.vat_cents, Math.round(reloaded.variants[0].pricing.subtotal_ex_vat_cents * 2000 / 10000));

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

test("live quote uses catalog prices, markup, extras and weight without a kit sale input", async () => {
  const response = await fetch(`${baseUrl}/api/pricing/quote`, json("POST", {
    profile_id: "profile-sq20", connectors: [{ role: "ELB", product_id: "panel-s20-elb", quantity: 2 }],
    cuts: [{ quantity: 1, length_mm: 1000 }], complementary_items: [{ product_id: "comp-wheel", quantity: 2 }],
    labor_cost_cents: 1000, packaging_cost_cents: 500, other_cost_cents: 250,
  }));
  assert.equal(response.status, 200); const quote = await response.json() as any;
  assert.equal(quote.connector_sale_cents, 24000);
  assert.equal(quote.profile_sale_cents, 12000);
  assert.equal(quote.complementary_sale_cents, 27000);
  assert.equal(quote.total_cost_cents, 41150);
  assert.equal(quote.profit_cents, 21850);
  assert.equal(quote.total_inc_vat_cents, 75600);
  assert.equal(quote.total_weight_grams, 2660);
  assert.equal(quote.weight_complete, true);
});

test("connector-only kits can be quoted and saved before a profile is selected", async () => {
  const quoteResponse = await fetch(`${baseUrl}/api/pricing/quote`, json("POST", {
    profile_id: null, connectors: [{ role: "ELB", product_id: "panel-r100-elb", quantity: 4 }, { role: "TEE", product_id: "panel-r100-tee", quantity: 4 }],
    cuts: [], complementary_items: [],
  }));
  assert.equal(quoteResponse.status, 200); const quote = await quoteResponse.json() as any;
  assert.equal(quote.profile_cost_cents, 0);
  assert.equal(quote.connector_cost_cents, 95_200);
  assert.equal(quote.connector_sale_cents, 148_000);
  assert.equal(quote.connector_profit_cents, 52_800);

  const createdResponse = await fetch(`${baseUrl}/api/kits`, json("POST", { name: "Önce Bağlantı Kiti", profile_id: null }));
  assert.equal(createdResponse.status, 201); const created = await createdResponse.json() as any;
  const savedResponse = await fetch(`${baseUrl}/api/variants/${created.variants[0].id}`, json("PUT", {
    profile_id: null, connectors: [{ role: "ELB", product_id: "panel-r100-elb", quantity: 4 }], cuts: [], complementary_items: [],
  }));
  assert.equal(savedResponse.status, 200); const saved = await savedResponse.json() as any;
  assert.equal(saved.profile_id, null);
  assert.equal(saved.profile, undefined);
  assert.equal(saved.pricing.connector_sale_cents, 74_000);

  const mixedSize = await fetch(`${baseUrl}/api/variants/${created.variants[0].id}`, json("PUT", {
    profile_id: null, connectors: [{ role: "ELB", product_id: "panel-r100-elb", quantity: 1 }, { role: "TEE", product_id: "panel-s20-tee", quantity: 1 }], cuts: [], complementary_items: [],
  }));
  assert.equal(mixedSize.status, 409);
  assert.equal((await mixedSize.json() as any).error, "INCOMPATIBLE_CONNECTOR");
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
  assert.equal(compare.variants.every((variant: any) => typeof variant.summary.profit_cents === "number"), true);
});

test("conversion preview is read-only and a full alternative saves as an independently related kit", async () => {
  const created = await (await fetch(`${baseUrl}/api/kits`, json("POST", { name: "Kaynak Masa", sku: "SRC-MASA", profile_id: "profile-sq20" }))).json() as any;
  const sourceId = created.variants[0].id;
  await fetch(`${baseUrl}/api/variants/${sourceId}`, json("PUT", { profile_id: "profile-sq20", connectors: [{ role: "ELB", quantity: 4 }, { role: "TEE", quantity: 2 }], cuts: [{ quantity: 4, length_mm: 1000 }, { quantity: 4, length_mm: 500 }], complementary_items: [] }));
  const before = (await (await fetch(`${baseUrl}/api/kits`)).json() as any[]).length;
  const options = await (await fetch(`${baseUrl}/api/variants/${sourceId}/conversion-options?mode=connector`)).json() as any;
  const square40 = options.options.find((option: any) => option.target.profile.id === "profile-sq40");
  assert.equal(square40.status, "FULL");
  assert.deepEqual(square40.target.connectors.map((line: any) => line.role), ["ELB", "TEE"]);
  assert.equal((await (await fetch(`${baseUrl}/api/kits`)).json() as any[]).length, before);
  const derivedResponse = await fetch(`${baseUrl}/api/variants/${sourceId}/derive`, json("POST", { target_profile_id: "profile-sq40", name: "Kaynak Masa – S40", sku: "DERIVED-S40" }));
  assert.equal(derivedResponse.status, 201); const derived = await derivedResponse.json() as any;
  assert.equal(derived.derived_from_kit_id, created.id);
  assert.notEqual(derived.id, created.id); assert.equal(derived.variants[0].profile_id, "profile-sq40");
  assert.deepEqual(derived.variants[0].cuts.map((cut: any) => [cut.quantity, cut.length_mm]), [[4, 1000], [4, 500]]);
  const original = await (await fetch(`${baseUrl}/api/kits/${created.id}`)).json() as any;
  assert.equal(original.variants.length, 1); assert.equal(original.variants[0].profile_id, "profile-sq20");
});

test("partial conversion reports the missing model and profile variants recalculate weight and profit", async () => {
  db.prepare("INSERT INTO profile_specs (id,shape,material,width_mm,height_mm,wall_thickness_mm,compatibility_group,size_compatibility_group) VALUES ('spec-sq20-heavy','SQUARE','Aluminum',20,20,2.5,'SQ-20X20|heavy','SQ-20X20')").run();
  db.prepare("INSERT INTO profiles (id,spec_id,name,raw_length_mm,weight_per_meter_kg,purchase_price_per_meter_cents,sale_price_per_meter_cents,markup_basis_points) VALUES ('profile-sq20-heavy','spec-sq20-heavy','Square 20×20 Aluminum 2.5 mm',6000,0.65,14000,20000,4286)").run();
  const created = await (await fetch(`${baseUrl}/api/kits`, json("POST", { name: "Kârlı Kit", profile_id: "profile-sq20", sale_price_cents: 210000 }))).json() as any;
  const sourceId = created.variants[0].id;
  await fetch(`${baseUrl}/api/variants/${sourceId}`, json("PUT", { profile_id: "profile-sq20", connectors: [{ role: "ELB", quantity: 4 }, { role: "3W", quantity: 2 }], cuts: [{ quantity: 6, length_mm: 1000 }], complementary_items: [] }));
  const connectorOptions = await (await fetch(`${baseUrl}/api/variants/${sourceId}/conversion-options?mode=connector`)).json() as any;
  const round = connectorOptions.options.find((option: any) => option.target.profile.id === "profile-rd337");
  assert.equal(round.status, "PARTIAL"); assert.deepEqual(round.missing_roles, ["3W"]);
  const blocked = await fetch(`${baseUrl}/api/variants/${sourceId}/derive`, json("POST", { target_profile_id: "profile-rd337", name: "Eksik Kit" }));
  assert.equal(blocked.status, 409);
  const profileOptions = await (await fetch(`${baseUrl}/api/variants/${sourceId}/conversion-options?mode=profile`)).json() as any;
  const heavy = profileOptions.options.find((option: any) => option.target.profile.id === "profile-sq20-heavy");
  assert.equal(heavy.status, "FULL");
  assert.ok(heavy.target.summary.total_weight_grams > heavy.source.pricing.profiles.weight_grams);
  assert.ok(heavy.target.summary.total_cost_cents > heavy.source.summary.total_cost_cents);
  assert.equal(heavy.target.summary.profit_cents, heavy.target.pricing.subtotal_ex_vat_cents - heavy.target.summary.total_cost_cents);
});
