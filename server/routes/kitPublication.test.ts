import assert from "node:assert/strict";
import test from "node:test";
import type Database from "better-sqlite3";
import { createApp } from "../app.js";
import { openDatabase } from "../db/index.js";

const json = (method: string, body: unknown, operationId?: string) => ({
  method,
  headers: { "content-type": "application/json", ...(operationId ? { "x-operation-id": operationId } : {}) },
  body: JSON.stringify(body),
});

async function withServer(
  user: any,
  run: (baseUrl: string, db: Database.Database, calls: { preview: number; publish: number }) => Promise<void>,
) {
  const db = openDatabase(":memory:");
  const calls = { preview: 0, publish: 0 };
  const publication = {
    preview: async (proposal: any, token: string) => {
      calls.preview += 1;
      assert.equal(token, "test-panel-jwt");
      return { authoredContentHash: proposal.authoredContentHash, contentHash: "a".repeat(64), corePolicyHash: "b".repeat(64), cost: { canonicalCostMinor: 1000, suggestedSalePriceMinor: 1000 }, cutPlan: { effectiveKerfMm: 3 } };
    },
    publish: async (input: any, token: string, operationId: string) => {
      calls.publish += 1;
      assert.equal(token, "test-panel-jwt");
      assert.equal(input.approvedContentHash, "a".repeat(64));
      return { publishedKitId: "panel-kit-1", productId: "panel-product-1", versionId: `panel-version-${calls.publish}`, versionNumber: calls.publish, contentHash: "a".repeat(64), corePolicyHash: "b".repeat(64), operationId };
    },
  };
  const server = createApp(db, { authDisabled: true, testUser: user, publication }).listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server did not start");
  try { await run(`http://127.0.0.1:${address.port}`, db, calls); }
  finally { server.close(); db.close(); }
}

async function createPublishable(baseUrl: string) {
  const kit = await (await fetch(`${baseUrl}/api/kits`, json("POST", { name: "Publication Kit", sku: "PUB-001", profile_id: "profile-sq20" }))).json() as any;
  const variantId = kit.variants[0].id;
  const saved = await fetch(`${baseUrl}/api/variants/${variantId}`, json("PUT", {
    profile_id: "profile-sq20",
    connectors: [{ role: "ELB", product_id: "panel-s20-elb", quantity: 2 }],
    cuts: [{ quantity: 1, length_mm: 1800 }],
    complementary_items: [],
  }));
  assert.equal(saved.status, 200);
  const draft = await fetch(`${baseUrl}/api/variants/${variantId}/publication-draft`, json("PUT", {
    final_sale_price_minor: 5000,
    packaging_instruction_version: "packing:v1",
    installation_guide_version: "guide:v1",
    packages: [{ package_number: 1, items: [
      { product_id: "panel-s20-elb", quantity_base_int: 2 },
      { product_id: "profile-sq20", quantity_base_int: 1803 },
    ] }],
  }));
  assert.equal(draft.status, 200);
  return { kit, variantId };
}

test("real Kit route path previews, publishes once, replays locally and freezes the published version", async () => {
  await withServer({ id: "approver", username: "approver", role: "admin", permissions: {}, must_change_password: false }, async (baseUrl, db, calls) => {
    const { variantId } = await createPublishable(baseUrl);
    const previewResponse = await fetch(`${baseUrl}/api/variants/${variantId}/publication-preview`, { method: "POST" });
    assert.equal(previewResponse.status, 200);
    const preview = await previewResponse.json() as any;
    assert.equal(preview.proposal.profileCutPlan.cuts[0].lengthMm, 1800);
    const publishBody = { approved_content_hash: preview.preview.contentHash, approved_policy_hash: preview.preview.corePolicyHash };
    const published = await fetch(`${baseUrl}/api/variants/${variantId}/publish`, json("POST", publishBody, "publish-operation-1"));
    assert.equal(published.status, 201);
    const replay = await fetch(`${baseUrl}/api/variants/${variantId}/publish`, json("POST", publishBody, "publish-operation-1"));
    assert.equal(replay.status, 200);
    assert.equal((await replay.json() as any).idempotent, true);
    assert.equal(calls.preview, 1);
    assert.equal(calls.publish, 1);
    const version = db.prepare("SELECT * FROM kit_versions WHERE published_operation_id='publish-operation-1'").get() as any;
    assert.equal(version.published_version_id, "panel-version-1");
    assert.throws(() => db.prepare("UPDATE kit_versions SET bom_json='{}' WHERE id=?").run(version.id), /immutable/i);
    const newVersion = await fetch(`${baseUrl}/api/variants/${variantId}/new-version`, { method: "POST" });
    assert.equal(newVersion.status, 201);
    assert.equal((await newVersion.json() as any).status, "DRAFT");
  });
});

test("incomplete publication and missing kits:approve capability fail closed", async () => {
  await withServer({ id: "writer", username: "writer", role: "user", permissions: { "kits:view": true, "kits:write": true }, must_change_password: false }, async (baseUrl) => {
    const kit = await (await fetch(`${baseUrl}/api/kits`, json("POST", { name: "Incomplete", profile_id: null }))).json() as any;
    const denied = await fetch(`${baseUrl}/api/variants/${kit.variants[0].id}/publication-preview`, { method: "POST" });
    assert.equal(denied.status, 403);
    assert.equal((await denied.json() as any).required, "kits:approve");
  });
});
