import test from "node:test";
import assert from "node:assert/strict";
import {
  generateKeyPairSync,
  createSign,
  randomUUID,
  createHash,
} from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OAuth2Client } from "google-auth-library";
import sharp from "sharp";
import { createApp } from "../src/app.js";
import { openDatabase } from "../src/db.js";

const domains = [
  "nst.rishihood.edu.in",
  "csds.rishihood.edu.in",
  "psy.rishihood.edu.in",
  "makers.rishihood.edu.in",
  "rishihood.edu.in",
];
const clientId = "fixture.apps.googleusercontent.com";
const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
function signedToken(nonce, claims = {}, key = privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(
    JSON.stringify({ alg: "RS256", kid: "fixture" }),
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      iss: "https://accounts.google.com",
      aud: clientId,
      sub: "google-student-1",
      email: "student@nst.rishihood.edu.in",
      email_verified: true,
      hd: "rishihood.edu.in",
      name: "Student",
      iat: now,
      exp: now + 3600,
      nonce,
      ...claims,
    }),
  ).toString("base64url");
  return `${header}.${payload}.${createSign("RSA-SHA256").update(`${header}.${payload}`).sign(key, "base64url")}`;
}
async function fixture(t, options = {}) {
  const dir = mkdtempSync(join(tmpdir(), "hostel-improvements-"));
  const path = join(dir, "test.sqlite");
  const db = await openDatabase(path);
  const client = new OAuth2Client();
  // Keep Google's real signature/audience/issuer/expiry verifier; substitute only
  // certificate download with our test key so tests need no external credentials.
  client.getFederatedSignonCertsAsync = async () => ({
    certs: { fixture: publicKey.export({ type: "spki", format: "pem" }) },
  });
  const { app } = await createApp({
    db,
    uploads: join(dir, "uploads"),
    seed: false,
    devAuth: true,
    googleClient: client,
    ...options,
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  async function request(
    path,
    { method = "GET", cookie = "", body, headers = {} } = {},
  ) {
    const form = body instanceof FormData;
    const response = await fetch(base + path, {
      method,
      headers: {
        "X-Requested-With": "HostelOLX",
        Cookie: cookie,
        ...(body && !form ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      body: body ? (form ? body : JSON.stringify(body)) : undefined,
    });
    return {
      status: response.status,
      body: await response.json().catch(() => null),
      headers: response.headers,
      cookie:
        response.headers
          .getSetCookie()
          .find((value) => value.startsWith("session="))
          ?.split(";")[0] || response.headers.getSetCookie()[0]?.split(";")[0],
    };
  }
  async function login(name, domain = domains[0]) {
    const challenge = await request("/auth/request", {
      method: "POST",
      body: { name, email: `${name.toLowerCase()}@${domain}` },
    });
    assert.equal(challenge.status, 200, JSON.stringify(challenge.body));
    const result = await request("/auth/verify", {
      method: "POST",
      body: {
        challengeId: challenge.body.challengeId,
        code: challenge.body.devCode,
      },
    });
    assert.equal(result.status, 200);
    return result;
  }
  async function google(claims = {}, key = privateKey) {
    const nonce = await request("/auth/google/nonce", { method: "POST" });
    assert.equal(nonce.status, 200);
    const credential = signedToken(nonce.body.nonce, claims, key);
    const result = await request("/auth/google", {
      method: "POST",
      cookie: nonce.cookie,
      body: { credential },
    });
    return { ...result, credential, nonceCookie: nonce.cookie };
  }
  return { db, path, request, login, google };
}

test("a published listing, its photo and seller chat are shared by all four courses and plain university accounts after logout", async (t) => {
  const { request, login, path } = await fixture(t);
  const seller = await login("Seller");
  const photo = new FormData();
  photo.append(
    "photo",
    new Blob(
      [
        await sharp({
          create: { width: 32, height: 32, channels: 3, background: "#294cda" },
        })
          .png()
          .toBuffer(),
      ],
      { type: "image/png" },
    ),
    "photo.png",
  );
  const uploaded = await request("/images", {
    method: "POST",
    cookie: seller.cookie,
    body: photo,
  });
  assert.equal(uploaded.status, 201);
  const listed = await request("/listings", {
    method: "POST",
    cookie: seller.cookie,
    body: {
      title: "Shared campus lamp",
      description: "A working lamp for your study desk.",
      category: "Room essentials",
      price: 50000,
      condition: "Good",
      location: "Main gate",
      imageIds: [uploaded.body.id],
    },
  });
  assert.equal(listed.status, 201, JSON.stringify(listed.body));
  await request("/auth/logout", { method: "POST", cookie: seller.cookie });
  assert.equal(
    (await request("/listings", { cookie: seller.cookie })).status,
    401,
  );
  for (const [index, domain] of domains.slice(1).entries()) {
    const buyer = await login(`Buyer${index}`, domain);
    assert.equal(buyer.body.user.university, seller.body.user.university);
    const feed = await request("/listings", { cookie: buyer.cookie });
    assert.equal(feed.body.items[0].id, listed.body.id);
    assert.equal(feed.body.items[0].isOwner, false);
    assert.equal(
      (await request(`/images/${uploaded.body.id}`, { cookie: buyer.cookie }))
        .status,
      200,
    );
    assert.equal(
      (
        await request(`/listings/${listed.body.id}/conversations`, {
          method: "POST",
          cookie: buyer.cookie,
        })
      ).status,
      201,
    );
  }
  const reopened = await openDatabase(path);
  assert.equal(
    (
      await reopened
        .prepare("SELECT status FROM listings WHERE id=?")
        .get(listed.body.id)
    ).status,
    "active",
  );
  assert.equal(
    (await reopened.prepare("SELECT count(*) AS n FROM conversations").get()).n,
    4,
  );
  reopened.close();
});

test("fresh uploads lead, older popular listings rise, impressions deduplicate and respect ownership, campus and visibility", async (t) => {
  const { db, path, request, login } = await fixture(t);
  const seller = await login("Seller"),
    buyer = await login("Buyer", domains[1]);
  async function listing(
    title,
    hours,
    impressions = 0,
    status = "active",
    university = seller.body.user.university,
  ) {
    const id = randomUUID();
    await db
      .prepare(
        "INSERT INTO listings(id,seller_id,university,title,description,category,price,condition,location,created_at,impressions,status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        id,
        seller.body.user.id,
        university,
        title,
        "A useful campus item",
        "Other",
        100,
        "Good",
        "Gate",
        new Date(Date.now() - hours * 3600000).toISOString(),
        impressions,
        status,
      );
    return id;
  }
  const quiet = await listing("Older quiet", 80),
    popular = await listing("Older popular", 90, 8),
    fresh = await listing("Fresh", 2),
    newest = await listing("Newest", 1);
  await db.prepare("UPDATE listings SET opens=8 WHERE id=?").run(popular);
  const hidden = await listing("Hidden", 0, 100, "unavailable"),
    sold = await listing("Sold", 0, 100, "sold"),
    foreign = await listing(
      "Other campus",
      0,
      100,
      "active",
      "Other University",
    );
  assert.deepEqual(
    (await request("/listings", { cookie: buyer.cookie })).body.items.map(
      (x) => x.id,
    ),
    [newest, fresh, popular, quiet],
  );
  assert.equal(
    (await request("/listings?sort=popular", { cookie: buyer.cookie })).body
      .items[0].id,
    popular,
  );
  assert.equal(
    (await request("/listings?sort=newest", { cookie: buyer.cookie })).body
      .items[0].id,
    newest,
  );
  const impression = (cookie) =>
    request("/listings/impressions", {
      method: "POST",
      cookie,
      body: { ids: [fresh, fresh, hidden, sold, foreign] },
    });
  await impression(seller.cookie);
  assert.equal(
    (await db.prepare("SELECT impressions FROM listings WHERE id=?").get(fresh))
      .impressions,
    0,
  );
  await Promise.all([impression(buyer.cookie), impression(buyer.cookie)]);
  assert.equal(
    (await db.prepare("SELECT impressions FROM listings WHERE id=?").get(fresh))
      .impressions,
    1,
  );
  for (const id of [hidden, sold, foreign])
    assert.equal(
      (await db.prepare("SELECT impressions FROM listings WHERE id=?").get(id))
        .impressions,
      100,
    );
  assert.equal((await impression("")).status, 401);
  const restored = await request(`/listings/${hidden}/status`, {
    method: "PATCH",
    cookie: seller.cookie,
    body: { status: "active", version: 1 },
  });
  assert.equal(restored.status, 200);
  assert.equal(
    (await request("/listings", { cookie: buyer.cookie })).body.items[0].id,
    hidden,
  );
  assert.equal(
    (
      await request(`/listings/${hidden}/status`, {
        method: "PATCH",
        cookie: buyer.cookie,
        body: { status: "unavailable", version: 2 },
      })
    ).status,
    403,
  );
  const reopened = await openDatabase(path);
  assert.equal(
    (
      await reopened
        .prepare("SELECT impressions FROM listings WHERE id=?")
        .get(fresh)
    ).impressions,
    1,
  );
  reopened.close();
});

test("campus spotlight ranks the whole active inventory, excludes samples and hidden sellers, and opens details and a two-way seller chat", async (t) => {
  const { db, request, login } = await fixture(t);
  const seller = await login("Seller"),
    buyer = await login("Buyer", domains[3]);
  assert.equal((await request("/listings/most-viewed")).status, 401);
  assert.deepEqual(
    (await request("/listings/most-viewed", { cookie: buyer.cookie })).body
      .items,
    [],
  );
  async function listing(title, hours, impressions = 0, overrides = {}) {
    const id = randomUUID();
    const fields = {
      seller: seller.body.user.id,
      university: seller.body.user.university,
      status: "active",
      demo: 0,
      ...overrides,
    };
    await db
      .prepare(
        "INSERT INTO listings(id,seller_id,university,title,description,category,price,condition,location,created_at,impressions,status,is_demo,attributes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        id,
        fields.seller,
        fields.university,
        title,
        "A working lamp with an adjustable arm and warm light.",
        "Room essentials",
        50000,
        "Good",
        "Main gate",
        new Date(Date.now() - hours * 3600000).toISOString(),
        impressions,
        fields.status,
        fields.demo,
        JSON.stringify({ Brand: "Study lamp" }),
      );
    return id;
  }
  for (let n = 1; n <= 27; n++) await listing(`Recent find ${n}`, n);
  const popular = await listing("Popular older lamp", 168, 80);
  const tieOlder = await listing("Tied older lamp", 120, 100);
  const tieNewer = await listing("Tied newer lamp", 90, 100);
  for (const status of ["sold", "unavailable", "removed", "deleted"])
    await listing(status, 1, 999, { status });
  await listing("Sample", 1, 999, { demo: 1 });
  await listing("Other campus", 1, 999, { university: "Other University" });
  const suspendedId = randomUUID();
  await db
    .prepare(
      "INSERT INTO users(id,email,name,university,verified_at,status) VALUES (?,?,?,?,?,'suspended')",
    )
    .run(
      suspendedId,
      "suspended@nst.rishihood.edu.in",
      "Suspended",
      seller.body.user.university,
      new Date().toISOString(),
    );
  await listing("Suspended seller", 1, 999, { seller: suspendedId });
  await db
    .prepare(
      "INSERT INTO images(id,owner_id,listing_id,path,created_at) VALUES (?,?,?,?,?)",
    )
    .run(
      randomUUID(),
      seller.body.user.id,
      tieNewer,
      "fixture.webp",
      Date.now(),
    );
  // A popular older item can be outside the first page of the fresh feed.
  assert.equal(
    (await request("/listings", { cookie: buyer.cookie })).body.items.some(
      (item) => item.id === popular,
    ),
    false,
  );
  const spotlight = await request("/listings/most-viewed", {
    cookie: buyer.cookie,
  });
  assert.equal(spotlight.status, 200);
  assert.equal(spotlight.body.items.length, 12);
  assert.deepEqual(
    spotlight.body.items.slice(0, 3).map((item) => item.id),
    [tieNewer, tieOlder, popular],
  );
  assert.equal(
    spotlight.body.items.every(
      (item) =>
        !item.is_demo &&
        !item.isOwner &&
        item.status === "active" &&
        item.impressions < 999,
    ),
    true,
  );
  assert.equal(
    (await request("/listings/most-viewed", { cookie: seller.cookie })).body
      .items[0].isOwner,
    true,
  );
  const detail = await request(`/listings/${spotlight.body.items[0].id}`, {
    cookie: buyer.cookie,
  });
  assert.equal(detail.body.seller_name, "Seller");
  assert.equal(
    detail.body.description,
    "A working lamp with an adjustable arm and warm light.",
  );
  assert.deepEqual(detail.body.attributes, { Brand: "Study lamp" });
  assert.equal(detail.body.images.length, 1);
  const chat = await request(`/listings/${detail.body.id}/conversations`, {
    method: "POST",
    cookie: buyer.cookie,
  });
  assert.equal(chat.status, 201);
  assert.equal(
    (
      await request(`/conversations/${chat.body.id}/messages`, {
        method: "POST",
        cookie: buyer.cookie,
        body: { body: "Is the lamp available?", clientId: randomUUID() },
      })
    ).status,
    201,
  );
  assert.equal(
    (
      await request(`/conversations/${chat.body.id}/messages`, {
        cookie: seller.cookie,
      })
    ).body.messages[0].body,
    "Is the lamp available?",
  );
  await request(`/conversations/${chat.body.id}/messages`, {
    method: "POST",
    cookie: seller.cookie,
    body: {
      body: "Yes, we can meet at the main gate.",
      clientId: randomUUID(),
    },
  });
  assert.equal(
    (
      await request(`/conversations/${chat.body.id}/messages`, {
        cookie: buyer.cookie,
      })
    ).body.messages.length,
    2,
  );
  await request(`/listings/${tieNewer}/status`, {
    method: "PATCH",
    cookie: seller.cookie,
    body: { status: "sold", version: 1 },
  });
  assert.equal(
    (
      await request("/listings/most-viewed", { cookie: buyer.cookie })
    ).body.items.some((item) => item.id === tieNewer),
    false,
  );
});

test("Google verifies a Workspace identity, links existing inventory, revokes local sessions and rejects nonce replay", async (t) => {
  const { db, request, google } = await fixture(t, {
    googleClientId: clientId,
  });
  const legacyId = randomUUID();
  await db
    .prepare(
      "INSERT INTO users(id,email,name,university,verified_at) VALUES (?,?,?,?,?)",
    )
    .run(
      legacyId,
      "student@nst.rishihood.edu.in",
      "Original name",
      "Rishihood University",
      new Date().toISOString(),
    );
  await db
    .prepare(
      "INSERT INTO sessions(token_hash,user_id,expires_at,auth_method) VALUES (?,?,?,?)",
    )
    .run(
      createHash("sha256").update("old-token").digest("hex"),
      legacyId,
      Date.now() + 100000,
      "local",
    );
  assert.equal(
    (await request("/me", { cookie: "session=old-token" })).body.user,
    null,
  );
  const result = await google();
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.user.id, legacyId);
  assert.equal(result.body.user.authMethod, "google");
  assert.equal(
    (await request("/me", { cookie: result.cookie })).body.user.id,
    legacyId,
  );
  assert.equal(
    (
      await db
        .prepare("SELECT count(*) AS n FROM sessions WHERE auth_method='local'")
        .get()
    ).n,
    0,
  );
  assert.match(result.headers.get("set-cookie"), /HttpOnly/);
  assert.equal(
    (
      await request("/auth/google", {
        method: "POST",
        cookie: result.nonceCookie,
        body: { credential: result.credential },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request("/auth/request", {
        method: "POST",
        body: { name: "Test", email: "test@nst.rishihood.edu.in" },
      })
    ).status,
    403,
  );
  assert.equal(
    (await request("/auth/verify", { method: "POST", body: {} })).status,
    403,
  );
});

test("Google rejects unverified, personal, unapproved and lookalike domains", async (t) => {
  const { google, db } = await fixture(t, { googleClientId: clientId });
  for (const claims of [
    { email_verified: false },
    { hd: undefined },
    { email: "student@gmail.com", hd: "gmail.com" },
    { email: "student@fake.rishihood.edu.in" },
    { email: "student@nst.rishihood.edu.in.attacker.com" },
    { hd: "other-university.edu" },
  ])
    assert.equal((await google(claims)).status, 403);
  assert.equal(
    (await db.prepare("SELECT count(*) AS n FROM users").get()).n,
    0,
  );
});

test("Google rejects bad signatures, wrong audience/issuer, expired credentials, wrong nonce and missing cookie", async (t) => {
  const { google, request } = await fixture(t, { googleClientId: clientId });
  for (const claims of [
    { aud: "attacker-app" },
    { iss: "https://attacker.example" },
    { exp: Math.floor(Date.now() / 1000) - 10 },
    { nonce: "wrong" },
  ])
    assert.equal((await google(claims)).status, 401);
  const wrongKey = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  }).privateKey;
  assert.equal((await google({}, wrongKey)).status, 401);
  assert.equal(
    (
      await request("/auth/google", {
        method: "POST",
        body: { credential: signedToken("missing") },
      })
    ).status,
    400,
  );
});

test("Google supports every approved course under one Workspace organization and blocks suspended accounts", async (t) => {
  const { google, db } = await fixture(t, { googleClientId: clientId });
  for (const [index, domain] of domains.entries()) {
    const result = await google({
      sub: `course-${index}`,
      email: `student@${domain}`,
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.user.university, "Rishihood University");
  }
  await db
    .prepare(
      "UPDATE users SET status='suspended' WHERE email='student@nst.rishihood.edu.in'",
    )
    .run();
  assert.equal((await google({ sub: "course-0" })).status, 403);
});

test("Google-only production works without SMTP and exposes CSP needed for its official button", async (t) => {
  const previous = process.env.APP_ORIGIN;
  process.env.APP_ORIGIN = "https://campus.example";
  t.after(() => {
    if (previous === undefined) delete process.env.APP_ORIGIN;
    else process.env.APP_ORIGIN = previous;
  });
  const { request, google } = await fixture(t, {
    googleClientId: clientId,
    production: true,
  });
  const config = await request("/config");
  assert.equal(config.body.devAuth, false);
  assert.equal(config.body.googleOnly, true);
  assert.match(
    config.headers.get("content-security-policy"),
    /https:\/\/accounts.google.com\/gsi\/client/,
  );
  assert.equal(
    config.headers.get("cross-origin-opener-policy"),
    "same-origin-allow-popups",
  );
  const result = await google();
  assert.equal(result.status, 200);
  assert.match(result.headers.get("set-cookie"), /Secure/);
  assert.equal(
    (
      await request("/auth/google/nonce", {
        method: "POST",
        headers: { Origin: "https://evil.example" },
      })
    ).status,
    403,
  );
});

test("popular campus finds rank deliberate opens, deduplicate daily and exclude ineligible listings", async t => {
  const { db, path, request, login } = await fixture(t);
  const seller = await login("Seller"), buyer = await login("Buyer"), other = await login("Other");
  const university = seller.body.user.university;
  async function listing(title, overrides = {}) {
    const id = randomUUID();
    await db.prepare("INSERT INTO listings(id,seller_id,university,title,description,category,price,condition,location,status,is_demo,impressions,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").run(
      id, seller.body.user.id, overrides.university || university, title, "Campus find", "Other", 20000, "Good", "Campus",
      overrides.status || "active", overrides.demo || 0, overrides.impressions || 0, "2026-01-01T00:00:00.000Z");
    return id;
  }
  const clicked = await listing("Clicked"), seen = await listing("Seen", { impressions: 1000 });
  const excluded = [await listing("Sold", { status: "sold" }), await listing("Hidden", { status: "unavailable" }), await listing("Deleted", { status: "deleted" }), await listing("Removed", { status: "removed" }), await listing("Sample", { demo: 1 }), await listing("Foreign", { university: "Elsewhere" })];
  const open = (id, cookie = buyer.cookie) => request(`/listings/${id}/open`, { method: "POST", cookie });
  assert.equal((await request("/listings/popular")).status, 401);
  assert.equal((await request(`/listings/${clicked}/open`, { method: "POST" })).status, 401);
  assert.equal((await open("invalid")).status, 422);
  await request(`/listings/${clicked}`, { cookie: buyer.cookie });
  assert.equal((await db.prepare("SELECT opens FROM listings WHERE id=?").get(clicked)).opens, 0);
  await Promise.all([open(clicked), open(clicked), open(clicked)]);
  await open(clicked, seller.cookie);
  for (const id of excluded) await open(id);
  assert.equal((await db.prepare("SELECT opens FROM listings WHERE id=?").get(clicked)).opens, 1);
  for (const id of excluded) assert.equal((await db.prepare("SELECT opens FROM listings WHERE id=?").get(id)).opens, 0);
  await open(clicked, other.cookie);
  assert.equal((await db.prepare("SELECT opens FROM listings WHERE id=?").get(clicked)).opens, 2);
  await db.prepare("UPDATE listing_opens SET day='2000-01-01' WHERE listing_id=?").run(clicked);
  await open(clicked);
  assert.equal((await db.prepare("SELECT opens FROM listings WHERE id=?").get(clicked)).opens, 3);
  const popular = await request("/listings/popular", { cookie: buyer.cookie });
  assert.deepEqual(popular.body.items.map(i => i.id), [clicked, seen]);
  assert.equal((await request("/listings?sort=popular", { cookie: buyer.cookie })).body.items[0].id, clicked);
  const reopened = await openDatabase(path);
  assert.equal((await reopened.prepare("SELECT opens FROM listings WHERE id=?").get(clicked)).opens, 3);
  reopened.close();
  await db.prepare("UPDATE users SET status='suspended' WHERE id=?").run(seller.body.user.id);
  await open(clicked, other.cookie);
  assert.equal((await db.prepare("SELECT opens FROM listings WHERE id=?").get(clicked)).opens, 3);
  assert.deepEqual((await request("/listings/popular", { cookie: buyer.cookie })).body.items, []);
});

test("existing databases gain click tracking without losing listings or impression history", async () => {
  const dir = mkdtempSync(join(tmpdir(), "final-price-migration-"));
  const path = join(dir, "old.sqlite");
  let db = await openDatabase(path);
  await db.prepare("INSERT INTO users(id,email,name,university,verified_at) VALUES ('seller','seller@example.edu','Seller','Campus','2026-01-01')").run();
  await db.prepare("INSERT INTO listings(id,seller_id,university,title,description,category,price,condition,location,impressions) VALUES ('existing','seller','Campus','Existing item','Keep me','Other',100,'Good','Campus',42)").run();
  await db.exec("DROP TABLE listing_opens; ALTER TABLE listings DROP COLUMN opens;");
  db.close();
  db = await openDatabase(path);
  const row = await db.prepare("SELECT title,impressions,opens FROM listings WHERE id='existing'").get();
  assert.deepEqual(row, { title: "Existing item", impressions: 42, opens: 0 });
  assert.deepEqual(await db.prepare("SELECT * FROM listing_opens").all(), []);
  db.close();
});
