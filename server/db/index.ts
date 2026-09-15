import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { runMigrations } from "./migrate.js";
import { seedDevelopmentData } from "./seed.js";

export function openDatabase(dbPath = process.env.DB_PATH || path.resolve("data/dsdst-kit-studio.db")): Database.Database {
  if (dbPath !== ":memory:") fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  runMigrations(db);
  if (process.env.NODE_ENV !== "production") seedDevelopmentData(db);
  return db;
}
