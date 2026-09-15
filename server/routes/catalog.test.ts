import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type Database from "better-sqlite3";
import { createApp } from "../app.js";
import { openDatabase } from "../db/index.js";
import { validImage } from "./catalog.js";

let db: Database.Database; let server: ReturnType<ReturnType<typeof createApp>["listen"]>; let baseUrl = "";
before(async () => {
  db = openDatabase(":memory:"); server = createApp(db).listen(0); await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Server did not start"); baseUrl = `http://127.0.0.1:${address.port}`;
});
after(() => { server.close(); db.close(); });

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
