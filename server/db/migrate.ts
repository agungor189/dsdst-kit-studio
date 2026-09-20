import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import type Database from "better-sqlite3";

const migrationDir = fileURLToPath(new URL("./migrations/", import.meta.url));

export const CURRENT_SCHEMA_VERSION = 6;
export const SUPPORTED_UPGRADE_STARTS = [1, 5] as const;

export type MigrationManifestEntry = {
  version: number;
  name: string;
  checksum: string;
};

export function getMigrationManifest(): MigrationManifestEntry[] {
  const files = fs.readdirSync(migrationDir).filter((file) => /^\d+_.+\.sql$/.test(file));
  const manifest = files.map((file) => ({
    version: Number(file.split("_")[0]),
    name: file,
    checksum: createHash("sha256").update(fs.readFileSync(path.join(migrationDir, file))).digest("hex"),
  })).sort((a, b) => a.version - b.version);
  const versions = new Set<number>();
  for (const [index, entry] of manifest.entries()) {
    if (versions.has(entry.version)) throw new Error(`Duplicate migration version: ${entry.version}`);
    if (entry.version !== index + 1) throw new Error(`Migration sequence gap before v${entry.version}`);
    versions.add(entry.version);
  }
  if (manifest.at(-1)?.version !== CURRENT_SCHEMA_VERSION) {
    throw new Error(`Migration manifest ends at v${manifest.at(-1)?.version ?? "none"}, expected v${CURRENT_SCHEMA_VERSION}`);
  }
  return manifest;
}

export function runMigrations(db: Database.Database) {
  const manifest = getMigrationManifest();
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)");
  const columns = new Set((db.prepare("PRAGMA table_info(schema_migrations)").all() as { name: string }[]).map(({ name }) => name));
  if (!columns.has("checksum")) db.exec("ALTER TABLE schema_migrations ADD COLUMN checksum TEXT");
  const expected = new Map(manifest.map((entry) => [entry.version, entry]));
  const applied = new Set<number>();
  const checksumBackfill = db.prepare("UPDATE schema_migrations SET checksum = ? WHERE version = ? AND checksum IS NULL");
  for (const row of db.prepare("SELECT version, name, checksum FROM schema_migrations ORDER BY version").all() as Array<{ version: number; name: string; checksum: string | null }>) {
    const entry = expected.get(row.version);
    if (!entry) throw new Error(`Database contains unsupported migration version v${row.version}`);
    if (row.name !== entry.name) throw new Error(`Migration v${row.version} name mismatch: database=${row.name}, source=${entry.name}`);
    if (row.checksum && row.checksum !== entry.checksum) throw new Error(`Migration v${row.version} checksum mismatch`);
    if (!row.checksum) checksumBackfill.run(entry.checksum, row.version);
    applied.add(row.version);
  }
  for (const entry of manifest) {
    if (applied.has(entry.version)) continue;
    const sql = fs.readFileSync(path.join(migrationDir, entry.name), "utf8");
    db.transaction(() => {
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations (version, name, checksum) VALUES (?, ?, ?)").run(entry.version, entry.name, entry.checksum);
    })();
  }
}
