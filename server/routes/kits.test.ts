import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type Database from "better-sqlite3";
import { createApp } from "../app.js";
import { openDatabase } from "../db/index.js";

let db: Database.Database; let server: ReturnType<ReturnType<typeof createApp>["listen"]>; let baseUrl = "";
before(async () => {
  db = openDatabase(":memory:"); server = createApp(db).listen(0); await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Server did not start"); baseUrl = `http://127.0.0.1:${address.port}`;
});
after(() => { server.close(); db.close(); });
const json = (method: string, body: unknown) => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

test("server rejects connector price override and incompatible connector", async () => {
  const created = await (await fetch(`${baseUrl}/api/kits`, json("POST", { name: "Test Kit", profile_id: "profile-sq20" }))).json() as any;
  const variantId = created.variants[0].id;
  const override = await fetch(`${baseUrl}/api/variants/${variantId}`, json("PUT", { profile_id: "profile-sq20", connectors: [{ role: "ELB", quantity: 1, sale_price_cents: 1 }], cuts: [], complementary_items: [] }));
  assert.equal(override.status, 400);
  const incompatible = await fetch(`${baseUrl}/api/variants/${variantId}`, json("PUT", { profile_id: "profile-sq20", connectors: [{ role: "ELB", product_id: "panel-s40-elb", quantity: 1 }], cuts: [], complementary_items: [] }));
  assert.equal(incompatible.status, 400);
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
