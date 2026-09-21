import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { openDatabase } from "../src/db.js";
import { DatabaseRateLimitStore } from "../src/rate-limit-store.js";
import { createImageStorage } from "../src/image-storage.js";
import { configureProxy, rateLimitKey } from "../src/proxy.js";
import { createJobDispatcher, validCronRequest } from "../src/job-dispatcher.js";

test("daily reconciliation dispatches enabled workers and disabled mail never loops", async t => {
  const db = await openDatabase(":memory:"); t.after(()=>db.close());
  const published = [];
  let scheduled = 0;
  const notifications = {enabled: true, drain: async()=>{}};
  const productUpdates = {enabled: false, schedule:async()=>{scheduled++;}};
  const jobs = createJobDispatcher({db,notifications,productUpdates,now:()=>1000,
    publish:async (...args)=>published.push(args)});
  await jobs.daily();
  assert.equal(scheduled,1);
  assert.deepEqual(published.map(p=>p[1]),[{kind:"messages"}]);
  await jobs.processJob({kind:"messages"});
  assert.equal(published.length,1); // Empty outbox ends the queue chain.
  notifications.enabled=false;
  await jobs.wake("messages");
  await jobs.daily();
  assert.equal(published.length,1);
});

test("Vercel requires durable storage and the scheduled endpoint requires its secret", async () => {
  await assert.rejects(openDatabase(undefined, {VERCEL:"1"}), /require TURSO/);
  assert.throws(()=>createImageStorage({uploads:"/unused",env:{VERCEL:"1"}}), /Cloudinary is required/);
  const secret = "a".repeat(64);
  assert.equal(validCronRequest({method:"GET",headers:{}}, secret), false);
  assert.equal(validCronRequest({method:"GET",headers:{authorization:"Bearer wrong"}}, secret), false);
  assert.equal(validCronRequest({method:"POST",headers:{authorization:`Bearer ${secret}`}}, secret), false);
  assert.equal(validCronRequest({method:"GET",headers:{authorization:`Bearer ${secret}`}}, secret), true);
});

test("multiple instances share atomic limits and expired windows reset", async t => {
  const db = await openDatabase(":memory:"); t.after(()=>db.close());
  let now = 1000;
  const a = new DatabaseRateLimitStore(db,"api",()=>now), b = new DatabaseRateLimitStore(db,"api",()=>now);
  a.init({windowMs:60000}); b.init({windowMs:60000});
  const hits = await Promise.all(Array.from({length:10},(_,i)=>(i%2?a:b).increment("192.0.2.1")));
  assert.deepEqual(hits.map(h=>h.totalHits).sort((a,b)=>a-b), [1,2,3,4,5,6,7,8,9,10]);
  assert.equal((await a.increment("192.0.2.2")).totalHits, 1);
  assert.ok(!(await db.prepare("SELECT key FROM rate_limit_counters").get()).key.includes("192.0.2"));
  now+=60000;
  assert.equal((await b.increment("192.0.2.1")).totalHits, 1);
});

test("reopening a migrated database preserves existing accounts and sessions", async t => {
  const file = join(mkdtempSync(join(tmpdir(),"vercel-migrations-")),"test.db");
  let db = await openDatabase(file);
  await db.prepare("INSERT INTO users(id,email,name,university,verified_at) VALUES ('student','s@example.test','Student','Campus','2026-09-21')").run();
  await db.prepare("INSERT INTO sessions VALUES ('token','student',9999999999999,'google')").run();
  db.close(); db = await openDatabase(file); t.after(()=>db.close());
  assert.equal((await db.prepare("SELECT count(*) n FROM users").get()).n,1);
  assert.equal((await db.prepare("SELECT user_id FROM sessions").get()).user_id,"student");
  assert.ok((await db.prepare("SELECT value FROM platform_metadata WHERE key='schema_version'").get()).value);
});

test("Vercel reads the platform IP and rejects arbitrary forwarded addresses", async t => {
  const app = express(); configureProxy(app,{VERCEL:"1",API_PROXY_SECRET:"legacy"});
  app.get("/api/ip",(req,res)=>res.json({key:rateLimitKey(req)}));
  const server=app.listen(0,"127.0.0.1");
  await new Promise(resolve=>server.once("listening",resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const url=`http://127.0.0.1:${server.address().port}/api/ip`;
  assert.equal((await fetch(url,{headers:{"x-forwarded-for":"192.0.2.1"}})).status,400);
  const result=await fetch(url,{headers:{"x-vercel-forwarded-for":"192.0.2.2","x-forwarded-for":"192.0.2.1"}});
  assert.equal((await result.json()).key,"192.0.2.2");
});
