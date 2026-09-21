import assert from "node:assert/strict";
import test from "node:test";
import { loadMarketplace } from "../src/startup.js";
import { api } from "../src/api.js";

const options = { maxWaitMs: 1000, requestTimeoutMs: 200, retryDelayMs: 1 };
const payload = (url) => url === "/api/config" ? { university: "Campus" } : { user: { id: "student" } };
const success = (url) => Response.json(payload(url));
const hungRequest = (_url, { signal }) => new Promise((_resolve, reject) => {
  signal.addEventListener("abort", () => reject(signal.reason), { once: true });
});

test("startup recovers from a proxy error, HTML wake-up page, and network failure", async (t) => {
  for (const failure of [
    () => new Response("Bad gateway", { status: 502 }),
    () => new Response("<html>Waking up</html>"),
    () => { throw new TypeError("Failed to fetch"); },
  ]) {
    let calls = 0, retries = 0;
    const fetch = t.mock.method(globalThis, "fetch", async (url) => ++calls === 1 ? failure() : success(url));
    const result = await loadMarketplace({ ...options, onRetry: () => retries++ });
    assert.deepEqual(result, [payload("/api/config"), payload("/api/me")]);
    assert.equal(retries, 1);
    assert.equal(calls, 4);
    fetch.mock.restore();
  }
});

test("an unresponsive request times out and can recover", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", (url, init) => ++calls <= 2 ? hungRequest(url, init) : Promise.resolve(success(url)));
  const result = await loadMarketplace({ ...options, requestTimeoutMs: 10 });
  assert.equal(result[1].user.id, "student");
  assert.equal(calls, 4);
});

test("persistent failure stops at the overall deadline, including hung requests", async (t) => {
  t.mock.method(globalThis, "fetch", hungRequest);
  await assert.rejects(loadMarketplace({ ...options, maxWaitMs: 30 }), /Check your internet connection/);
});

test("permanent access errors do not retry", async (t) => {
  let retries = 0;
  t.mock.method(globalThis, "fetch", async () => Response.json({ error: "Access denied." }, { status: 403 }));
  await assert.rejects(loadMarketplace({ ...options, onRetry: () => retries++ }), /Access denied/);
  assert.equal(retries, 0);
});

test("leaving during startup cancels both requests", async (t) => {
  const controller = new AbortController();
  const signals = [];
  t.mock.method(globalThis, "fetch", (url, init) => {
    signals.push(init.signal);
    return hungRequest(url, init);
  });
  const pending = loadMarketplace({ ...options, signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(signals.length, 2);
  assert.ok(signals.every(signal => signal.aborted));
});

test("leaving between attempts cancels the scheduled retry", async (t) => {
  const controller = new AbortController();
  const fetch = t.mock.method(globalThis, "fetch", async () => new Response("Unavailable", { status: 503 }));
  await assert.rejects(loadMarketplace({
    ...options, signal: controller.signal, onRetry: () => controller.abort(),
  }), { name: "AbortError" });
  assert.equal(fetch.mock.callCount(), 2);
});

test("normal API calls never resend a failed message", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => new Response("Unavailable", { status: 503 }));
  await assert.rejects(api("/conversations/example/messages", { method: "POST", body: { body: "Hello" } }));
  assert.equal(fetch.mock.callCount(), 1);
});
