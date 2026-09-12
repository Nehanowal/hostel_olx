import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { createApp } from "../src/app.js";
import { openDatabase } from "../src/db.js";

test("student marketplace: real persistence, permissions, media, lifecycle, chat and moderation", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "hostel-olx-test-"));
  const database = join(dir, "test.sqlite");
  const domain = "nst.rishihood.edu.in";
  const previousAdmins = process.env.ADMIN_EMAILS;
  process.env.ADMIN_EMAILS = `moderator@${domain}`;
  const db = openDatabase(database);
  const { app } = createApp({
    db,
    seed: false,
    devAuth: true,
    uploads: join(dir, "uploads"),
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  t.after(() => {
    server.close();
    db.close();
    if (previousAdmins === undefined) delete process.env.ADMIN_EMAILS;
    else process.env.ADMIN_EMAILS = previousAdmins;
  });
  async function request(
    path,
    { cookie = "", method = "GET", body, headers = {} } = {},
  ) {
    const form = body instanceof FormData;
    const response = await fetch(base + path, {
      method,
      headers: {
        "X-Requested-With": "HostelOLX",
        Cookie: cookie,
        ...(!form && body ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      body: body ? (form ? body : JSON.stringify(body)) : undefined,
    });
    const value = await response.json().catch(() => null);
    return {
      status: response.status,
      body: value,
      cookie: response.headers.get("set-cookie")?.split(";")[0],
      headers: response.headers,
    };
  }
  async function login(name) {
    const challenge = await request("/auth/request", {
      method: "POST",
      body: { name, email: `${name.toLowerCase()}@${domain}` },
    });
    assert.equal(challenge.status, 200, JSON.stringify(challenge.body));
    const signed = await request("/auth/verify", {
      method: "POST",
      body: {
        challengeId: challenge.body.challengeId,
        code: challenge.body.devCode,
      },
    });
    assert.equal(signed.status, 200);
    assert.match(signed.headers.get("set-cookie"), /HttpOnly/);
    return signed;
  }
  await t.test(
    "reject anonymous access, wrong domains and cross-origin mutations",
    async () => {
      assert.equal((await request("/listings")).status, 401);
      assert.equal(
        (
          await request("/auth/request", {
            method: "POST",
            body: { name: "Nope", email: "student@gmail.com" },
          })
        ).status,
        422,
      );
      assert.equal(
        (
          await request("/auth/request", {
            method: "POST",
            body: { name: "Nope", email: `x@${domain}.attacker.com` },
          })
        ).status,
        422,
      );
      assert.equal(
        (
          await request("/auth/logout", {
            method: "POST",
            headers: { Origin: "https://evil.example" },
          })
        ).status,
        403,
      );
    },
  );
  const seller = await login("Seller"),
    buyer = await login("Buyer"),
    stranger = await login("Stranger"),
    moderator = await login("Moderator");
  let photo, listing, chat;
  await t.test(
    "validate and normalize an uploaded photo; enforce ownership",
    async () => {
      const invalid = new FormData();
      invalid.append(
        "photo",
        new Blob(["not an image"], { type: "image/png" }),
        "bad.png",
      );
      assert.equal(
        (
          await request("/images", {
            method: "POST",
            cookie: seller.cookie,
            body: invalid,
          })
        ).status,
        422,
      );
      const png = await sharp({
        create: { width: 300, height: 200, channels: 3, background: "#3355cc" },
      })
        .png()
        .toBuffer();
      const form = new FormData();
      form.append(
        "photo",
        new Blob([png], { type: "image/png" }),
        "fixture.png",
      );
      const result = await request("/images", {
        method: "POST",
        cookie: seller.cookie,
        body: form,
      });
      assert.equal(result.status, 201);
      photo = result.body;
      assert.equal(
        (await request(`/images/${photo.id}`, { cookie: buyer.cookie })).status,
        404,
      );
      assert.equal(
        (await request(`/images/${photo.id}`, { cookie: seller.cookie }))
          .status,
        200,
      );
    },
  );
  const payload = () => ({
    title: "Adjustable study lamp",
    description: "A perfectly working lamp for late study nights.",
    price: 45000,
    category: "Room essentials",
    condition: "Good",
    location: "Library entrance",
    attributes: { Brand: "Test" },
    imageIds: [photo.id],
  });
  await t.test(
    "create listing, search and protect edits/images across accounts",
    async () => {
      assert.equal(
        (
          await request("/listings", {
            method: "POST",
            cookie: buyer.cookie,
            body: payload(),
          })
        ).status,
        422,
      );
      const result = await request("/listings", {
        method: "POST",
        cookie: seller.cookie,
        body: payload(),
      });
      assert.equal(result.status, 201, JSON.stringify(result.body));
      listing = result.body;
      assert.equal(
        (await request(`/images/${photo.id}`, { cookie: buyer.cookie })).status,
        200,
      );
      assert.equal(
        (
          await request(
            "/listings?q=lamp&category=Room%20essentials&maxPrice=500",
            { cookie: buyer.cookie },
          )
        ).body.total,
        1,
      );
      assert.equal(
        (
          await request("/listings?q=lamp&maxPrice=100", {
            cookie: buyer.cookie,
          })
        ).body.total,
        0,
      );
      assert.equal(
        (
          await request(`/listings/${listing.id}`, {
            method: "PATCH",
            cookie: buyer.cookie,
            body: { ...payload(), version: 1 },
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await request(`/listings/${listing.id}`, {
            method: "PATCH",
            cookie: seller.cookie,
            body: { ...payload(), version: 99 },
          })
        ).status,
        409,
      );
      const bad = { ...payload(), attributes: { Size: "XL" }, version: 1 };
      assert.equal(
        (
          await request(`/listings/${listing.id}`, {
            method: "PATCH",
            cookie: seller.cookie,
            body: bad,
          })
        ).status,
        422,
      );
      db.prepare("UPDATE users SET university=? WHERE id=?").run(
        "Another University",
        stranger.body.user.id,
      );
      assert.equal(
        (await request(`/listings/${listing.id}`, { cookie: stranger.cookie }))
          .status,
        404,
      );
      assert.equal(
        (await request("/listings", { cookie: stranger.cookie })).body.total,
        0,
      );
    },
  );
  await t.test(
    "favorites and conversation creation are idempotent",
    async () => {
      for (let i = 0; i < 2; i++)
        assert.equal(
          (
            await request(`/listings/${listing.id}/favorite`, {
              method: "PUT",
              cookie: buyer.cookie,
              body: { saved: true },
            })
          ).status,
          200,
        );
      assert.equal(
        (await request("/listings?view=saved", { cookie: buyer.cookie })).body
          .total,
        1,
      );
      chat = (
        await request(`/listings/${listing.id}/conversations`, {
          method: "POST",
          cookie: buyer.cookie,
        })
      ).body;
      assert.equal(
        (
          await request(`/listings/${listing.id}/conversations`, {
            method: "POST",
            cookie: buyer.cookie,
          })
        ).body.id,
        chat.id,
      );
      assert.equal(
        (
          await request(`/listings/${listing.id}/conversations`, {
            method: "POST",
            cookie: seller.cookie,
          })
        ).status,
        409,
      );
      assert.equal(
        (
          await request(`/conversations/${chat.id}/messages`, {
            cookie: stranger.cookie,
          })
        ).status,
        404,
      );
    },
  );
  await t.test(
    "message retries do not duplicate; read cursors are participant-scoped",
    async () => {
      const body = {
        body: "Hi, is this still available?",
        clientId: randomUUID(),
      };
      const first = await request(`/conversations/${chat.id}/messages`, {
        method: "POST",
        cookie: buyer.cookie,
        body,
      });
      const retry = await request(`/conversations/${chat.id}/messages`, {
        method: "POST",
        cookie: buyer.cookie,
        body,
      });
      assert.equal(first.body.id, retry.body.id);
      assert.equal(
        (
          await request(`/conversations/${chat.id}/messages`, {
            cookie: seller.cookie,
          })
        ).body.messages.length,
        1,
      );
      assert.equal(
        (await request("/conversations", { cookie: seller.cookie })).body[0]
          .unread,
        1,
      );
      assert.equal(
        (
          await request(`/conversations/${chat.id}/read`, {
            method: "POST",
            cookie: seller.cookie,
            body: { lastId: first.body.id },
          })
        ).status,
        200,
      );
      assert.equal(
        (await request("/conversations", { cookie: seller.cookie })).body[0]
          .unread,
        0,
      );
    },
  );
  await t.test(
    "sold listings leave discovery while chat and saves remain",
    async () => {
      assert.equal(
        (
          await request(`/listings/${listing.id}/status`, {
            method: "PATCH",
            cookie: seller.cookie,
            body: { status: "sold", version: 1 },
          })
        ).status,
        200,
      );
      assert.equal(
        (await request("/listings", { cookie: buyer.cookie })).body.total,
        0,
      );
      assert.equal(
        (await request("/listings?view=saved", { cookie: buyer.cookie })).body
          .items[0].status,
        "sold",
      );
      assert.equal(
        (
          await request(`/conversations/${chat.id}/messages`, {
            method: "POST",
            cookie: seller.cookie,
            body: { body: "It has sold, thanks!", clientId: randomUUID() },
          })
        ).status,
        201,
      );
      assert.equal(
        (
          await request(`/listings/${listing.id}/status`, {
            method: "PATCH",
            cookie: seller.cookie,
            body: { status: "active", version: 2 },
          })
        ).status,
        409,
      );
      const otherDb = openDatabase(database);
      assert.equal(
        otherDb
          .prepare("SELECT status FROM listings WHERE id=?")
          .get(listing.id).status,
        "sold",
      );
      otherDb.close();
    },
  );
  await t.test(
    "block, report and audited moderation work without leaking private access",
    async () => {
      assert.equal(
        (
          await request(`/conversations/${chat.id}/block`, {
            method: "POST",
            cookie: buyer.cookie,
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await request(`/conversations/${chat.id}/messages`, {
            method: "POST",
            cookie: seller.cookie,
            body: { body: "hello", clientId: randomUUID() },
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await request("/reports", {
            method: "POST",
            cookie: buyer.cookie,
            body: {
              listingId: listing.id,
              reason: "Other",
              details: "Test report",
            },
          })
        ).status,
        201,
      );
      assert.equal(
        (await request("/admin/reports", { cookie: buyer.cookie })).status,
        403,
      );
      const reports = await request("/admin/reports", {
        cookie: moderator.cookie,
      });
      assert.equal(reports.status, 200);
      assert.equal(
        (
          await request(`/admin/reports/${reports.body[0].id}/resolve`, {
            method: "POST",
            cookie: moderator.cookie,
            body: { action: "remove_listing", reason: "Test removal" },
          })
        ).status,
        200,
      );
      assert.equal(
        (await request(`/listings/${listing.id}`, { cookie: buyer.cookie }))
          .status,
        404,
      );
      assert.equal(
        db.prepare("SELECT count(*) AS n FROM admin_actions").get().n,
        1,
      );
      assert.equal(
        (
          await request("/auth/logout", {
            method: "POST",
            cookie: buyer.cookie,
          })
        ).status,
        200,
      );
      assert.equal(
        (await request("/listings", { cookie: buyer.cookie })).status,
        401,
      );
    },
  );
});

test("production refuses development auth and missing delivery configuration", () => {
  const db = openDatabase(":memory:");
  assert.throws(
    () => createApp({ db, production: true, devAuth: true, seed: false }),
    /Production requires/,
  );
  db.close();
});
