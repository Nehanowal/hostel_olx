import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export function openDatabase(
  path = process.env.DATABASE_PATH || resolve(root, "data/marketplace.sqlite"),
) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(
    "PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;",
  );
  db.exec(readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
  // Forward-only migration for the initial local preview database.
  if (
    !db
      .prepare("PRAGMA table_info(sessions)")
      .all()
      .some((column) => column.name === "auth_method")
  ) {
    db.exec(
      "ALTER TABLE sessions ADD COLUMN auth_method TEXT NOT NULL DEFAULT 'local'",
    );
  }
  return db;
}
