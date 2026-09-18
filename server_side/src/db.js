import { createClient } from "@libsql/client";
import { AsyncLocalStorage } from "node:async_hooks";
import { mkdirSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// One SQL dialect and driver for local SQLite and the durable Turso database.
// An explicit path always selects local storage, including in isolated tests.
export async function openDatabase(path, env = process.env) {
  const remote = path === undefined && !!env.TURSO_DATABASE_URL;
  if (path === undefined && env.TURSO_AUTH_TOKEN && !env.TURSO_DATABASE_URL)
    throw new Error("TURSO_DATABASE_URL is required with TURSO_AUTH_TOKEN.");
  if (remote && !env.TURSO_AUTH_TOKEN)
    throw new Error("TURSO_AUTH_TOKEN is required with TURSO_DATABASE_URL.");
  if (remote && !/^(libsql|https):\/\//.test(env.TURSO_DATABASE_URL))
    throw new Error("TURSO_DATABASE_URL must be a libsql:// or https:// URL.");
  if (!remote && path === undefined && env.RENDER === "true")
    throw new Error(
      "Render requires TURSO_DATABASE_URL and TURSO_AUTH_TOKEN; local SQLite is not persistent on the free tier.",
    );
  path ??= env.DATABASE_PATH || resolve(root, "data/marketplace.sqlite");
  if (!remote && path !== ":memory:")
    mkdirSync(dirname(resolve(path)), { recursive: true });
  const client = createClient({
    url: remote
      ? env.TURSO_DATABASE_URL
      : path === ":memory:"
        ? "file::memory:"
        : pathToFileURL(resolve(path)).href,
    ...(remote ? { authToken: env.TURSO_AUTH_TOKEN } : {}),
    intMode: "number",
  });
  const context = new AsyncLocalStorage();
  // Serialize this connection so a local asynchronous transaction cannot absorb
  // another request's statements. Turso also isolates its remote transactions.
  let queue = Promise.resolve();
  const exclusive = (fn) => {
    const result = queue.then(fn);
    queue = result.catch(() => {});
    return result;
  };
  const schedule = (fn) => (remote ? fn() : exclusive(fn));
  const execute = (sql, args) => {
    const tx = context.getStore();
    return tx
      ? tx.execute({ sql, args })
      : schedule(() => client.execute({ sql, args }));
  };
  const db = {
    remote,
    prepare(sql) {
      return {
        async run(...args) {
          const result = await execute(sql, args);
          return {
            changes: result.rowsAffected,
            lastInsertRowid: result.lastInsertRowid,
          };
        },
        async get(...args) {
          return (await execute(sql, args)).rows[0];
        },
        async all(...args) {
          return (await execute(sql, args)).rows;
        },
      };
    },
    exec(sql) {
      return schedule(() => client.executeMultiple(sql));
    },
    transaction(fn) {
      if (context.getStore())
        throw new Error("Nested transactions are not supported.");
      return schedule(async () => {
        const tx = await client.transaction("write");
        try {
          const result = await context.run(tx, fn);
          await tx.commit();
          return result;
        } catch (error) {
          await tx.rollback().catch(() => {});
          throw error;
        } finally {
          tx.close();
        }
      });
    },
    close() {
      client.close();
    },
  };
  try {
    if (!remote)
      await db.exec(
        "PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;",
      );
    // Verify the connection's foreign-key enforcement. Apply migrations before
    // accepting requests, including when opening an existing local SQLite file.
    if ((await db.prepare("PRAGMA foreign_keys").get()).foreign_keys !== 1)
      throw new Error(
        "The database connection must enforce foreign keys. Use a Turso Cloud libSQL database with foreign-key enforcement enabled.",
      );
    await db.exec(
      readFileSync(new URL("./schema.sql", import.meta.url), "utf8"),
    );
    await db.transaction(async () => {
      if (
        !(await db.prepare("PRAGMA table_info(sessions)").all()).some(
          (c) => c.name === "auth_method",
        )
      )
        await db
          .prepare(
            "ALTER TABLE sessions ADD COLUMN auth_method TEXT NOT NULL DEFAULT 'local'",
          )
          .run();
      if (
        !(await db.prepare("PRAGMA table_info(listings)").all()).some(
          (c) => c.name === "impressions",
        )
      )
        await db
          .prepare(
            "ALTER TABLE listings ADD COLUMN impressions INTEGER NOT NULL DEFAULT 0 CHECK(impressions >= 0)",
          )
          .run();
      if (
        !(await db.prepare("PRAGMA table_info(listings)").all()).some(
          (c) => c.name === "opens",
        )
      )
        await db
          .prepare(
            "ALTER TABLE listings ADD COLUMN opens INTEGER NOT NULL DEFAULT 0 CHECK(opens >= 0)",
          )
          .run();
    });
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
