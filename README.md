# Final Price?

A working, local-first student marketplace for **Rishihood University**, accepting **@nst.rishihood.edu.in**, **@csds.rishihood.edu.in**, **@psy.rishihood.edu.in**, **@makers.rishihood.edu.in**, and **@rishihood.edu.in**. All five domains share one university marketplace. Built on the repository's React + Vite frontend and Express backend. All runtime libraries are free; local development needs no paid account, hosted database, API key, or credit card.

## Latest improvements

- Scroll reveals, card hover effects, button feedback, animated dialog opening/closing, image lightbox with zoom and keyboard controls, and reduced-motion support.
- **Final Price?** branding, a light cool-grey canvas, blue “Big finds. Small prices.” hero, and self-hosted DM Sans / Space Grotesk fonts.
- **Popular on campus** rotates one available student listing at a time inside the hero. It ranks up to 12 items by deliberate detail opens, with newest-first ties. Rotation pauses on hover, keyboard focus, open dialogs and hidden tabs; reduced-motion users get manual navigation. No popularity counts appear in the interface.
- Opens count once per student/listing/UTC day. Owner opens, sample listings, unavailable items, other universities and suspended sellers are excluded. Existing impression history is retained separately; it does not drive the new popularity ranking. New click counts begin at zero after deployment.
- **Recommended** sorting keeps new uploads from the last 48 hours first, then older listings by opens. **Popular on campus**, **Newest first**, and price sorting remain available. The default listing grid has no visible section title.
- Visibility explanations and direct reactivation in **My listings**, confirmation before hiding an item, filter reset on publishing/account changes, and refresh on returning to the page.
- Official Google Identity Services button and server verification, Google-only mode, exact email and hosted-domain checks, one-use nonces, and preservation of existing account inventory.

**[Exact Google setup, database status, and launch steps](docs/GOOGLE-AND-DATABASE-SETUP.md).** Google is configured in the local private `.env`, and a real university sign-in has been verified in Chrome at http://localhost:3002. Other environments need their own client configuration.

This project was restored from the earlier MVP into `/Users/nehasharma/hostel_olx`, together with a consistent database snapshot and photos. The old output folder is a separate copy; use this folder going forward.

## Run it

Requires Node.js **24 LTS** and npm (see `.nvmrc`).

```sh
npm run setup
npm run dev
```

Open **http://localhost:5173** (use localhost for Google). API runs at **http://127.0.0.1:3001**. Keep the terminal running. Stop both with Ctrl+C. Frontend changes refresh automatically; restart after backend changes.

For a compiled frontend served by Express:

```sh
npm run build
npm start
```

Then open **http://127.0.0.1:3001**. This is still a local preview unless production environment settings are supplied.

## Try the complete journey

1. Enter any local test name and an address ending in `@nst.rishihood.edu.in` or `@rishihood.edu.in`.
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
| Database       | SQLite locally / Turso Cloud via `@libsql/client`                          |
| Validation     | Zod                                                                   |
| Authentication | Google Identity Services + opaque server sessions; optional legacy email OTP/SMTP           |
| Photos         | Multer + Sharp; protected local files                                 |
| Chat           | Durable REST API with 3-second active-thread / 5-second inbox polling |
| Tests          | Node test runner, real HTTP requests and isolated SQLite database     |

The deployment configuration uses Vercel for the frontend, Render for the backend, Turso for durable SQLite-compatible data, and Cloudinary for photos. Local development still works without cloud credentials. See the **[step-by-step deployment guide](docs/DEPLOYMENT.md)**.

## Data and configuration

Copy `server_side/.env.example` to `server_side/.env` only if changing defaults. Never commit `.env` or credentials.

`UNIVERSITY_DOMAINS` is a comma-separated exact allowlist (defaults to all five approved domains). It replaces the old singular `UNIVERSITY_DOMAIN` setting. Subdomains and lookalike suffixes are not automatically accepted.

- Database: `server_side/data/marketplace.sqlite` (plus SQLite WAL files while running).
- Photos: `server_side/uploads/`.
- Both are ignored by Git and persist across application restarts. Back up both together while the server is stopped, or use SQLite's backup API for online backups.
- Sample inventory is seeded only into an empty listing database in development. `SEED_DEMO=false` prevents future seeding; it does not delete existing records. Production discovery excludes sample inventory.
- There is no default administrator. Set `ADMIN_EMAILS` to one or more approved institutional addresses, restart, and sign in with that account to see **Reports**. No role can be granted from the browser.
- `UPLOADS_PATH` can select a persistent photo directory. `DATABASE_PATH` can select an isolated database for testing or deployment. Relative paths resolve from the backend working directory; absolute paths are recommended.

## Google authentication and a public student launch

See [the setup guide](docs/GOOGLE-AND-DATABASE-SETUP.md) for exact Google console steps and environment values. Setting `GOOGLE_CLIENT_ID` automatically requires Google login and rejects OTP and local-test sessions. Without a client ID, the original local test login remains available; real email OTP can alternatively be enabled with `DEV_AUTH=false` and SMTP configuration.

For the configured free-tier deployment, follow **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**. Render uses Turso and authenticated Cloudinary storage, Google sign-in, production mode, and the exact Vercel origin. The Vercel API proxy preserves same-origin session cookies. Missing cloud credentials cause startup to fail on Render instead of storing student data on its temporary filesystem. Provider accounts and live services still need to be configured in their dashboards.

## Tests

```sh
npm test
npm run build
```

Integration coverage includes anonymous/wrong-domain access, CSRF origin rejection, upload decoding and ownership, category attribute validation, cross-user edits, cross-university isolation, search, favorites, unique conversations, message retry/read state, sold-item behavior, durable storage, blocking, reports, admin actions, session revocation, and unsafe production configuration. Added tests cover all five domains after seller logout, impressions and ranking, reactivation, Google signature/issuer/audience/expiry validation, Workspace restrictions, nonce replay, account linking, local-session rejection and Google-only production without SMTP.

## Deliberately deferred

Password login, Microsoft SSO, annual re-verification, campus administration, multiple institutions in the UI, durable drafts, dedicated full-text search, realtime WebSockets, push/email message notifications, chat attachments, reviews, payments, background image cleanup, account deletion/export, appeals and advanced moderator evidence tools.

This is a single-process campus pilot with in-memory rate limits and polling. The hosted configuration uses durable Turso/Cloudinary storage. Add shared rate-limit storage and review polling/database load before horizontally scaling.

## Photo credits

Sample inventory uses freely usable Unsplash photographs under https://unsplash.com/license. These are illustrative sample listings, not real seller offers. Attribution:

- Headphones: YearOne — https://unsplash.com/photos/black-headphones-on-white-table-OjZ9J7Ltreg
- Lamp: Annie Spratt — https://unsplash.com/photos/black-and-silver-study-lamp-PYmjZ7iS8W4
- Books: Claudia Wolff — https://unsplash.com/photos/pile-of-assorted-color-books-MiJTU6lqksg
- Backpack: Wiser by the Mile — https://unsplash.com/photos/brown-leather-backpack-on-white-wall-OFHkPCkhYEY
- Sneakers: Zachary Keimig — https://unsplash.com/photos/pair-of-gray-sneakers-o_U0kPh7uu0
- Chair: Agata Create — https://unsplash.com/photos/white-armless-chair-BsQxAIl2LdA

Your uploaded listing photos are served from the backend and do not depend on Unsplash.
