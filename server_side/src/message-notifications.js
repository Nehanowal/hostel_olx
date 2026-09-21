import { randomUUID } from "node:crypto";
import { z } from "zod";

const GRACE_MS = 30_000;
const REPLY_GRACE_MS = 3 * 60_000;
const COOLDOWN_MS = 5 * 60_000;
const LEASE_MS = 60_000;
const RETRY_WINDOW_MS = 25 * 60_000;
const escapeHtml = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );

export function createNotificationMailer({
  env = process.env,
  fetchImpl = fetch,
} = {}) {
  if (env.MESSAGE_EMAIL_ENABLED !== "true") return null;
  const apiKey = env.BREVO_API_KEY;
  const from = z.email().safeParse(env.MESSAGE_EMAIL_FROM);
  if (!apiKey || !from.success)
    throw new Error(
      "Message email requires BREVO_API_KEY and a verified MESSAGE_EMAIL_FROM address.",
    );
  return {
    async send(payload, id) {
      const response = await fetchImpl("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        signal: AbortSignal.timeout(15_000),
        headers: {
          "api-key": apiKey,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          ...payload,
          sender: { name: "Final Price?", email: from.data },
          headers: { idempotencyKey: id },
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (
        response.ok ||
        (response.status === 400 && result.code === "duplicate_parameter")
      )
        return;
      const error = new Error(
        `Email provider returned HTTP ${response.status}`,
      );
      error.retryable = response.status === 429 || response.status >= 500;
      throw error;
    },
  };
}

function emailPayload(row, origin) {
  const conversationUrl = `${origin}/?conversation=${encodeURIComponent(row.conversation_id)}`;
  const settingsUrl = `${origin}/?account=1`;
  const subject = "You have an unread message on Final Price?";
  const sentence = `${row.sender_name} sent you a message about “${row.title}”.`;
  return {
    to: [{ email: row.email, name: row.recipient_name }],
    subject,
    textContent: `Hi ${row.recipient_name},\n\n${sentence}\n\nOpen your conversation: ${conversationUrl}\n\nReply on Final Price? to keep the conversation together.\nManage email notifications: ${settingsUrl}`,
    htmlContent: `<!doctype html><html><body style="margin:0;background:#f3f5f9;font-family:Arial,sans-serif;color:#18203d"><main style="max-width:520px;margin:32px auto;padding:32px;background:white;border-radius:16px"><h1 style="font-size:24px">Final Price<span style="color:#284df3">?</span></h1><p>Hi ${escapeHtml(row.recipient_name)},</p><p>${escapeHtml(sentence)}</p><p style="margin:28px 0"><a href="${escapeHtml(conversationUrl)}" style="display:inline-block;background:#284df3;color:white;padding:14px 20px;border-radius:8px;text-decoration:none">Open conversation</a></p><p style="font-size:13px;color:#606878">Reply on Final Price? to keep the conversation together.</p><a href="${escapeHtml(settingsUrl)}" style="font-size:12px;color:#606878">Manage email notifications</a></main></body></html>`,
  };
}

// The outbox is committed with the message, so a Render restart cannot lose it.
export function createMessageNotifications({
  db,
  mailer,
  origin,
  now = Date.now,
  logger = console,
}) {
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  const get = (sql, ...args) => db.prepare(sql).get(...args);
  let running = false;
  let timer;
  async function enqueue(conversation, message) {
    if (!mailer || ![conversation.buyer_id, conversation.seller_id].includes(message.sender_id)) return;
    const recipient = message.sender_id === conversation.seller_id ? conversation.buyer_id : conversation.seller_id;
    const grace = recipient === conversation.buyer_id ? REPLY_GRACE_MS : GRACE_MS;
    // A fresh reply gets a full grace period when the prior queued message was read.
    await run(
      `UPDATE message_email_outbox SET status='skipped' WHERE conversation_id=? AND recipient_id=? AND status='pending' AND attempts=0 AND message_id<=coalesce((SELECT last_id FROM conversation_reads WHERE conversation_id=? AND user_id=?),0)`,
      conversation.id, recipient, conversation.id, recipient,
    );
    await run(
      `INSERT OR IGNORE INTO message_email_outbox(id,conversation_id,recipient_id,message_id,created_at,due_at)
      SELECT ?,?,?,?, ?,? WHERE EXISTS(SELECT 1 FROM users WHERE id=? AND email_notifications=1 AND status='active')`,
      randomUUID(),
      conversation.id,
      recipient,
      message.id,
      now(),
      now() + grace,
      recipient,
    );
  }
  async function claim() {
    return db.transaction(async () => {
      const time = now();
      await run(
        "UPDATE message_email_outbox SET status='pending' WHERE status='sending' AND lease_until<=?",
        time,
      );
      const job = await get(
        "SELECT * FROM message_email_outbox WHERE status='pending' AND due_at<=? ORDER BY due_at,id LIMIT 1",
        time,
      );
      if (!job) return null;
      const row = await get(
        `SELECT c.id AS conversation_id,l.title,l.status AS listing_status,
        r.email,r.name AS recipient_name,r.email_notifications,
        s.status AS seller_status,b.status AS buyer_status,
        CASE WHEN r.id=c.seller_id THEN b.name ELSE s.name END AS sender_name,
        EXISTS(SELECT 1 FROM blocks WHERE (blocker_id=c.buyer_id AND blocked_id=c.seller_id) OR (blocker_id=c.seller_id AND blocked_id=c.buyer_id)) AS blocked,
        (SELECT max(id) FROM messages WHERE conversation_id=c.id AND sender_id<>r.id) AS latest_message,
        coalesce((SELECT last_id FROM conversation_reads WHERE conversation_id=c.id AND user_id=r.id),0) AS last_read
        FROM conversations c JOIN listings l ON l.id=c.listing_id JOIN users s ON s.id=c.seller_id JOIN users b ON b.id=c.buyer_id JOIN users r ON r.id IN (c.buyer_id,c.seller_id)
        WHERE c.id=? AND r.id=?`,
        job.conversation_id,
        job.recipient_id,
      );
      if (
        !row ||
        !row.email_notifications ||
        row.blocked ||
        row.seller_status !== "active" ||
        row.buyer_status !== "active" ||
        ["removed", "deleted"].includes(row.listing_status) ||
        row.last_read >= row.latest_message ||
        time - job.created_at > 86400000
      ) {
        await run(
          "UPDATE message_email_outbox SET status='skipped' WHERE id=?",
          job.id,
        );
        return { skipped: true };
      }
      // Brevo retains idempotency keys for 30 minutes. Do not blindly resend an
      // ambiguous attempt after that window (for example after a long outage).
      if (
        job.first_attempt_at !== null &&
        time - job.first_attempt_at >= RETRY_WINDOW_MS
      ) {
        await run(
          "UPDATE message_email_outbox SET status='failed',last_error='retry_window_expired' WHERE id=?",
          job.id,
        );
        return { skipped: true };
      }
      const last = await get(
        "SELECT max(sent_at) AS at FROM message_email_outbox WHERE conversation_id=? AND recipient_id=? AND status='sent'",
        job.conversation_id,
        job.recipient_id,
      );
      if (last.at !== null && time < last.at + COOLDOWN_MS) {
        await run(
          "UPDATE message_email_outbox SET due_at=? WHERE id=?",
          last.at + COOLDOWN_MS,
          job.id,
        );
        return { skipped: true };
      }
      const payload = job.payload || JSON.stringify(emailPayload(row, origin));
      const lease = randomUUID();
      await run(
        "UPDATE message_email_outbox SET status='sending',lease_until=?,lease_token=?,attempts=attempts+1,first_attempt_at=coalesce(first_attempt_at,?),payload=? WHERE id=?",
        time + LEASE_MS,
        lease,
        time,
        payload,
        job.id,
      );
      return {
        ...job,
        payload: JSON.parse(payload),
        lease,
        attempts: job.attempts + 1,
      };
    });
  }
  async function drain({ limit = 10 } = {}) {
    if (!mailer || running) return;
    running = true;
    try {
      for (let i = 0; i < limit; i++) {
        const job = await claim();
        if (!job) break;
        if (job.skipped) continue;
        try {
          await mailer.send(job.payload, job.id);
          await run(
            "UPDATE message_email_outbox SET status='sent',sent_at=?,payload=NULL,last_error=NULL WHERE id=? AND lease_token=? AND status='sending'",
            now(),
            job.id,
            job.lease,
          );
        } catch (error) {
          const retry = error.retryable !== false && job.attempts < 5;
          await run(
            "UPDATE message_email_outbox SET status=?,due_at=?,last_error=? WHERE id=? AND lease_token=? AND status='sending'",
            retry ? "pending" : "failed",
            now() + 60_000 * 2 ** (job.attempts - 1),
            retry ? "provider_retry" : "provider_rejected",
            job.id,
            job.lease,
          );
          logger.warn("Message email delivery deferred", {
            jobId: job.id,
            retry,
          });
        }
      }
      // Retain enough history for cooldown and support, without an endless log.
      await run(
        "DELETE FROM message_email_outbox WHERE status IN ('sent','skipped','failed') AND created_at<?",
        now() - 30 * 86400000,
      );
    } finally {
      running = false;
    }
  }
  function start() {
    if (!mailer || timer) return;
    const tick = () =>
      drain().catch(() =>
        logger.warn("Message email worker could not access the outbox"),
      );
    timer = setInterval(tick, 15_000);
    timer.unref();
    tick();
  }
  function stop() {
    clearInterval(timer);
    timer = undefined;
  }
  return { enabled: !!mailer, enqueue, drain, start, stop };
}
