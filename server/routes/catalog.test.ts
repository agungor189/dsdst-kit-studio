import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import type Database from "better-sqlite3";
import { createApp } from "../app.js";
import { openDatabase } from "../db/index.js";
import { validImage } from "./catalog.js";

let db: Database.Database; let server: ReturnType<ReturnType<typeof createApp>["listen"]>; let baseUrl = ""; let uploadDir = "";
before(async () => {
  uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), "kit-studio-test-")); process.env.UPLOAD_DIR = uploadDir;
  db = openDatabase(":memory:"); server = createApp(db, { authDisabled: true }).listen(0); await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Server did not start"); baseUrl = `http://127.0.0.1:${address.port}`;
});
after(() => { server.close(); db.close(); fs.rmSync(uploadDir, { recursive: true, force: true }); delete process.env.UPLOAD_DIR; });

test("image signature validation rejects MIME-spoofed files", () => {
  assert.equal(validImage(Buffer.from("not-a-real-png"), "image/png"), false);
});

test("complementary product upload rejects invalid image contents", async () => {
  const form = new FormData();
  form.append("image", new Blob(["not-a-real-png"], { type: "image/png" }), "fake.png");
  const response = await fetch(`${baseUrl}/api/complementary-products/comp-mdf/image`, { method: "POST", body: form });
  assert.equal(response.status, 415);
  assert.deepEqual(await response.json(), { error: "INVALID_IMAGE" });
});

test("catalog derives profile and complementary sale prices from purchase and markup", async () => {
  const headers = { "content-type": "application/json" };
  const profileResponse = await fetch(`${baseUrl}/api/profiles`, { method: "POST", headers, body: JSON.stringify({ name: "PCI 25 Profil", shape: "SQUARE", material: "PREMIUM_CAST_IRON", width_mm: 25, height_mm: 25, wall_thickness_mm: 2.5, compatibility_group: "SQ-25X25", raw_length_mm: 6000, weight_per_meter_kg: 1.2, purchase_price_per_meter_cents: 10000, markup_basis_points: 6000 }) });
  assert.equal(profileResponse.status, 201); const profile = await profileResponse.json() as any;
  const editedProfile = await fetch(`${baseUrl}/api/profiles/${profile.id}`, { method: "PUT", headers, body: JSON.stringify({ name: "PCI 25 Profil", shape: "SQUARE", material: "PREMIUM_CAST_IRON", width_mm: 25, height_mm: 25, wall_thickness_mm: 3, compatibility_group: "SQ-25X25", raw_length_mm: 6000, weight_per_meter_kg: 1.3, purchase_price_per_meter_cents: 11000, markup_basis_points: 5000 }) });
  assert.equal(editedProfile.status, 200); assert.equal((await editedProfile.json() as any).wall_thickness_mm, 3);
  const complementResponse = await fetch(`${baseUrl}/api/complementary-products`, { method: "POST", headers, body: JSON.stringify({ name: "Özel Tabla", unit_type: "M2", purchase_unit_price_cents: 20000, markup_basis_points: 6000, weight_per_unit_grams: 350 }) });
  assert.equal(complementResponse.status, 201); const complement = await complementResponse.json() as any;
  const editedComplement = await fetch(`${baseUrl}/api/complementary-products/${complement.id}`, { method: "PUT", headers, body: JSON.stringify({ name: "Özel Tabla", unit_type: "M2", purchase_unit_price_cents: 21000, markup_basis_points: 5000, weight_per_unit_grams: 375 }) });
  assert.equal(editedComplement.status, 200); const edited = await editedComplement.json() as any; assert.equal(edited.sale_unit_price_cents, 31500); assert.equal(edited.weight_per_unit_grams, 375);
});

test("profile and kit accept multiple validated images", async () => {
  const png = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], { type: "image/png" });
  const profileForm = new FormData(); profileForm.append("image", png, "profile.png");
  const profileUpload = await fetch(`${baseUrl}/api/profiles/profile-sq20/image`, { method: "POST", body: profileForm });
  assert.equal(profileUpload.status, 200);
  const kit = await (await fetch(`${baseUrl}/api/kits`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Görselli Kit", profile_id: "profile-sq20" }) })).json() as any;
  const kitForm = new FormData(); kitForm.append("images", png, "one.png"); kitForm.append("images", png, "two.png");
  const kitUpload = await fetch(`${baseUrl}/api/kits/${kit.id}/images`, { method: "POST", body: kitForm });
  assert.equal(kitUpload.status, 201); const withImages = await kitUpload.json() as any;
  assert.equal(withImages.images.length, 2); assert.equal(withImages.thumbnail, withImages.images[0].image_path);
  const deleted = await fetch(`${baseUrl}/api/kits/${kit.id}/images/${withImages.images[0].id}`, { method: "DELETE" });
  assert.equal(deleted.status, 200);
});

test("kit image deletion cannot follow an uploads symlink to an outside file", async () => {
  const kit = await (await fetch(`${baseUrl}/api/kits`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Symlink Guard Kit", profile_id: "profile-sq20" }),
  })).json() as any;
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "kit-studio-outside-"));
  const outsideFile = path.join(outsideDir, "secret.png");
  fs.writeFileSync(outsideFile, "do-not-delete");
  fs.symlinkSync(outsideDir, path.join(uploadDir, "escape"), "dir");
  db.prepare("INSERT INTO kit_images (id,kit_id,image_path,sort_order) VALUES (?,?,?,0)")
    .run("unsafe-image", kit.id, "/uploads/escape/secret.png");
  try {
    const response = await fetch(`${baseUrl}/api/kits/${kit.id}/images/unsafe-image`, { method: "DELETE" });
    assert.equal(response.status, 200);
    assert.equal(fs.readFileSync(outsideFile, "utf8"), "do-not-delete");
    assert.equal(db.prepare("SELECT 1 FROM kit_images WHERE id='unsafe-image'").get(), undefined);
  } finally {
    fs.rmSync(outsideDir, { recursive: true, force: true });
  }
});
