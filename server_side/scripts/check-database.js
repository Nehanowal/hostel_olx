import { randomBytes } from "node:crypto";
import { openDatabase } from "../src/db.js";

const db = await openDatabase();
const nonce = randomBytes(32).toString("hex");
const rollback = new Error("rollback connectivity probe");
try {
  try {
    await db.transaction(async () => {
      await db
        .prepare(
          "INSERT INTO google_challenges(nonce_hash,expires_at) VALUES (?,0)",
        )
        .run(nonce);
      if (
        !(await db
          .prepare("SELECT 1 FROM google_challenges WHERE nonce_hash=?")
          .get(nonce))
      )
        throw new Error("The test write could not be read back.");
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
  if (
    await db
      .prepare("SELECT 1 FROM google_challenges WHERE nonce_hash=?")
      .get(nonce)
  )
    throw new Error("The database did not roll back the test write.");
  console.log(
    `${db.remote ? "Turso" : "Local SQLite"}: schema, reads, writes and rollback verified. No test record retained.`,
  );
} finally {
  db.close();
}
