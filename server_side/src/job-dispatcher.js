import { createHash, timingSafeEqual } from "node:crypto";

const tables = { messages: "message_email_outbox", products: "product_email_jobs" };
export function createJobDispatcher({ db, notifications, productUpdates, publish, now = Date.now }) {
  async function wake(kind) {
    const table = tables[kind];
    if (!Object.hasOwn(tables, kind)) throw new Error("Unknown job type");
    if (!(kind === "messages" ? notifications : productUpdates).enabled) return;
    const job = await db.prepare(`SELECT id,attempts,
      CASE WHEN status='sending' THEN lease_until ELSE due_at END AS due
      FROM ${table} WHERE status IN ('pending','sending') ORDER BY due,id LIMIT 1`).get();
    if (!job) return;
    await publish("marketplace-jobs", { kind }, {
      delaySeconds: Math.min(86300, Math.max(0, Math.ceil((job.due - now()) / 1000))),
      retentionSeconds: 86400,
      idempotencyKey: `${kind}:${job.id}:${job.attempts}:${job.due}`,
    });
  }
  async function processJob({ kind }) {
    if (!Object.hasOwn(tables, kind)) throw new Error("Unknown job type");
    if (kind === "messages") await notifications.drain({ limit: 5 });
    else await productUpdates.drain({ limit: 5 });
    await wake(kind);
  }
  async function daily() {
    await productUpdates.schedule();
    // Reconcile through the same queue used by live messages, including days
    // with no due mail. The consumer checks eligibility and future deadlines.
    await Promise.all(Object.keys(tables).map(async kind => {
      if (!(kind === "messages" ? notifications : productUpdates).enabled) return;
      await publish("marketplace-jobs", { kind }, {
        retentionSeconds: 86400,
        idempotencyKey: `daily:${kind}:${new Date(now()).toISOString().slice(0, 10)}`,
      });
    }));
    await db.prepare("DELETE FROM rate_limit_counters WHERE reset_at<?").run(now());
  }
  return { wake, processJob, daily };
}

export function validCronRequest(req, secret) {
  if (req.method !== "GET" || !secret || secret.length < 32) return false;
  const digest = text => createHash("sha256").update(text).digest();
  return timingSafeEqual(digest(req.headers.authorization || ""), digest(`Bearer ${secret}`));
}
