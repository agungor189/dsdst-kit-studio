import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import type Database from "better-sqlite3";
import { createApp } from "../app.js";
import { openDatabase } from "../db/index.js";
import { validImage } from "./catalog.js";

const validPngBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

let db: Database.Database; let server: ReturnType<ReturnType<typeof createApp>["listen"]>; let baseUrl = ""; let uploadDir = "";
before(async () => {
  uploadDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "kit-studio-test-"))); process.env.UPLOAD_DIR = uploadDir;
  db = openDatabase(":memory:"); server = createApp(db, { authDisabled: true }).listen(0); await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Server did not start"); baseUrl = `http://127.0.0.1:${address.port}`;
});
after(() => { server.close(); db.close(); fs.rmSync(uploadDir, { recursive: true, force: true }); delete process.env.UPLOAD_DIR; });

test("image decoding rejects MIME spoofing and header-only/truncated files", async () => {
  assert.equal(await validImage(Buffer.from("not-a-real-png"), "image/png"), false);
  assert.equal(await validImage(validPngBytes.subarray(0, 8), "image/png"), false);
  assert.equal(await validImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0]), "image/jpeg"), false);
  assert.equal(await validImage(Buffer.from("RIFFxxxxWEBPgarbage"), "image/webp"), false);
  assert.equal(await validImage(validPngBytes, "image/png"), true);
});

test("complementary product catalog mutations are blocked before upload handling", async () => {
  const form = new FormData();
  form.append("image", new Blob(["not-a-real-png"], { type: "image/png" }), "fake.png");
  const response = await fetch(`${baseUrl}/api/complementary-products/comp-mdf/image`, { method: "POST", body: form });
  assert.equal(response.status, 410);
  assert.deepEqual(await response.json(), { error: "CATALOG_READ_ONLY", message: "Kit Studio catalog is a read-only projection of Panel catalog v1." });
});

test("profile and complementary catalog writes cannot create a second authority", async () => {
  const headers = { "content-type": "application/json" };
  const profileResponse = await fetch(`${baseUrl}/api/profiles`, { method: "POST", headers, body: JSON.stringify({ name: "PCI 25 Profil", shape: "SQUARE", material: "PREMIUM_CAST_IRON", width_mm: 25, height_mm: 25, wall_thickness_mm: 2.5, compatibility_group: "SQ-25X25", raw_length_mm: 6000, weight_per_meter_kg: 1.2, purchase_price_per_meter_cents: 10000, markup_basis_points: 6000 }) });
  assert.equal(profileResponse.status, 410);
  const complementResponse = await fetch(`${baseUrl}/api/complementary-products`, { method: "POST", headers, body: JSON.stringify({ name: "Özel Tabla", unit_type: "M2", purchase_unit_price_cents: 20000, markup_basis_points: 6000, weight_per_unit_grams: 350 }) });
  assert.equal(complementResponse.status, 410);
});

test("legacy local catalog records remain readable historically but are not selectable for new work", async () => {
  db.prepare("INSERT INTO profile_specs (id,shape,material,compatibility_group) VALUES ('legacy-spec','SQUARE','Legacy','LEGACY-1')").run();
  db.prepare("INSERT INTO profiles (id,spec_id,name) VALUES ('legacy-profile','legacy-spec','Legacy profile')").run();
  db.prepare("INSERT INTO complementary_products (id,name,legacy_unit_type,unit_type) VALUES ('legacy-complement','Legacy complement','PIECE','piece')").run();
  const bootstrap = await (await fetch(`${baseUrl}/api/bootstrap`)).json() as any;
  assert.equal(bootstrap.profiles.some((row: any) => row.id === "legacy-profile"), false);
  assert.equal(bootstrap.complementaryProducts.some((row: any) => row.id === "legacy-complement"), false);
  assert.ok(db.prepare("SELECT 1 FROM profiles WHERE id='legacy-profile'").get());
  assert.ok(db.prepare("SELECT 1 FROM complementary_products WHERE id='legacy-complement'").get());
});

test("unknown canonical economics is explicit in the selectable catalog response", async () => {
  db.prepare("UPDATE complementary_products SET cost_status='UNKNOWN',sale_price_status='UNKNOWN' WHERE id='comp-wheel'").run();
  const bootstrap = await (await fetch(`${baseUrl}/api/bootstrap`)).json() as any;
  const wheel = bootstrap.complementaryProducts.find((row: any) => row.id === "comp-wheel");
  assert.equal(wheel.cost_status, "UNKNOWN");
  assert.equal(wheel.sale_price_status, "UNKNOWN");
  assert.equal(wheel.purchase_unit_price_cents, null);
  assert.equal(wheel.sale_unit_price_cents, null);
  const quote = await fetch(`${baseUrl}/api/pricing/quote`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ connectors: [], cuts: [], complementary_items: [{ product_id: "comp-wheel", quantity: 1 }] }),
  });
  assert.equal(quote.status, 409);
  assert.equal((await quote.json() as any).error, "CATALOG_ECONOMICS_UNKNOWN");
  db.prepare("UPDATE complementary_products SET cost_status='KNOWN',sale_price_status='KNOWN' WHERE id='comp-wheel'").run();
});

test("profile images are read-only while kit draft images remain writable", async () => {
  const png = new Blob([validPngBytes], { type: "image/png" });
  const profileForm = new FormData(); profileForm.append("image", png, "profile.png");
  const profileUpload = await fetch(`${baseUrl}/api/profiles/profile-sq20/image`, { method: "POST", body: profileForm });
  assert.equal(profileUpload.status, 410);
  const kit = await (await fetch(`${baseUrl}/api/kits`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Görselli Kit", profile_id: "profile-sq20" }) })).json() as any;
  const kitForm = new FormData(); kitForm.append("images", png, "one.png"); kitForm.append("images", png, "two.png");
  const kitUpload = await fetch(`${baseUrl}/api/kits/${kit.id}/images`, { method: "POST", body: kitForm });
  assert.equal(kitUpload.status, 201); const withImages = await kitUpload.json() as any;
  assert.equal(withImages.images.length, 2); assert.equal(withImages.thumbnail, withImages.images[0].image_path);
  const deleted = await fetch(`${baseUrl}/api/kits/${kit.id}/images/${withImages.images[0].id}`, { method: "DELETE" });
  assert.equal(deleted.status, 200);
});

test("read-only profile upload path does not follow upload-root symlinks", async () => {
  const sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "kit-upload-root-")));
  const outside = path.join(sandbox, "outside");
  const rootLink = path.join(sandbox, "root-link");
  const parentLink = path.join(sandbox, "parent-link");
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, rootLink, "dir");
  fs.symlinkSync(outside, parentLink, "dir");
  const priorRoot = process.env.UPLOAD_DIR;
  try {
    for (const unsafeRoot of [rootLink, path.join(parentLink, "nested-root")]) {
      process.env.UPLOAD_DIR = unsafeRoot;
      const form = new FormData();
      form.append("image", new Blob([validPngBytes], { type: "image/png" }), "safe.png");
      const response = await fetch(`${baseUrl}/api/profiles/profile-sq20/image`, { method: "POST", body: form });
      assert.equal(response.status, 410);
      assert.deepEqual(fs.readdirSync(outside).sort(), []);
    }
  } finally {
    process.env.UPLOAD_DIR = priorRoot;
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
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

test("kit image delete restores the file when the DB mutation fails, then succeeds on retry", async () => {
  const kit = await (await fetch(`${baseUrl}/api/kits`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "DB Failure Guard Kit", profile_id: "profile-sq20" }),
  })).json() as any;
  const directory = path.join(uploadDir, "kits", kit.id);
  const file = path.join(directory, "kept.png");
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(file, validPngBytes);
  db.prepare("INSERT INTO kit_images (id,kit_id,image_path,sort_order) VALUES (?,?,?,0)")
    .run("db-failure-image", kit.id, `/uploads/kits/${kit.id}/kept.png`);
  db.exec("CREATE TRIGGER fail_kit_image_delete BEFORE DELETE ON kit_images WHEN OLD.id='db-failure-image' BEGIN SELECT RAISE(ABORT, 'simulated delete failure'); END;");
  const failed = await fetch(`${baseUrl}/api/kits/${kit.id}/images/db-failure-image`, { method: "DELETE" });
  assert.equal(failed.status, 500);
  assert.equal(fs.readFileSync(file).equals(validPngBytes), true);
  assert.ok(db.prepare("SELECT 1 FROM kit_images WHERE id='db-failure-image'").get());
  db.exec("DROP TRIGGER fail_kit_image_delete");
  const retried = await fetch(`${baseUrl}/api/kits/${kit.id}/images/db-failure-image`, { method: "DELETE" });
  assert.equal(retried.status, 200);
  assert.equal(fs.existsSync(file), false);
  assert.equal(db.prepare("SELECT 1 FROM kit_images WHERE id='db-failure-image'").get(), undefined);
});
