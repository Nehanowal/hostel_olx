import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app.js";
import { openDatabase } from "../src/db.js";
import {
  createNotificationMailer,
  createMessageNotifications,
} from "../src/message-notifications.js";

async function fixture(t, options = {}) {
  const dir = mkdtempSync(join(tmpdir(), "final-price-email-"));
  const path = join(dir, "test.sqlite");
  const db = await openDatabase(path);
  let clock = Date.now();
  const sent = [];
  const mailer = options.mailer || {
    send: async (payload, id) => sent.push({ payload, id }),
  };
  const users = {};
  for (const name of ["seller", "buyer", "outsider"]) {
    const id = randomUUID(),
      token = randomUUID();
    await db
      .prepare(
        "INSERT INTO users(id,email,name,university,verified_at) VALUES (?,?,?,?,?)",
      )
      .run(
        id,
        `${name}@nst.rishihood.edu.in`,
        name === "buyer" ? "<Buyer>" : name,
        "Rishihood University",
        new Date().toISOString(),
      );
    await db
      .prepare(
        "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES (?,?,?)",
      )
      .run(
        createHash("sha256").update(token).digest("hex"),
        id,
        Date.now() + 86400000,
      );
    users[name] = { id, cookie: `session=${token}` };
  }
  const listing = randomUUID(),
    conversation = randomUUID();
  await db
    .prepare(
      "INSERT INTO listings(id,seller_id,university,title,description,category,price,condition,location) VALUES (?,?,?,?,?,?,?,?,?)",
    )
    .run(
      listing,
      users.seller.id,
      "Rishihood University",
      '<Lamp & "stand">',
      "Campus find",
      "Other",
      10000,
      "Good",
      "Campus",
    );
  await db
    .prepare(
      "INSERT INTO conversations(id,listing_id,buyer_id,seller_id) VALUES (?,?,?,?)",
    )
    .run(conversation, listing, users.buyer.id, users.seller.id);
  const { app, notifications } = await createApp({
    db,
    seed: false,
    devAuth: true,
    googleClientId: "",
    uploads: join(dir, "uploads"),
    notificationMailer: options.disabled ? null : mailer,
    notificationNow: () => clock,
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(async () => {
    notifications.stop();
    await new Promise((resolve) => server.close(resolve));
    db.close();
  });
  async function request(path, { who = "buyer", method = "GET", body } = {}) {
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/api${path}`,
      {
        method,
        headers: {
          Cookie: users[who]?.cookie || "",
          "X-Requested-With": "HostelOLX",
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
      },
    );
    return { status: response.status, body: await response.json() };
  }
  const message = (who = "buyer", clientId = randomUUID()) =>
    request(`/conversations/${conversation}/messages`, {
      who,
      method: "POST",
      body: { body: "Private message content", clientId },
    });
  return {
    db,
    path,
    notifications,
    users,
    listing,
    conversation,
    request,
    message,
    sent,
    mailer,
    advance: (n) => {
      clock += n;
    },
    now: () => clock,
  };
}

test("new buyer messages queue one private seller alert; retries and rapid messages do not duplicate it", async (t) => {
  const f = await fixture(t);
  const clientId = randomUUID();
  const [a, b] = await Promise.all([
    f.message("buyer", clientId),
    f.message("buyer", clientId),
  ]);
  assert.equal(a.status, 201);
  assert.equal(a.body.id, b.body.id);
  await f.message();
  assert.equal(
    (await f.db.prepare("SELECT count(*) AS n FROM message_email_outbox").get())
      .n,
    1,
  );
  await f.notifications.drain();
  assert.equal(f.sent.length, 0);
  f.advance(30_001);
  await Promise.all([f.notifications.drain(), f.notifications.drain()]);
  assert.equal(f.sent.length, 1);
  const { payload } = f.sent[0];
  assert.equal(payload.to[0].email, "seller@nst.rishihood.edu.in");
  assert.match(payload.htmlContent, /&lt;Buyer&gt;/);
  assert.match(payload.htmlContent, /&lt;Lamp &amp; &quot;stand&quot;&gt;/);
  assert.ok(payload.textContent.includes(`/?conversation=${f.conversation}`));
  assert.ok(payload.textContent.includes("/?account=1"));
  assert.ok(!payload.textContent.includes("Private message content"));
  await f.message("buyer", clientId);
  await f.notifications.drain();
  assert.equal(f.sent.length, 1);
  await f.message("seller");
  assert.equal(
    (await f.db.prepare("SELECT count(*) AS n FROM message_email_outbox").get())
      .n,
    1,
  );
});

test("reading messages during the grace period suppresses email; latest unread messages still alert", async (t) => {
  const f = await fixture(t);
  const first = await f.message();
  await f.request(`/conversations/${f.conversation}/read`, {
    who: "seller",
    method: "POST",
    body: { lastId: first.body.id },
  });
  f.advance(30_001);
  await f.notifications.drain();
  assert.equal(f.sent.length, 0);
  const second = await f.message();
  await f.request(`/conversations/${f.conversation}/read`, {
    who: "seller",
    method: "POST",
    body: { lastId: second.body.id },
  });
  await f.message(); // Coalesced into the pending job, but still unread.
  f.advance(30_001);
  await f.notifications.drain();
  assert.equal(f.sent.length, 1);
});

test("seller email preferences are authenticated and cancel pending notifications", async (t) => {
  const f = await fixture(t);
  assert.equal(
    (
      await f.request("/me/preferences", {
        who: "anonymous",
        method: "PATCH",
        body: { emailNotifications: false },
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await f.request("/me/preferences", {
        who: "seller",
        method: "PATCH",
        body: { emailNotifications: "no" },
      })
    ).status,
    422,
  );
  await f.message();
  assert.equal(
    (
      await f.request("/me/preferences", {
        who: "seller",
        method: "PATCH",
        body: { emailNotifications: false },
      })
    ).status,
    200,
  );
  const me = await f.request("/me", { who: "seller" });
  assert.equal(me.body.user.emailNotifications, false);
  assert.equal(me.body.user.emailNotificationsAvailable, true);
  f.advance(30_001);
  await f.notifications.drain();
  assert.equal(f.sent.length, 0);
  await f.message();
  assert.equal(
    (
      await f.db
        .prepare(
          "SELECT count(*) AS n FROM message_email_outbox WHERE status='pending'",
        )
        .get()
    ).n,
    0,
  );
  assert.equal(
    (
      await f.db
        .prepare("SELECT email_notifications FROM users WHERE id=?")
        .get(f.users.buyer.id)
    ).email_notifications,
    1,
  );
});

test("blocked, suspended, removed and unauthorized conversations never send alerts", async (t) => {
  for (const scenario of [
    "blocked",
    "seller suspended",
    "buyer suspended",
    "removed",
  ])
    await t.test(scenario, async (t) => {
      const f = await fixture(t);
      assert.equal((await f.message("outsider")).status, 404);
      await f.message();
      if (scenario === "blocked")
        await f.db
          .prepare("INSERT INTO blocks VALUES (?,?)")
          .run(f.users.seller.id, f.users.buyer.id);
      else if (scenario === "removed")
        await f.db
          .prepare("UPDATE listings SET status='removed' WHERE id=?")
          .run(f.listing);
      else
        await f.db
          .prepare("UPDATE users SET status='suspended' WHERE id=?")
          .run(f.users[scenario.split(" ")[0]].id);
      f.advance(30_001);
      await f.notifications.drain();
      assert.equal(f.sent.length, 0);
    });
});

test("cooldown groups follow-up messages without losing a later unread notification", async (t) => {
  const f = await fixture(t);
  await f.message();
  f.advance(30_001);
  await f.notifications.drain();
  await f.message();
  await f.message();
  f.advance(30_001);
  await f.notifications.drain();
  assert.equal(f.sent.length, 1);
  f.advance(300_001);
  await f.notifications.drain();
  assert.equal(f.sent.length, 2);
});

test("an outbox survives restarts and provider failures; retries retain the same idempotency key", async (t) => {
  const attempts = [];
  const f = await fixture(t, {
    mailer: {
      send: async (payload, id) => {
        attempts.push({ payload, id });
        if (attempts.length === 1) throw new Error("Temporary failure");
      },
    },
  });
  const saved = await f.message();
  assert.equal(saved.status, 201);
  f.advance(30_001);
  await f.notifications.drain();
  assert.equal(
    (await f.db.prepare("SELECT status FROM message_email_outbox").get())
      .status,
    "pending",
  );
  const reopened = await openDatabase(f.path);
  const restarted = createMessageNotifications({
    db: reopened,
    mailer: f.mailer,
    origin: "http://localhost:5173",
    now: f.now,
  });
  f.advance(60_001);
  await restarted.drain();
  assert.equal(attempts.length, 2);
  assert.deepEqual(attempts[0], attempts[1]);
  assert.equal(
    (
      await reopened
        .prepare("SELECT status,payload FROM message_email_outbox")
        .get()
    ).status,
    "sent",
  );
  assert.equal(
    (await reopened.prepare("SELECT payload FROM message_email_outbox").get())
      .payload,
    null,
  );
  reopened.close();
});

test("stale leases recover, but ambiguous attempts outside the provider deduplication window do not resend", async (t) => {
  const f = await fixture(t);
  await f.message();
  await f.db
    .prepare(
      "UPDATE message_email_outbox SET status='sending',lease_until=?,first_attempt_at=?",
    )
    .run(f.now() + 60_000, f.now());
  f.advance(60_001);
  await f.notifications.drain();
  assert.equal(f.sent.length, 1);
  await f.message();
  await f.db
    .prepare(
      "UPDATE message_email_outbox SET first_attempt_at=? WHERE status='pending'",
    )
    .run(f.now());
  f.advance(26 * 60_000);
  await f.notifications.drain();
  assert.equal(f.sent.length, 1);
  assert.equal(
    (
      await f.db
        .prepare(
          "SELECT count(*) AS n FROM message_email_outbox WHERE status='failed'",
        )
        .get()
    ).n,
    1,
  );
});

test("email configuration is optional and missing credentials cannot silently enable sending", async (t) => {
  assert.equal(createNotificationMailer({ env: {} }), null);
  assert.throws(
    () => createNotificationMailer({ env: { MESSAGE_EMAIL_ENABLED: "true" } }),
    /requires/,
  );
  const f = await fixture(t, { disabled: true });
  await f.message();
  assert.equal(
    (await f.db.prepare("SELECT count(*) AS n FROM message_email_outbox").get())
      .n,
    0,
  );
  assert.equal(
    (await f.request("/me", { who: "seller" })).body.user
      .emailNotificationsAvailable,
    false,
  );
});

test("Brevo uses HTTPS, a bounded request, verified sender and stable UUID deduplication", async () => {
  let captured;
  const env = {
    MESSAGE_EMAIL_ENABLED: "true",
    BREVO_API_KEY: "fixture-secret",
    MESSAGE_EMAIL_FROM: "sender@example.com",
  };
  const mailer = createNotificationMailer({
    env,
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return new Response('{"messageId":"fixture"}', { status: 201 });
    },
  });
  const id = randomUUID();
  await mailer.send(
    {
      to: [{ email: "seller@example.edu" }],
      subject: "New message",
      textContent: "Open your chat",
    },
    id,
  );
  assert.equal(captured.url, "https://api.brevo.com/v3/smtp/email");
  assert.equal(captured.options.headers["api-key"], "fixture-secret");
  assert.ok(captured.options.signal instanceof AbortSignal);
  const body = JSON.parse(captured.options.body);
  assert.equal(body.headers.idempotencyKey, id);
  assert.equal(body.sender.email, env.MESSAGE_EMAIL_FROM);
  for (const [status, response, retryable] of [
    [429, {}, true],
    [503, {}, true],
    [401, {}, false],
  ]) {
    const failing = createNotificationMailer({
      env,
      fetchImpl: async () => new Response(JSON.stringify(response), { status }),
    });
    await assert.rejects(
      failing.send({}, id),
      (error) => error.retryable === retryable,
    );
  }
  const duplicate = createNotificationMailer({
    env,
    fetchImpl: async () =>
      new Response('{"code":"duplicate_parameter"}', { status: 400 }),
  });
  await duplicate.send({}, id);
});

test("two workers cannot claim the same email while its delivery is in flight", async t => {
  let finish;
  const gate = new Promise(resolve => { finish = resolve; });
  let sends = 0;
  const f = await fixture(t, { mailer: { send: async () => { sends++; await gate; } } });
  await f.message(); f.advance(30_001);
  const secondDb = await openDatabase(f.path);
  const secondWorker = createMessageNotifications({ db: secondDb, mailer: f.mailer, origin: "http://localhost:5173", now: f.now });
  const first = f.notifications.drain();
  // Wait for the first worker's durable claim, not for a wall-clock timeout.
  while (!sends) await new Promise(resolve => setImmediate(resolve));
  await secondWorker.drain();
  assert.equal(sends, 1);
  finish(); await first;
  secondDb.close();
});
