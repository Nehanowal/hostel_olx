# Rotating product updates

Product-update emails use the existing Brevo mailer and are separate from unread message notifications. Users must explicitly enable **Email me about new campus finds** in Account. Existing users start unsubscribed. Each email links to an unauthenticated unsubscribe confirmation; opening a link alone does not change preferences.

The worker reserves at most 30 recipients per India calendar day, on the first awake worker tick after 09:00 IST. It sends no catch-up batches for missed days. A recipient is eligible only when they:

- opted in and have an active account;
- visited or signed in within the last 30 days;
- have not been contacted or reserved for a batch in the last 72 hours;
- have new, active listings from other sellers in their university since the last successful update (up to 14 days old).

First-time recipients go first, then recipients with the oldest contact attempt. A person is counted once even if they have multiple sessions. With 300 eligible subscribers, the rotation takes 10 days at 30 per day. With 30 or fewer, everyone waits at least 72 hours and also needs new inventory before another update.

Batch reservations and recipient cooldowns are committed atomically in Turso. Multiple workers cannot reserve more than one batch per day. Jobs are durable, use stable Brevo idempotency IDs, lease for 60 seconds and retry transient failures up to 5 attempts within a 25-minute deduplication window. Unsubscribed/suspended users are checked before processing. Already in-flight emails cannot be recalled. A failed attempt still consumes a daily slot and starts a cooldown, to avoid excessive attempts. Terminal job payloads are cleared and jobs are removed after 30 days.

Render Free sleeps when idle: 09:00 is an earliest scheduling time, not an exact daily delivery guarantee. No paid scheduler or background service is added. Product updates share Brevo's daily allowance with chat notifications.
