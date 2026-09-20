import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type Database from "better-sqlite3";
import { openDatabase } from "../db/index.js";
import { getPanelSyncStats, syncPanelConnectors } from "./panelClient.js";
import { quoteCatalogSelection } from "./variantService.js";

let db: Database.Database;
const previous = { url: process.env.PANEL_API_URL, key: process.env.PANEL_API_KEY };
before(() => { process.env.PANEL_API_URL = "https://panel.test"; process.env.PANEL_API_KEY = "secret"; db = openDatabase(":memory:"); });
after(() => { db.close(); process.env.PANEL_API_URL = previous.url; process.env.PANEL_API_KEY = previous.key; });

test("sync persists resolved and unresolved Panel products with status counts", async () => {
  let version = 1;
  const fakeFetch = async (input: string | URL | Request) => {
    assert.match(String(input), /\/api\/catalog\/v1\/products$/);
    const common = { catalog_version: version, uom_registry_version: "uom-registry:v1", dimensions: { length_mm: null, width_mm: null, height_mm: null, diameter_mm: null }, mass_grams: null };
    const data = [
      { ...common, id: "real-1", sku: "AL-X-ELB", title: version === 1 ? "Dirsek" : "Dirsek V2", name_tr: version === 1 ? "Dirsek" : "Dirsek V2", catalog_type: "connector", catalog_version_ref: `catalog-product:real-1:v${version}`, base_uom: { code: "piece", base_quantum: "piece", quantity_scale: 1 }, form_code: "ELB", tube_type_code: "SQ", normalized_pipe_size: "40x40", mass_grams: 325 },
      { ...common, id: "real-2", sku: "UNKNOWN", title: "Bekleyen", name_tr: "Bekleyen", catalog_type: "product", catalog_version_ref: "catalog-product:real-2:v1", base_uom: { code: "piece", base_quantum: "piece", quantity_scale: 1 } },
      { ...common, id: "panel-profile-1", sku: "PROFILE-30", title: "Panel 30x30", catalog_type: "profile", catalog_version_ref: `catalog-product:panel-profile-1:v${version}`, base_uom: { code: "meter", base_quantum: "millimeter", quantity_scale: 1000 }, profile: { material: "ALUMINUM", form: "square", width_mm: "30", height_mm: "30", diameter_mm: null, wall_thickness_mm: "1.5", width_micrometers: 30000, height_micrometers: 30000, diameter_micrometers: null, wall_thickness_micrometers: 1500, standard_purchase_lengths_mm: [1000, 2000, 3000, 6000], custom_length_allowed: true } },
      { ...common, id: "panel-comp-1", sku: "FABRIC", title: "Panel Kumaş", catalog_type: "complementary", catalog_version_ref: `catalog-product:panel-comp-1:v${version}`, base_uom: { code: "square_meter", base_quantum: "square_millimeter", quantity_scale: 1000000 }, mass_grams: 12 },
      ...(["piece", "meter", "kg", "roll", "package", "box"] as const).map((code) => ({ ...common, id: `panel-comp-${code}`, sku: `COMP-${code}`, title: code, catalog_type: "complementary", catalog_version_ref: `catalog-product:panel-comp-${code}:v${version}`, base_uom: { code, base_quantum: code === "meter" ? "millimeter" : code === "kg" ? "gram" : code, quantity_scale: code === "meter" || code === "kg" ? 1000 : 1 } })),
    ];
    return new Response(JSON.stringify({ success: true, contract: "dsdst.catalog-product.v1", data }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const result = await syncPanelConnectors(db, fakeFetch as typeof fetch);
  assert.deepEqual({ synced: result.synced, compatible: result.compatible, unresolved: result.unresolved }, { synced: 1, compatible: 1, unresolved: 0 });
  const stats = getPanelSyncStats(db);
  assert.equal(stats.panelReachable, true); assert.equal(stats.connectorCount, 1); assert.equal(stats.unresolvedCount, 0);
  assert.equal(stats.profileCount, 1); assert.equal(stats.complementCount, 7);
  assert.equal((db.prepare("SELECT size_compatibility_group FROM profile_specs JOIN profiles ON profiles.spec_id=profile_specs.id WHERE profiles.id='panel-profile-1'").get() as any).size_compatibility_group, "SQ-30X30");
  assert.equal((db.prepare("SELECT base_uom_code FROM complementary_products WHERE id='panel-comp-1'").get() as any).base_uom_code, "square_meter");
  assert.deepEqual((db.prepare("SELECT base_uom_code FROM complementary_products WHERE id LIKE 'panel-comp-%' ORDER BY base_uom_code").all() as Array<{ base_uom_code: string }>).map((row) => row.base_uom_code), ["box", "kg", "meter", "package", "piece", "roll", "square_meter"]);
  assert.equal((db.prepare("SELECT wall_thickness_micrometers FROM profile_specs JOIN profiles ON profiles.spec_id=profile_specs.id WHERE profiles.id='panel-profile-1'").get() as any).wall_thickness_micrometers, 1500);
  assert.equal((db.prepare("SELECT compatibility_group FROM connector_compatibility WHERE product_id='real-1'").get() as any).compatibility_group, "SQ-40X40");
  assert.equal((db.prepare("SELECT catalog_version_ref FROM panel_connector_cache WHERE product_id='real-1'").get() as any).catalog_version_ref, "catalog-product:real-1:v1");
  assert.equal((db.prepare("SELECT unit_weight_grams FROM panel_connector_cache WHERE product_id='real-1'").get() as any).unit_weight_grams, 325);
  assert.deepEqual(JSON.parse((db.prepare("SELECT standard_purchase_lengths_mm_json FROM profiles WHERE id='panel-profile-1'").get() as any).standard_purchase_lengths_mm_json), [1000, 2000, 3000, 6000]);
  assert.deepEqual(db.prepare("SELECT cost_status,sale_price_status FROM complementary_products WHERE id='panel-comp-1'").get(), { cost_status: "UNKNOWN", sale_price_status: "UNKNOWN" });
  assert.throws(() => quoteCatalogSelection(db, { connectors: [], cuts: [], complementary_items: [{ product_id: "panel-comp-1", quantity: 1 }], labor_cost_cents: 0 }), /CATALOG_ECONOMICS_UNKNOWN/);

  version = 2;
  await syncPanelConnectors(db, fakeFetch as typeof fetch);
  assert.deepEqual(db.prepare("SELECT name_tr,catalog_version_ref,cost_status FROM panel_connector_cache WHERE product_id='real-1'").get(), {
    name_tr: "Dirsek V2", catalog_version_ref: "catalog-product:real-1:v2", cost_status: "UNKNOWN",
  });
});

test("a failed refresh keeps the last cache and marks Panel unreachable", async () => {
  await assert.rejects(() => syncPanelConnectors(db, (async () => { throw new Error("offline"); }) as typeof fetch));
  const stats = getPanelSyncStats(db);
  assert.equal(stats.panelReachable, false); assert.equal(stats.connectorCount, 1); assert.match(stats.lastError || "", /offline/);
});
