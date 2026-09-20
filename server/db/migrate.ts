import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

export function resolveMigrationDirectory(candidates = [
  fileURLToPath(new URL("./migrations/", import.meta.url)),
  path.resolve(process.cwd(), "server/db/migrations"),
]): string {
  const resolved = candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isDirectory());
  if (!resolved) throw new Error(`Migration directory is missing; checked: ${candidates.join(", ")}`);
  return resolved;
}

const migrationDir = resolveMigrationDirectory();

export const CURRENT_SCHEMA_VERSION = 8;
export const SUPPORTED_UPGRADE_STARTS = [1, 5] as const;

export type MigrationManifestEntry = {
  version: number;
  name: string;
  checksum: string;
};

const FROZEN_MIGRATIONS: readonly MigrationManifestEntry[] = [
  { version: 1, name: "001_initial.sql", checksum: "1a2ba1c15983a71fc526b38c7a3dcc4d94d06ba6d01abc76c04f3ade35fa18dd" },
  { version: 2, name: "002_panel_sync_metadata.sql", checksum: "cbcce980422eb79c1d6ca5c497cee500831325ee775b52f985025d3fcc20b050" },
  { version: 3, name: "003_kit_studio_center.sql", checksum: "46e9926a15378e2da0050d32af198c92a5a8f1c93c9ab7d4ab77e4f7ffb1c4a9" },
  { version: 4, name: "004_kit_images.sql", checksum: "81ef63b6d8b51f7ae1bfbeaa6a0dbb4c581fb1e232367511bcbe3653f1dc0b2c" },
  { version: 5, name: "005_derived_kits.sql", checksum: "b8ca945b680712f9c8a52000c85c9fb381b4ffcc4ce319f0c7e24d6a86caaa91" },
  { version: 6, name: "006_automatic_pricing_and_weights.sql", checksum: "a077e5f85e1f050d2d210a30033f758d058a3627736afa3258e7f92fa1de6ba7" },
  { version: 7, name: "007_catalog_uom_contract.sql", checksum: "a8c6bbdbb5aac2e20ead6450fd57b6b52f91472c35115ac8bbf9747a5fa7b611" },
];

export function getMigrationManifest(): MigrationManifestEntry[] {
  const files = fs.readdirSync(migrationDir).filter((file) => /^\d+_.+\.sql$/.test(file));
  const manifest = files.map((file) => ({
    version: Number(file.split("_")[0]),
    name: file,
    checksum: createHash("sha256").update(fs.readFileSync(path.join(migrationDir, file))).digest("hex"),
  })).sort((a, b) => a.version - b.version);
  validateMigrationManifest(manifest);
  return manifest;
}

export function validateMigrationManifest(manifest: MigrationManifestEntry[]): void {
  const versions = new Set<number>();
  for (const [index, entry] of manifest.entries()) {
    if (versions.has(entry.version)) throw new Error(`Duplicate migration version: ${entry.version}`);
    if (entry.version !== index + 1) throw new Error(`Migration sequence gap before v${entry.version}`);
    versions.add(entry.version);
  }
  if (manifest.at(-1)?.version !== CURRENT_SCHEMA_VERSION) {
    throw new Error(`Migration manifest ends at v${manifest.at(-1)?.version ?? "none"}, expected v${CURRENT_SCHEMA_VERSION}`);
  }
  for (const [index, frozen] of FROZEN_MIGRATIONS.entries()) {
    const actual = manifest[index];
    if (!actual || actual.version !== frozen.version || actual.name !== frozen.name || actual.checksum !== frozen.checksum) {
      throw new Error(`Frozen migration mismatch at v${frozen.version}`);
    }
  }
}

const quoteIdentifier = (value: string): string => `"${value.replaceAll('"', '""')}"`;

function assertSchemaEffects(actual: Database.Database, maxVersion: number): void {
  const reference = new Database(":memory:");
  try {
    for (const entry of FROZEN_MIGRATIONS.filter(({ version }) => version <= maxVersion)) {
      reference.exec(fs.readFileSync(path.join(migrationDir, entry.name), "utf8"));
    }
    const expectedObjects = reference.prepare(`
      SELECT type, name FROM sqlite_master
      WHERE name NOT LIKE 'sqlite_%' AND name <> 'schema_migrations' AND sql IS NOT NULL
      ORDER BY type, name
    `).all() as Array<{ type: string; name: string }>;
    for (const object of expectedObjects) {
      if (!actual.prepare("SELECT 1 FROM sqlite_master WHERE type = ? AND name = ? AND sql IS NOT NULL").get(object.type, object.name)) {
        throw new Error(`Migration schema effect is missing: ${object.type} ${object.name}`);
      }
      if (object.type === "table") {
        const expectedColumns = reference.prepare(`PRAGMA table_info(${quoteIdentifier(object.name)})`).all() as Array<{ name: string; type: string; notnull: number; dflt_value: unknown; pk: number }>;
        const actualColumns = actual.prepare(`PRAGMA table_info(${quoteIdentifier(object.name)})`).all() as typeof expectedColumns;
        for (const expected of expectedColumns) {
          const found = actualColumns.find(({ name }) => name === expected.name);
          if (!found || found.type !== expected.type || found.notnull !== expected.notnull
            || found.dflt_value !== expected.dflt_value || found.pk !== expected.pk) {
            throw new Error(`Migration schema effect is missing or incompatible: ${object.name}.${expected.name}`);
          }
        }
      }
      if (object.type === "index") {
        const expectedColumns = (reference.prepare(`PRAGMA index_info(${quoteIdentifier(object.name)})`).all() as Array<{ seqno: number; name: string }>).map(({ seqno, name }) => ({ seqno, name }));
        const actualColumns = (actual.prepare(`PRAGMA index_info(${quoteIdentifier(object.name)})`).all() as Array<{ seqno: number; name: string }>).map(({ seqno, name }) => ({ seqno, name }));
        if (JSON.stringify(actualColumns) !== JSON.stringify(expectedColumns)) throw new Error(`Migration schema effect is incompatible: index ${object.name}`);
      }
    }
  } finally {
    reference.close();
  }
}

export function runMigrations(db: Database.Database) {
  const manifest = getMigrationManifest();
  const migrationTableExists = Boolean(db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'",
  ).get());
  const existingSchemaObjects = Number(db.prepare(`
    SELECT COUNT(*) FROM sqlite_master
    WHERE name NOT LIKE 'sqlite_%' AND name <> 'schema_migrations'
  `).pluck().get());
  if (!migrationTableExists && existingSchemaObjects > 0) {
    throw new Error("Migration history is missing from an existing Kit schema");
  }
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)");
  const columns = new Set((db.prepare("PRAGMA table_info(schema_migrations)").all() as { name: string }[]).map(({ name }) => name));
  const hasChecksumColumn = columns.has("checksum");
  const applied = new Set<number>();
  const rows = db.prepare(`SELECT version, name, ${hasChecksumColumn ? "checksum" : "NULL AS checksum"} FROM schema_migrations ORDER BY version`).all() as Array<{ version: number; name: string; checksum: string | null }>;
  for (const [index, row] of rows.entries()) {
    const entry = manifest[index];
    if (!entry) throw new Error(`Database contains unsupported migration version v${row.version}`);
    if (row.version !== entry.version) throw new Error(`Migration history is not an exact prefix: expected v${entry.version}, found v${row.version}`);
    if (row.name !== entry.name) throw new Error(`Migration v${row.version} name mismatch: database=${row.name}, source=${entry.name}`);
    if (hasChecksumColumn && row.checksum === null) throw new Error(`Migration v${row.version} has a NULL checksum in a checksum-aware history`);
    if (row.checksum && row.checksum !== entry.checksum) throw new Error(`Migration v${row.version} checksum mismatch`);
    applied.add(row.version);
  }
  if (rows.length === 0 && existingSchemaObjects > 0) {
    throw new Error("Migration history is missing from an existing Kit schema");
  }
  if (rows.length > 0) assertSchemaEffects(db, rows.at(-1)!.version);
  if (!hasChecksumColumn) {
    db.transaction(() => {
      db.exec("ALTER TABLE schema_migrations ADD COLUMN checksum TEXT");
      const checksumBackfill = db.prepare("UPDATE schema_migrations SET checksum = ? WHERE version = ? AND checksum IS NULL");
      for (const row of rows) {
        checksumBackfill.run(manifest.find(({ version }) => version === row.version)!.checksum, row.version);
      }
    })();
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
