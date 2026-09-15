import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";

const migrationDir = path.resolve(process.cwd(), "server/db/migrations");

export function runMigrations(db: Database.Database) {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)");
  const applied = new Set((db.prepare("SELECT version FROM schema_migrations").all() as { version: number }[]).map((row) => row.version));
  const files = fs.readdirSync(migrationDir).filter((file) => /^\d+_.+\.sql$/.test(file)).sort();
  for (const file of files) {
    const version = Number(file.split("_")[0]);
    if (applied.has(version)) continue;
    const sql = fs.readFileSync(path.join(migrationDir, file), "utf8");
    db.transaction(() => {
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations (version, name) VALUES (?, ?)").run(version, file);
    })();
  }
}
