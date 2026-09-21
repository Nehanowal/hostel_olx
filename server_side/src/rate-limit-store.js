import { createHash } from "node:crypto";

// All Vercel instances share the same request budget.
export class DatabaseRateLimitStore {
  constructor(db, prefix, now = Date.now) {
    this.db = db;
    this.prefix = prefix;
    this.now = now;
    this.localKeys = false;
  }
  init({ windowMs }) { this.windowMs = windowMs; }
  key(value) { return `${this.prefix}:${createHash("sha256").update(value).digest("hex")}`; }
  async increment(key) {
    const now = this.now();
    const row = await this.db.prepare(`INSERT INTO rate_limit_counters(key,hits,reset_at) VALUES (?,1,?)
      ON CONFLICT(key) DO UPDATE SET
      hits=CASE WHEN reset_at<=? THEN 1 ELSE hits+1 END,
      reset_at=CASE WHEN reset_at<=? THEN excluded.reset_at ELSE reset_at END
      RETURNING hits,reset_at`).get(this.key(key), now + this.windowMs, now, now);
    return { totalHits: row.hits, resetTime: new Date(row.reset_at) };
  }
  async decrement(key) { await this.db.prepare("UPDATE rate_limit_counters SET hits=max(0,hits-1) WHERE key=?").run(this.key(key)); }
  async resetKey(key) { await this.db.prepare("DELETE FROM rate_limit_counters WHERE key=?").run(this.key(key)); }
}
