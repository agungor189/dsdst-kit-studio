import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type Database from "better-sqlite3";
import { openDatabase } from "../db/index.js";
import { getPanelSyncStats, syncPanelConnectors } from "./panelClient.js";

let db: Database.Database;
const previous = { url: process.env.PANEL_API_URL, key: process.env.PANEL_API_KEY };
before(() => { process.env.PANEL_API_URL = "https://panel.test"; process.env.PANEL_API_KEY = "secret"; db = openDatabase(":memory:"); });
after(() => { db.close(); process.env.PANEL_API_URL = previous.url; process.env.PANEL_API_KEY = previous.key; });

test("sync persists resolved and unresolved Panel products with status counts", async () => {
  const fakeFetch = async () => new Response(JSON.stringify({ success: true, data: [
    { id: "real-1", sku: "AL-X-ELB", name_tr: "Dirsek", form_code: "ELB", tube_type_code: "SQ", normalized_pipe_size: "40x40", sale_price: 10 },
    { id: "real-2", sku: "UNKNOWN", name_tr: "Bekleyen", sale_price: 5 },
  ] }), { status: 200, headers: { "content-type": "application/json" } });
  const result = await syncPanelConnectors(db, fakeFetch as typeof fetch);
  assert.deepEqual({ synced: result.synced, compatible: result.compatible, unresolved: result.unresolved }, { synced: 2, compatible: 1, unresolved: 1 });
  const stats = getPanelSyncStats(db);
  assert.equal(stats.panelReachable, true); assert.equal(stats.connectorCount, 2); assert.equal(stats.unresolvedCount, 1);
  assert.equal((db.prepare("SELECT compatibility_group FROM connector_compatibility WHERE product_id='real-1'").get() as any).compatibility_group, "SQ-40X40");
});

test("a failed refresh keeps the last cache and marks Panel unreachable", async () => {
  await assert.rejects(() => syncPanelConnectors(db, (async () => { throw new Error("offline"); }) as typeof fetch));
  const stats = getPanelSyncStats(db);
  assert.equal(stats.panelReachable, false); assert.equal(stats.connectorCount, 2); assert.match(stats.lastError || "", /offline/);
});
