# Final Price? on Vercel

The repository root now builds the React site and three Node.js functions in one Vercel project. The website keeps `https://hostel-olx.vercel.app`; `/api/*` reaches the Express application directly. Render's idle spin-down is no longer part of this route. Vercel can still have brief function cold starts and free-plan usage limits.

## Project settings

- Project: `hostel-olx`, existing Hobby plan; Node.js 24.
- Root directory: repository root (clear `client_side`).
- Root `vercel.json` supplies install/build/output settings, Mumbai region, security headers, functions, routes, and daily cron.
- Production secrets: existing Turso and Cloudinary credentials, `GOOGLE_CLIENT_ID`, `APP_ORIGIN`, university domains, `ADMIN_EMAILS`, Brevo configuration, and a new random `CRON_SECRET` (at least 32 characters).
- Production only: `NODE_ENV=production`, `DEV_AUTH=false`, `SEED_DEMO=false`. Production credentials are not copied into preview/development environments.
- The old `BACKEND_ORIGIN` and `API_PROXY_SECRET` variables are no longer used by the root deployment. `client_side/vercel.ts` is retained only for rollback to the previous frontend-only configuration.

Turso remains the database and Cloudinary remains authenticated photo storage. Existing users, listings, photos, sessions and read/unread cursors stay in place. Missing cloud credentials fail closed. Vercel's platform IP header supplies client identity for shared, database-backed request limits; normal authentication and origin checks still apply.

## Scheduled email

`@vercel/queue` publishes private `marketplace-jobs` callbacks in Mumbai. Queue messages contain only the job kind, not emails or chat content. Pending jobs remain in Turso with existing eligibility, read-status, opt-out, cooldown, lease, and Brevo idempotency checks. Queue callbacks process five jobs per invocation and schedule the next pending deadline, including delivery retries.

After a message transaction commits, `waitUntil` publishes a delayed queue wake-up: 30 seconds for buyer messages, three minutes for seller replies. A daily authenticated cron at `0 4 * * *` (09:30 IST, with Hobby's possible delay within the hour) schedules the existing maximum-30-recipient product batch and reconciles pending outboxes. Existing three-day spacing and explicit product-update consent remain required. If queue publication is temporarily unavailable, the durable outbox is retained for reconciliation; delivery can be delayed.

No always-running timer or process is required on Vercel. Local/Render `server_side/src/server.js` still supports the previous interval workers for development and rollback.

## Photos and deployment verification

Photos up to the existing 8 MB picker limit remain accepted. Files over 3.5 MB are resized in the browser before upload so multipart requests fit Vercel's 4.5 MB limit. The backend still validates, strips metadata, normalizes and stores photos through Cloudinary.

Run `npm test --prefix server_side`, `npm test --prefix client_side`, `npm run lint --prefix client_side`, and `npm run build --prefix client_side`. Before promoting a staged production deployment, check health/config, anonymous access denial, public listings, existing student session/owner dashboard, photo delivery, protected cron and queue callbacks. Test uploads with an authorized disposable fixture; never publish a test listing to real students.

References: [Vercel function limits](https://vercel.com/docs/functions/limitations), [Queue setup](https://vercel.com/docs/queues/quickstart), [Hobby cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing).
