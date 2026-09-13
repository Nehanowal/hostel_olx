import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import express from "express";
import { rateLimit } from "express-rate-limit";
import { v2 as cloudinary } from "cloudinary";
import sharp from "sharp";
import { openDatabase } from "../src/db.js";
import { createApp } from "../src/app.js";
import { createImageStorage } from "../src/image-storage.js";
import { configureProxy, rateLimitKey } from "../src/proxy.js";

const cloudEnv = {
  CLOUDINARY_CLOUD_NAME: "deployment-fixture",
  CLOUDINARY_API_KEY: "fixture-key",
  CLOUDINARY_API_SECRET: "fixture-secret",
};

async function listen(t, app) {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

async function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "hostel-deploy-"));
  const db = await openDatabase(join(dir, "db.sqlite"));
  const assets = new Map();
  const failures = { upload: false, remove: false };
  const cloud = {
    utils: cloudinary.utils,
    uploader: {
      upload_stream(options, callback) {
        const chunks = [];
        return new Writable({
          write(chunk, encoding, done) {
            chunks.push(chunk);
            done();
          },
          final(done) {
            if (failures.upload) callback(new Error("fixture upload failure"));
            else {
              assets.set(options.public_id, {
                options,
                buffer: Buffer.concat(chunks),
              });
              callback(null, { public_id: options.public_id });
            }
            done();
          },
        });
      },
      async destroy(id, options) {
        assert.equal(options.type, "authenticated");
        if (failures.remove) throw new Error("fixture delete failure");
        assets.delete(id);
        return { result: "ok" };
      },
    },
  };
  const imageStorage = createImageStorage({
    uploads: join(dir, "uploads"),
    env: cloudEnv,
    cloud,
  });
  const { app } = await createApp({
    db,
    seed: false,
    production: false,
    devAuth: true,
    imageStorage,
  });
  const base = await listen(t, app);
  t.after(() => db.close());
  const users = {};
  for (const name of ["seller", "buyer"]) {
    const id = randomUUID();
    const token = randomUUID();
    await db
      .prepare(
        "INSERT INTO users(id,email,name,university,verified_at) VALUES (?,?,?,?,?)",
      )
      .run(
        id,
        `${name}@nst.rishihood.edu.in`,
        name,
        "Rishihood University",
        new Date().toISOString(),
      );
    await db
      .prepare(
        "INSERT INTO sessions(token_hash,user_id,expires_at,auth_method) VALUES (?,?,?,'local')",
      )
      .run(
        createHash("sha256").update(token).digest("hex"),
        id,
        Date.now() + 60000,
      );
    users[name] = { id, cookie: `session=${token}` };
  }
  async function request(path, { user = "seller", method = "GET", body } = {}) {
    const form = body instanceof FormData;
    const response = await fetch(`${base}/api${path}`, {
      method,
      redirect: "manual",
      headers: {
        "X-Requested-With": "HostelOLX",
        Cookie: users[user]?.cookie || "",
        ...(body && !form ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? (form ? body : JSON.stringify(body)) : undefined,
    });
    return {
      status: response.status,
      headers: response.headers,
      body: await response.json().catch(() => null),
    };
  }
  async function upload() {
    const form = new FormData();
    form.append(
      "photo",
      new Blob([
        await sharp({
          create: { width: 12, height: 12, channels: 3, background: "red" },
        })
          .png()
          .toBuffer(),
      ]),
      "photo.png",
    );
    return request("/images", { method: "POST", body: form });
  }
  const listing = (id) => ({
    title: "Study lamp",
    description: "A working lamp for your study desk",
    category: "Room essentials",
    price: 50000,
    condition: "Good",
    location: "North hostel",
    imageIds: [id],
  });
  return { db, request, upload, listing, users, assets, failures };
}

test("asynchronous transaction rollback cannot absorb another request's write", async (t) => {
  const db = await openDatabase(":memory:");
  t.after(() => db.close());
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  const transaction = db.transaction(async () => {
    await db.prepare("INSERT INTO google_challenges VALUES ('inside',0)").run();
    entered.resolve();
    await release.promise;
    throw new Error("abort transaction");
  });
  await entered.promise;
  const outsider = db
    .prepare("INSERT INTO google_challenges VALUES ('outside',0)")
    .run();
  const rejected = assert.rejects(transaction, /abort transaction/);
  release.resolve();
  await Promise.all([rejected, outsider]);
  assert.equal(
    await db
      .prepare("SELECT 1 FROM google_challenges WHERE nonce_hash='inside'")
      .get(),
    undefined,
  );
  assert.ok(
    await db
      .prepare("SELECT 1 FROM google_challenges WHERE nonce_hash='outside'")
      .get(),
  );
  await assert.rejects(
    db
      .prepare("INSERT INTO sessions VALUES ('orphan','missing',0,'google')")
      .run(),
    /FOREIGN KEY/,
  );
});

test("cloud photos stay authenticated, are normalized, and can be deleted", async (t) => {
  const { request, upload, assets } = await fixture(t);
  const result = await upload();
  assert.equal(result.status, 201);
  const id = result.body.id;
  const asset = assets.get(`hostel-olx/${id}`);
  assert.equal(asset.options.type, "authenticated");
  assert.equal((await sharp(asset.buffer).metadata()).format, "webp");
  assert.equal(
    (await request(`/images/${id}`, { user: "anonymous" })).status,
    401,
  );
  assert.equal((await request(`/images/${id}`, { user: "buyer" })).status, 404);
  const image = await request(`/images/${id}`);
  assert.equal(image.status, 302);
  assert.equal(image.headers.get("cache-control"), "no-store");
  const url = new URL(image.headers.get("location"));
  assert.equal(url.hostname, "api.cloudinary.com");
  assert.equal(url.searchParams.get("type"), "authenticated");
  assert.equal(url.searchParams.get("public_id"), `hostel-olx/${id}`);
  assert.ok(
    Number(url.searchParams.get("expires_at")) <= Date.now() / 1000 + 60,
  );
  assert.ok(url.searchParams.get("signature"));
  assert.ok(!url.href.includes(cloudEnv.CLOUDINARY_API_SECRET));
  assert.equal(
    (await request(`/images/${id}`, { method: "DELETE" })).status,
    200,
  );
  assert.equal(assets.size, 0);
  assert.equal((await request(`/images/${id}`)).status, 404);
});

test("cloud upload failure leaves no database row; failed deletion can be retried", async (t) => {
  const { request, upload, db, failures } = await fixture(t);
  failures.upload = true;
  assert.equal((await upload()).status, 500);
  assert.equal(
    (await db.prepare("SELECT count(*) AS n FROM images").get()).n,
    0,
  );
  failures.upload = false;
  const {
    body: { id },
  } = await upload();
  failures.remove = true;
  assert.equal(
    (await request(`/images/${id}`, { method: "DELETE" })).status,
    500,
  );
  assert.ok(await db.prepare("SELECT 1 FROM images WHERE id=?").get(id));
  failures.remove = false;
  assert.equal(
    (await request(`/images/${id}`, { method: "DELETE" })).status,
    200,
  );
});

test("concurrent listing changes reject stale edits and duplicate chats share one conversation", async (t) => {
  const { request, upload, listing, db } = await fixture(t);
  const photo = await upload();
  const body = listing(photo.body.id);
  const creations = await Promise.all(
    [1, 2].map(() => request("/listings", { method: "POST", body })),
  );
  assert.deepEqual(creations.map((r) => r.status).sort(), [201, 422]);
  const item = creations.find((r) => r.status === 201).body;
  const edits = await Promise.all(
    ["Changed title one", "Changed title two"].map((title) =>
      request(`/listings/${item.id}`, {
        method: "PATCH",
        body: { ...body, title, version: 1 },
      }),
    ),
  );
  assert.deepEqual(edits.map((r) => r.status).sort(), [200, 409]);
  const chats = await Promise.all(
    [1, 2].map(() =>
      request(`/listings/${item.id}/conversations`, {
        method: "POST",
        user: "buyer",
      }),
    ),
  );
  assert.ok(chats.every((r) => [200, 201].includes(r.status)));
  assert.equal(chats[0].body.id, chats[1].body.id);
  assert.equal(
    (await db.prepare("SELECT count(*) AS n FROM conversations").get()).n,
    1,
  );
  assert.equal(
    (await request(`/images/${photo.body.id}`, { user: "buyer" })).status,
    302,
  );
  const statuses = await Promise.all(
    ["sold", "unavailable"].map((status) =>
      request(`/listings/${item.id}/status`, {
        method: "PATCH",
        body: { status, version: 2 },
      }),
    ),
  );
  assert.deepEqual(statuses.map((r) => r.status).sort(), [200, 409]);
});

test("proxy authenticates forwarded IPs and rate limits students separately", async (t) => {
  const app = express();
  const secret = "test-proxy-secret-at-least-32-characters";
  configureProxy(app, { RENDER: "true", API_PROXY_SECRET: secret });
  app.get("/api/health", (req, res) => res.json({ ok: true }));
  app.use(
    "/api",
    rateLimit({ windowMs: 60000, limit: 1, keyGenerator: rateLimitKey }),
  );
  app.get("/api/config", (req, res) => res.json({ ok: true }));
  const base = await listen(t, app);
  assert.equal((await fetch(`${base}/api/health`)).status, 200);
  assert.equal(
    (
      await fetch(`${base}/api/config`, {
        headers: { "x-vercel-forwarded-for": "192.0.2.1" },
      })
    ).status,
    403,
  );
  const headers = {
    "x-api-proxy-secret": secret,
    "x-vercel-forwarded-for": "192.0.2.1",
  };
  assert.equal((await fetch(`${base}/api/config`, { headers })).status, 200);
  assert.equal(
    (
      await fetch(`${base}/api/config`, {
        headers: { ...headers, "x-forwarded-for": "198.51.100.2" },
      })
    ).status,
    429,
  );
  assert.equal(
    (
      await fetch(`${base}/api/config`, {
        headers: { ...headers, "x-vercel-forwarded-for": "192.0.2.2" },
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await fetch(`${base}/api/config`, {
        headers: { ...headers, "x-vercel-forwarded-for": "invalid" },
      })
    ).status,
    400,
  );
  assert.equal((await fetch(`${base}/api/health`)).status, 200);
});

test("Render cannot silently fall back to temporary photo storage", () => {
  assert.throws(
    () => createImageStorage({ uploads: "/unused", env: { RENDER: "true" } }),
    /Cloudinary is required/,
  );
  assert.throws(
    () =>
      createImageStorage({
        uploads: "/unused",
        env: { CLOUDINARY_CLOUD_NAME: "partial" },
      }),
    /all three/,
  );
  assert.throws(
    () => configureProxy(express(), { RENDER: "true" }),
    /API_PROXY_SECRET/,
  );
});

test("Render and partial Turso credentials cannot fall back to local SQLite", async () => {
  await assert.rejects(
    openDatabase(undefined, { RENDER: "true" }),
    /Render requires TURSO/,
  );
  await assert.rejects(
    openDatabase(undefined, {
      TURSO_DATABASE_URL: "libsql:\/\/fixture.turso.io",
    }),
    /TURSO_AUTH_TOKEN is required/,
  );
  await assert.rejects(
    openDatabase(undefined, { TURSO_AUTH_TOKEN: "fixture-token" }),
    /TURSO_DATABASE_URL is required/,
  );
  await assert.rejects(
    openDatabase(undefined, {
      TURSO_DATABASE_URL: "http:\/\/fixture.turso.io",
      TURSO_AUTH_TOKEN: "fixture-token",
    }),
    /must be a libsql/,
  );
});

test("a remote database cannot enable test login or receive sample seeding", async (t) => {
  const db = await openDatabase(":memory:");
  db.remote = true;
  t.after(() => db.close());
  const uploads = mkdtempSync(join(tmpdir(), "hostel-remote-auth-"));
  await assert.rejects(
    createApp({ db, uploads, devAuth: true, production: false }),
    /Remote databases require real authentication/,
  );
  await createApp({
    db,
    uploads,
    production: false,
    googleClientId: "fixture.apps.googleusercontent.com",
  });
  assert.equal(
    (await db.prepare("SELECT count(*) AS n FROM listings").get()).n,
    0,
  );
});
