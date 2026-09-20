import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import Database from "better-sqlite3";
import { CURRENT_SCHEMA_VERSION, getMigrationManifest, runMigrations, SUPPORTED_UPGRADE_STARTS } from "./migrate.js";

const migrationDirectory = fileURLToPath(new URL("./migrations/", import.meta.url));
const count = (db: Database.Database, table: string): number => Number(
  (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count,
);

function applyLegacyPrefix(db: Database.Database, throughVersion: number): void {
  for (const entry of getMigrationManifest().filter(({ version }) => version <= throughVersion)) {
    db.exec(fs.readFileSync(path.join(migrationDirectory, entry.name), "utf8"));
    db.prepare("INSERT INTO schema_migrations (version, name) VALUES (?, ?)").run(entry.version, entry.name);
  }
}

test("fresh production database reaches the exact empty v6 schema", () => {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  const manifest = getMigrationManifest();
  assert.equal(manifest.length, 6);
  assert.equal(manifest.at(-1)?.version, CURRENT_SCHEMA_VERSION);
  assert.deepEqual(SUPPORTED_UPGRADE_STARTS, [1, 5]);
  assert.deepEqual(db.prepare("SELECT version, name, checksum FROM schema_migrations ORDER BY version").all(), manifest);
  assert.ok(manifest.every(({ checksum }) => /^[a-f0-9]{64}$/.test(checksum)));

  for (const table of [
    "suppliers", "profile_specs", "profiles", "profile_supplier_offers", "complementary_products",
    "panel_connector_cache", "kits", "kit_variants", "kit_versions", "kit_pricing_snapshots", "kit_images",
  ]) assert.equal(count(db, table), 0, `${table} must contain no production bootstrap business rows`);
  assert.equal(count(db, "connector_roles"), 14);
  assert.equal(count(db, "app_settings"), 6);
  const profileColumns = (db.prepare("PRAGMA table_info(profiles)").all() as Array<{ name: string }>).map(({ name }) => name);
  assert.ok(profileColumns.includes("markup_basis_points"));
  const indexes = (db.prepare("PRAGMA index_list(kits)").all() as Array<{ name: string }>).map(({ name }) => name);
  assert.ok(indexes.includes("idx_kits_active_sku"));

  const before = db.prepare("SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type, name").all();
  runMigrations(db);
  assert.deepEqual(db.prepare("SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type, name").all(), before);
  db.close();
});

for (const start of SUPPORTED_UPGRADE_STARTS) {
  test(`supported v${start} synthetic fixture upgrades deterministically to v${CURRENT_SCHEMA_VERSION}`, () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    applyLegacyPrefix(db, start);
    if (start === 1) {
      db.prepare("INSERT INTO suppliers (id, name) VALUES ('fixture-supplier', 'Synthetic Supplier')").run();
      db.prepare("INSERT INTO profile_specs (id, shape, material, compatibility_group) VALUES ('fixture-spec', 'SQUARE', 'SYNTHETIC', 'SQ-1X1')").run();
      db.prepare("INSERT INTO profiles (id, spec_id, name) VALUES ('fixture-profile', 'fixture-spec', 'Synthetic Profile')").run();
    } else {
      db.prepare("INSERT INTO kits (id, name, sku) VALUES ('fixture-kit', 'Synthetic Kit', 'SYN-KIT')").run();
    }
    runMigrations(db);
    assert.equal((db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as { version: number }).version, CURRENT_SCHEMA_VERSION);
    assert.equal(count(db, "schema_migrations"), 6);
    assert.equal(count(db, start === 1 ? "profiles" : "kits"), 1);
    const first = db.prepare("SELECT version, name, checksum FROM schema_migrations ORDER BY version").all();
    runMigrations(db);
    assert.deepEqual(db.prepare("SELECT version, name, checksum FROM schema_migrations ORDER BY version").all(), first);
    db.close();
  });
}

test("migration metadata mismatch and unknown versions fail closed", () => {
  const db = new Database(":memory:");
  runMigrations(db);
  db.prepare("UPDATE schema_migrations SET checksum = ? WHERE version = 1").run("0".repeat(64));
  assert.throws(() => runMigrations(db), /Migration v1 checksum mismatch/);
  db.prepare("DELETE FROM schema_migrations WHERE version = 1").run();
  db.prepare("INSERT INTO schema_migrations (version, name, checksum) VALUES (99, 'future.sql', ?)").run("0".repeat(64));
  assert.throws(() => runMigrations(db), /unsupported migration version v99/);
  db.close();
});
