# Google sign-in and database setup

**Local connection verified:** the client ID is configured in the private `.env`, test authentication is disabled, and a real Rishihood Google sign-in succeeded in Chrome at http://localhost:3002. The frontend and backend are now publicly deployed; see [the deployment guide](DEPLOYMENT.md) for the live URLs and remaining Google production-origin setup. The instructions below remain useful for local development or another environment.

The updated project is `/Users/nehasharma/hostel_olx`. The older MVP under `Documents/Codex/2026-09-10/files-pasted-by-the-user-you/hostel_olx` is a separate copy. Run the updated folder to see these changes.

## 1. Create the Google client

1. Open [Google Auth Platform](https://console.cloud.google.com/auth/overview), create/select a project, and complete **Branding** with “Hostel OLX”, a support email and developer contact.
2. Under **Audience**, select **Internal** only if the project belongs to Rishihood’s Google Workspace organization and all intended accounts belong to it. Otherwise use **External**. The backend still restricts university access. For a pilot, add your test accounts if the console requests them. Basic Sign in with Google has exceptions to general testing restrictions; see [Google’s audience rules](https://support.google.com/cloud/answer/15549945).
3. In **Data Access**, use only `openid`, email and profile. No Gmail, Drive or Calendar permissions are needed.
4. Go to **Clients → Create client → Web application**. Add these **Authorized JavaScript origins**, without paths or trailing slashes:

   ```text
   http://localhost
   http://localhost:5173
   http://localhost:3001
   http://localhost:3002
   ```

5. Leave **Authorized redirect URIs** empty for this implementation: it uses Google’s popup and a JavaScript callback.
6. Create the client and copy its **Client ID**, ending in `.apps.googleusercontent.com`. No client secret, service-account key or API key is used by this integration.

These settings follow [Google’s current web sign-in setup](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid). Use `localhost`, rather than `127.0.0.1`, when testing Google with the origins above.

## 2. Configure this app

In Terminal:

```sh
cd /Users/nehasharma/hostel_olx
cp -n server_side/.env.example server_side/.env
```

Open `server_side/.env` and set:

```dotenv
GOOGLE_CLIENT_ID=YOUR_CLIENT_ID.apps.googleusercontent.com
DEV_AUTH=false
UNIVERSITY_NAME=Rishihood University
UNIVERSITY_DOMAINS=nst.rishihood.edu.in,csds.rishihood.edu.in,psy.rishihood.edu.in,makers.rishihood.edu.in,rishihood.edu.in
GOOGLE_HOSTED_DOMAINS=nst.rishihood.edu.in,csds.rishihood.edu.in,psy.rishihood.edu.in,makers.rishihood.edu.in,rishihood.edu.in
APP_ORIGIN=http://localhost:5173
```

Keep the real client ID on a single line. `.env` is ignored by Git. A client ID is public configuration and can be shared with me; **do not send your client secret, password, OTP, session cookie or ID token**.

Setting `GOOGLE_CLIENT_ID` switches the whole app to Google-only login. It also rejects old email/local sessions and both OTP API routes. Existing users are linked by their verified institutional Google email; their listings, saved items and conversations remain attached to the same user ID. Future sign-ins use Google’s stable subject identifier. SMTP is unnecessary in Google mode.

The backend uses Google’s official Node library to verify signatures, audience, issuer and expiry. It additionally checks a one-use cookie-bound nonce, verified email, the exact email allowlist, and the Google Workspace hosted-domain claim. Checking only an email suffix would not prove university-managed Google membership. [Google’s token verification guidance](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token)

## 3. Restart and test

The previous MVP may still be running on ports 3001/5173. Stop it with Ctrl+C in its original terminal, then run this updated project:

```sh
cd /Users/nehasharma/hostel_olx
npm run dev
```

Open **http://localhost:5173**. You should see the official Google button and no test-code login. For the compiled preview instead:

```sh
npm run build
PORT=3002 APP_ORIGIN=http://localhost:3002 npm start
```

Open **http://localhost:3002**. Restart a running backend after editing `.env`; reloading the page alone does not load changed server configuration.

Test with a real approved university Google account, then a personal Gmail account (which must be rejected). Publish an available item, sign out, and sign in with another course account. The item and photo should appear in Explore; **Chat with seller** starts the purchase conversation. Payment remains directly between students.

If Google says access is blocked by the organization, send the client ID to university IT. Ask them to review this app under **Admin console → Security → Access and data control → API controls → Manage Third-Party App Access**, for basic sign-in only. Do not disable organization-wide protections. [Google Workspace app-access instructions](https://support.google.com/a/answer/7281227)

If a real institutional account is rejected by our domain check, ask IT for the Workspace primary/hosted domain. Add that exact value to `GOOGLE_HOSTED_DOMAINS` while keeping the email allowlist limited to the five approved domains.

## 4. Database status

**The local database and backend are implemented and working. Public hosting is not provisioned.**

| Component | Current state |
| --- | --- |
| API | Express backend: authentication, listing lifecycle, photos, favorites, chat and moderation |
| Database | SQLite at `server_side/data/marketplace.sqlite`; initialized and migrated automatically |
| Photos | `server_side/uploads/`; stored separately from the database |
| Persistence | Data survives logout, account changes and backend restarts |
| Course access | All five exact domains share the same university marketplace |
| Google | Client ID configured locally; real university sign-in and backend Google session verified |
| Public deployment | Not created; needs one shared backend with persistent storage and HTTPS |

The older MVP’s database was copied using SQLite’s consistent backup API, including pending WAL writes, and its uploaded photos were copied into the updated project. Existing listing statuses were preserved. Later writes to the older copy will not synchronize into this one; use the updated folder consistently.

The recovered snapshot had **two sold and two unavailable real listings, and no active real listing**. Explore correctly excludes those states. From the seller’s **My listings**, click **Make visible on campus** for an unavailable item. Sold items remain sold; create a new listing if you marked one sold by mistake. New unavailable actions now explain that other students will lose discovery access before confirmation.

No database password, Supabase project, Firebase project or database signup is required locally. To back up, stop the backend and copy the entire `server_side/data` and `server_side/uploads` directories together to your backup location. Do not copy just a live `.sqlite` file while its WAL contains pending writes. Keep backups private.

## 5. Deploy to Vercel and Render

The project now supports **Vercel + Render Free + Turso Cloud + Cloudinary Free**. Follow **[the deployment guide](DEPLOYMENT.md)** for account creation, environment variables, Google origins and verification.

The earlier local-disk arrangement in section 4 describes local development. Render Free must use Turso for data and Cloudinary for photos; its filesystem is temporary. The backend creates/migrates the cloud schema automatically and refuses a Render startup without the required cloud configuration. Existing local student data and photos have not been uploaded.
