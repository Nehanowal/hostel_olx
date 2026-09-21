# Unread message emails

Final Price? can email either participant when they receive an unread message. This is an optional feature, separate from Google login. It uses Brevo's HTTPS API from Vercel functions.

## Activate on the existing deployment

1. Create a free account at https://app.brevo.com and verify the account email. Complete Brevo's business/account review if requested. Its free plan currently includes 300 sends/day.
2. In Brevo's sender settings, add the email address you control with the display name **Final Price?**, then complete verification. Confirm that **transactional email** is enabled. A custom authenticated domain is recommended for reliable delivery; for a free email sender, Brevo may substitute a compliant sending address. Do not attempt to authenticate the shared `vercel.app` domain or the university's domain without owning/managing it.
3. Generate a Brevo API key. Add these variables in the existing Vercel project's **Settings → Environment Variables** page, scoped to Production (never in GitHub or frontend environment variables):
   - `BREVO_API_KEY`: the private API key.
   - `MESSAGE_EMAIL_FROM`: the exact verified sender email, without a display name.
   - `MESSAGE_EMAIL_ENABLED`: `true`.
4. Save and redeploy Vercel from the repository root. Existing Google, Turso and Cloudinary variables remain unchanged. The private queue and daily cron are configured in root `vercel.json`; see [VERCEL-BACKEND.md](VERCEL-BACKEND.md).
5. Verify with an agreed test buyer and seller: send a new message, leave it unread for about 30–45 seconds, and check the seller's inbox and Brevo transactional logs. The email contains the buyer's name, listing title, and an **Open conversation** link. It does not quote private message text or expose the buyer's email. Check Spam too.
6. Confirm that opening the conversation before the grace period suppresses the email. In **Your account**, the seller can disable **Email me about new messages**.

To turn delivery off without affecting chat, set `MESSAGE_EMAIL_ENABLED=false` and redeploy Vercel.

## Behavior and reliability

- New buyer messages notify sellers; seller replies notify buyers. Saves do not send emails. Enabling the feature does not backfill old messages.
- Buyer-to-seller alerts keep their 30-second grace period. Seller-to-buyer reply reminders wait three minutes using delayed Vercel queue callbacks. Messages read before processing are skipped. Timing and final inbox delivery depend on Vercel and the email provider.
- Rapid messages in one conversation share one pending alert. Follow-up alerts have a five-minute cooldown per recipient per conversation.
- Message insertion and the outbox insert share one database transaction. Retries of the same chat request do not create extra alerts. Chat does not wait for Brevo.
- Pending jobs persist in Turso. Worker leases prevent concurrent processing, and stable UUID idempotency keys protect provider retries. Transient failures retry up to five times. The retry window is capped at 25 minutes because Brevo documents a 30-minute idempotency window; ambiguous old attempts become failed instead of risking duplicate mail. No system can guarantee both zero loss and zero duplicates across an arbitrary provider outage.
- Read messages, opt-outs, blocked conversations, suspended users, and removed/deleted listings are checked again before sending. A message already in flight may arrive after an opt-out or read action.
- Vercel queue callbacks process durable jobs without an always-running server. If queue publication fails, chat remains saved and the daily cron reconciles pending jobs; notifications may be delayed. Local development retains the interval worker.
- Old unsent jobs are skipped after a day; terminal jobs are retained for 30 days. Successful jobs discard their serialized email payload. Logs record job IDs and coarse error categories, not API keys, email contents or addresses.
- Provider acceptance is not proof of inbox delivery. Brevo's transactional logs show delivery, suppression, quota, and sender-verification failures. Check pending/failed outbox jobs for operational troubleshooting.

Sources: [Brevo Free limits](https://help.brevo.com/hc/en-us/articles/208580669-FAQs-What-are-the-limits-of-the-Free-plan), [sender requirements](https://help.brevo.com/hc/en-us/articles/14925263522578-Comply-with-Gmail-Yahoo-and-Microsoft-s-requirements-for-email-senders), [transactional API](https://developers.brevo.com/reference/send-transac-email), [idempotency window](https://developers.brevo.com/docs/heterogenous-versions-batch-emails).
