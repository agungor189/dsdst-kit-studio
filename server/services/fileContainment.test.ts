import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { finalizeOwnedUploadCleanup, removeOwnedUploadReference } from "./fileContainment.js";

test("successful DB delete with final cleanup failure leaves only a recoverable quarantine file", () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "kit-delete-cleanup-")));
  const original = path.join(root, "kits", "kit-1", "image.png");
  fs.mkdirSync(path.dirname(original), { recursive: true });
  fs.writeFileSync(original, "image");
  let dbDeleted = false;
  try {
    const result = removeOwnedUploadReference(root, "/uploads/kits/kit-1/image.png", () => { dbDeleted = true; }, {
      unlink: () => { throw new Error("simulated cleanup failure"); },
    });
    assert.equal(result, "cleanup_pending");
    assert.equal(dbDeleted, true);
    assert.equal(fs.existsSync(original), false);
    const quarantined = fs.readdirSync(path.join(root, ".quarantine"));
    assert.equal(quarantined.length, 1);
    const pending = path.join(root, ".quarantine", quarantined[0]);
    assert.equal(fs.readFileSync(pending, "utf8"), "image");
    assert.equal(finalizeOwnedUploadCleanup(root, pending), "deleted");
    assert.equal(finalizeOwnedUploadCleanup(root, pending), "missing");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("invalid legacy path mutates only the DB reference and is idempotent", () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "kit-delete-legacy-")));
  const outside = path.join(path.dirname(root), `${path.basename(root)}-outside.txt`);
  fs.writeFileSync(outside, "keep");
  let calls = 0;
  try {
    assert.equal(removeOwnedUploadReference(root, "/uploads/../outside.txt", () => { calls += 1; }), "rejected");
    assert.equal(removeOwnedUploadReference(root, "/uploads/../outside.txt", () => { calls += 1; }), "rejected");
    assert.equal(calls, 2);
    assert.equal(fs.readFileSync(outside, "utf8"), "keep");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { force: true });
  }
});
