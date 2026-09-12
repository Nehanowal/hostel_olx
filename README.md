# Hostel OLX

A working, local-first student marketplace for **Rishihood University**, restricted to **@nst.rishihood.edu.in**. Built on the repository's React + Vite frontend and Express backend. All runtime libraries are free; local development needs no paid account, hosted database, API key, or credit card.

## Run it

Requires Node.js **22.13+** (Node 24 LTS recommended) and npm.

```sh
npm run setup
npm run dev
```

Open **http://127.0.0.1:5173**. API runs at **http://127.0.0.1:3001**. Keep the terminal running. Stop both with Ctrl+C. Frontend changes refresh automatically; restart after backend changes.

For a compiled frontend served by Express:

```sh
npm run build
npm start
```

Then open **http://127.0.0.1:3001**. This is still a local preview unless production environment settings are supplied.

## Try the complete journey

1. Enter any local test name and an address ending in `@nst.rishihood.edu.in`.
2. In **local test mode**, use the clearly labelled on-screen code. No email is sent, and this is not proof of email ownership.
3. Browse the six labelled sample listings, search, filter, sort, save, and inspect details. Sample sellers cannot receive messages.
4. Click **Sell an item**. Add category details, a real photo, price, description, and campus pickup spot; preview and publish.
5. Open a separate browser profile/private window and sign in with a second test address. Find the real listing, start a chat, and send a message.
6. Return to the seller's window, open **Messages**, respond, and mark the item sold from **My listings**.
7. The item disappears from discovery, but saved references and conversation history remain.

## Implemented

- Exact university-domain validation; hashed single-use OTPs, expiry, attempt limits, resend cooldown, rate limiting, revocable HttpOnly cookie sessions.
- Six categories, optional category-specific fields, INR prices including free items.
- Browse, title/description search, category and condition filters, maximum price, price sorting and pagination.
- Create, preview, edit, mark unavailable, reactivate, mark sold, soft-delete listings; owner checks and optimistic version conflicts.
- Upload up to six photos, reorder/select cover, remove unused photos; decode and resize to WebP with metadata stripped. Images are files, not database blobs.
- Favorites persisted to the database.
- Listing-specific, one-to-one text chat with automatic polling, read state, older-message pagination and idempotent message retries.
- Block users; report listings or conversations; restricted admin report queue with remove/suspend/dismiss actions and audit records.
- Responsive UI, form validation, loading/empty/error states, keyboard focus and modal focus containment.

## Actual MVP stack and changes from the blueprint

| Area           | Implemented                                                           |
| -------------- | --------------------------------------------------------------------- |
| Frontend       | React 19, Vite, CSS, Lucide icons                                     |
| Backend        | Express 5, Node.js                                                    |
| Database       | SQLite through Node's built-in `node:sqlite`                          |
| Validation     | Zod                                                                   |
| Authentication | Email OTP + opaque server sessions; Nodemailer SMTP adapter           |
| Photos         | Multer + Sharp; protected local files                                 |
| Chat           | Durable REST API with 3-second active-thread / 5-second inbox polling |
| Tests          | Node test runner, real HTTP requests and isolated SQLite database     |

The earlier Next.js/PostgreSQL/Supabase plan is a future hosted option, not the implementation in this repository. Reusing the existing starter and SQLite makes this version runnable for ₹0 without service credentials. No Socket.IO, paid search, cloud storage account, payment processing or AI dependency is required.

## Data and configuration

Copy `server_side/.env.example` to `server_side/.env` only if changing defaults. Never commit `.env` or credentials.

- Database: `server_side/data/marketplace.sqlite` (plus SQLite WAL files while running).
- Photos: `server_side/uploads/`.
- Both are ignored by Git and persist across application restarts. Back up both together while the server is stopped, or use SQLite's backup API for online backups.
- Sample inventory is seeded only into an empty listing database in development. `SEED_DEMO=false` prevents future seeding; it does not delete existing records. Production discovery excludes sample inventory.
- There is no default administrator. Set `ADMIN_EMAILS` to one or more approved institutional addresses, restart, and sign in with that account to see **Reports**. No role can be granted from the browser.
- `DATABASE_PATH` can select an isolated database for testing or deployment. Relative paths resolve from the backend working directory; absolute paths are recommended.

## Real email and a public student launch

The delivered app is a working **local MVP**, not an already hosted public service. Set up these items before inviting real students:

1. Configure an SMTP account using `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, and `SMTP_FROM`. An existing free email account with supported SMTP/app-password access may be sufficient for a small pilot; its limits and university delivery must be verified. Do not paste credentials into Git or chat.
2. Set `DEV_AUTH=false`. New sessions require a code delivered to the institutional inbox; existing local-test sessions are rejected.
3. For internet deployment, set `NODE_ENV=production`, `APP_ORIGIN` to the exact HTTPS origin, and `HOST` to the appropriate listening interface. Production refuses to start with test auth or missing SMTP/HTTPS configuration.
4. Use a fresh production database and upload directory. Select hosting with a **persistent disk** and a verified ₹0 plan, or a university-provided server. Ephemeral/serverless file systems will lose SQLite data and photos. No provider account has been created or paid deployment provisioned.
5. Assign a moderation owner, review campus rules/privacy/retention, and add admin MFA before wider rollout. The current admin gate is a server-side email allowlist with university OTP, not MFA.

Free software does not imply unlimited free hosting, email, disk space, or traffic. This release guarantees no subscription dependency for running locally; a public hosting arrangement remains to be selected.

## Tests

```sh
npm test
npm run build
```

Integration coverage includes anonymous/wrong-domain access, CSRF origin rejection, upload decoding and ownership, category attribute validation, cross-user edits, cross-university isolation, search, favorites, unique conversations, message retry/read state, sold-item behavior, durable storage, blocking, reports, admin actions, session revocation, and unsafe production configuration.

## Deliberately deferred

Password login, Google/Microsoft SSO, annual re-verification, campus administration, multiple institutions in the UI, durable drafts, dedicated full-text search, realtime WebSockets, push/email message notifications, chat attachments, reviews, payments, background image cleanup, account deletion/export, appeals and advanced moderator evidence tools.

This is a single-process campus pilot. SQLite, in-memory rate limits and polling are suitable for local validation; use shared rate-limit storage, managed persistence/object storage and realtime delivery before horizontally scaling.

## Photo credits

Sample inventory uses freely usable Unsplash photographs under https://unsplash.com/license. These are illustrative sample listings, not real seller offers. Attribution:

- Headphones: YearOne — https://unsplash.com/photos/black-headphones-on-white-table-OjZ9J7Ltreg
- Lamp: Annie Spratt — https://unsplash.com/photos/black-and-silver-study-lamp-PYmjZ7iS8W4
- Books: Claudia Wolff — https://unsplash.com/photos/pile-of-assorted-color-books-MiJTU6lqksg
- Backpack: Wiser by the Mile — https://unsplash.com/photos/brown-leather-backpack-on-white-wall-OFHkPCkhYEY
- Sneakers: Zachary Keimig — https://unsplash.com/photos/pair-of-gray-sneakers-o_U0kPh7uu0
- Chair: Agata Create — https://unsplash.com/photos/white-armless-chair-BsQxAIl2LdA

Your uploaded listing photos are served from the backend and do not depend on Unsplash.
