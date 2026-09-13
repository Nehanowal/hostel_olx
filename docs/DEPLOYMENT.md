# Deploy Hostel OLX: Vercel + Render + Turso + Cloudinary

This guide uses the free plans for a campus pilot. The production services below are deployed. The numbered steps document their configuration and how to reproduce it. Production started with an **empty database**; existing local data and photos have not been migrated.

## Current deployment

| Resource | Production value |
| --- | --- |
| Website | [hostel-olx.vercel.app](https://hostel-olx.vercel.app) |
| API health check | [hostel-olx-api.onrender.com/api/health](https://hostel-olx-api.onrender.com/api/health) |
| Vercel project | `hostel-olx`, root `client_side`, Hobby |
| Render service | `hostel-olx-api`, root `server_side`, Free, Singapore |
| Turso database | `hostel-olx`, libSQL, AWS AP South (Mumbai), Free |
| Photo storage | Cloudinary Image and Video API, Free |
| Render `APP_ORIGIN` | `https://hostel-olx.vercel.app` |
| Vercel `BACKEND_ORIGIN` | `https://hostel-olx-api.onrender.com` |

The live frontend, asset delivery, SPA routes, API proxy, secure authentication cookies, and Turso nonce writes/reads/deletes have passed deployment checks. Direct backend data access and unauthenticated listing access are rejected as intended.

**Remaining launch step:** the existing Google OAuth web client must authorize `https://hostel-olx.vercel.app` under **Authorized JavaScript origins** (step 6). Google currently returns `origin_mismatch`. Complete that update using the account that owns the existing client, then verify student sign-in and a real photo upload. Cloudinary credentials are configured, but a live photo upload has not yet been verified.

Use the existing services for subsequent deployments; do not repeat account or database creation. Push changes to `main` to trigger the connected deployments. Keep the shared proxy secret synchronized between Render and Vercel.

## Architecture

| Component | Provider | What goes there |
| --- | --- | --- |
| Website | Vercel Hobby | `client_side`, built as static files |
| API | Render Free web service | `server_side`, one Node.js process |
| Database | Turso Cloud, libSQL | Users, sessions, listings, photo references, favorites, chat, moderation |
| Photos | Cloudinary Image and Video API, Free | Authenticated WebP image files |

The browser calls `/api` on the Vercel website. Vercel forwards those requests to Render with a private proxy secret. Render talks to Turso and Cloudinary. This preserves same-origin cookies and avoids third-party-cookie problems. Do not change the frontend to call Render directly or add permissive CORS.

## 1. Prepare the repository

Use Node.js 24 LTS. `.nvmrc`, the frontend/backend package settings and the Render blueprint select that major version. If you use nvm, run `nvm install` and `nvm use` from the repository root.

From the repository root, verify the code:

```sh
npm run setup
npm test
npm run build
```

Commit and push the deployment changes to your GitHub repository so both providers can access them:

```sh
git status
git add .
git commit -m "Configure Vercel, Render, Turso and Cloudinary deployment"
git push origin main
```

The ignore files exclude `.env`, databases, uploads, dependencies and Vercel's local files. Keep tokens and passwords in provider environment settings; the `.env.example` files only document their names.

Choose a tentative Vercel project name, for example `hoodlane-campus`. Its expected origin is `https://hoodlane-campus.vercel.app`; Vercel may assign a different name if that one is unavailable. Step 6 reconciles the actual URL.

## 2. Create the Turso database

1. Sign up at [Turso Cloud](https://app.turso.tech/) and select **Free**.
2. Create a database named `hostel-olx-production`. Use a **libSQL / SQLite-compatible** database for this app and a location close to your Render service, preferably Singapore when available.
3. Copy the database URL, which normally starts with `libsql://`. This becomes `TURSO_DATABASE_URL` on Render.
4. Generate a **database token with read and write access**. This becomes `TURSO_AUTH_TOKEN`. Use a token for this database, not an organization-management API token. Record its expiry and rotate it before it expires.
5. Leave the database empty. The backend creates its tables and applies additive migrations automatically before listening for requests.

If you prefer the [Turso CLI](https://docs.turso.tech/cli/installation), the equivalent commands after installation are:

```sh
turso auth login
turso db create hostel-olx-production
turso db show hostel-olx-production --url
turso db tokens create hostel-olx-production
```

The last command displays a secret: put it only in Render's environment settings. [Database creation](https://docs.turso.tech/cli/db/create) and [token creation](https://docs.turso.tech/cli/db/tokens/create) are documented by Turso.

Do not put the database URL or token in Vercel, React code, or a variable prefixed with `VITE_`. Local development continues using `server_side/data/marketplace.sqlite` while the Turso variables are blank.

## 3. Create Cloudinary photo storage

1. Sign up at [Cloudinary](https://cloudinary.com/users/register_free).
2. Choose the **Image and Video API Free** plan. Avoid confusing it with a paid Digital Asset Management trial.
3. Open the product environment's **API Keys** settings and copy its **Cloud name**, **API key**, and **API secret**.
4. Save those values for the three `CLOUDINARY_*` variables in the next step.

No public bucket, unsigned upload preset or frontend Cloudinary credentials are needed. The backend validates and converts uploads to WebP, then sends authenticated uploads under `hostel-olx/`. The API checks the viewer's access before issuing a link that expires after one minute. Your API secret stays on Render.

These temporary download links preserve the campus photo-access checks, but they bypass Cloudinary's CDN and use more delivery bandwidth than public CDN images. Watch the Cloudinary usage dashboard as traffic grows. [Cloudinary's access-control documentation](https://cloudinary.com/documentation/control_access_to_media)

## 4. Deploy the backend to Render

Generate a shared proxy secret in your own terminal:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Save that value privately. You will put the **same value** into Render and Vercel as `API_PROXY_SECRET`.

The repository includes a [Render Blueprint](../render.yaml), which sets the free plan, Singapore region, commands and health check:

1. Open the [Render dashboard](https://dashboard.render.com/).
2. Choose **New → Blueprint** and connect your GitHub repository.
3. Select branch `main` and the root `render.yaml` file.
4. Review the single `hostel-olx-api` **Free** web service. Do not add a Render database or disk.
5. Fill the prompted environment values using this table, then deploy.

| Render variable | Value |
| --- | --- |
| `APP_ORIGIN` | Tentative website origin, e.g. `https://hoodlane-campus.vercel.app` |
| `GOOGLE_CLIENT_ID` | Your existing web client ID ending in `.apps.googleusercontent.com` |
| `API_PROXY_SECRET` | The random value generated above |
| `TURSO_DATABASE_URL` | The URL from Turso |
| `TURSO_AUTH_TOKEN` | The read/write database token from Turso |
| `CLOUDINARY_CLOUD_NAME` | Cloudinary cloud name |
| `CLOUDINARY_API_KEY` | Cloudinary API key |
| `CLOUDINARY_API_SECRET` | Cloudinary API secret |

The blueprint supplies `NODE_ENV=production`, `NODE_VERSION=24`, `HOST=0.0.0.0`, `DEV_AUTH=false`, `SEED_DEMO=false`, and the university/domain settings. Render supplies `PORT`; do not hard-code it. Do not set `DATABASE_PATH` or `UPLOADS_PATH` on Render Free. The backend refuses to start there without the cloud-storage configuration and Google sign-in.

If your Google Workspace uses a different hosted domain, edit `GOOGLE_HOSTED_DOMAINS` to include the exact value approved by university IT. Keep `UNIVERSITY_DOMAINS` restricted to the intended student email domains. Optionally add `ADMIN_EMAILS` with comma-separated moderator university addresses; there is no administrator by default.

For manual **New → Web Service** setup instead of a Blueprint, use:

| Setting | Value |
| --- | --- |
| Runtime | Node |
| Branch | `main` |
| Root directory | `server_side` |
| Region | Singapore, preferably near Turso |
| Instance type | Free |
| Build command | `npm ci --omit=dev` |
| Start command | `npm start` |
| Health check path | `/api/health` |

Enter **all** the environment values from the blueprint and the table above if you use manual setup. [Render web-service setup](https://render.com/docs/web-services)

Once Render reports **Live**, copy its actual URL, for example `https://hostel-olx-api-xxxx.onrender.com`. Visit that URL plus `/api/health`; it should return `{"ok":true}`. Other direct API URLs intentionally require the Vercel proxy.

## 5. Deploy the frontend to Vercel

1. Open [Vercel](https://vercel.com/new), use your **Hobby** account, and import the same repository.
2. Choose your project name.
3. Set **Root Directory** to `client_side`.
4. Use **Vite**, **Node.js 24.x**, install command `npm ci`, build command `npm run build`, and output directory `dist`. The checked-in `vercel.ts` supplies the commands and routing.
5. Add these environment variables for **Production** before deploying:

| Vercel variable | Value |
| --- | --- |
| `BACKEND_ORIGIN` | The actual Render origin from step 4, e.g. `https://hostel-olx-api-xxxx.onrender.com` |
| `API_PROXY_SECRET` | Exactly the same random value used on Render |

6. Deploy and copy the **stable production domain** shown in the project, not a temporary commit-specific preview URL.

Both variables are used by server-side routing configuration. Do not prefix them with `VITE_`. Do not put Turso credentials, Cloudinary secrets or a Google client secret in Vercel. Google Client ID comes from the backend's public `/api/config` response.

`BACKEND_ORIGIN` must contain only an HTTPS origin, with no `/api` suffix. Vercel preserves the `/api` path when forwarding requests. `vercel.ts` injects the proxy secret as an upstream request header; it is not a browser response header. [Vercel programmatic configuration](https://vercel.com/docs/project-configuration/vercel-ts) and [external rewrites](https://vercel.com/docs/routing/rewrites)

Preview deployments are separate origins. They are not authorized to mutate the production API by default. Use the stable production URL for this launch; a preview environment should get its own backend and database before you enable sign-in there.

## 6. Connect the exact website origin and Google sign-in

1. In **Render → service → Environment**, set `APP_ORIGIN` to the **actual stable Vercel production origin**, for example `https://hoodlane-campus.vercel.app`. Use no path. Save and redeploy the backend.
2. Open [Google Auth Platform → Clients](https://console.cloud.google.com/auth/clients) and select the existing **Web application** client used by this app.
3. Add that exact HTTPS Vercel origin to **Authorized JavaScript origins**. Keep your existing localhost origins if you still develop locally.
4. This app uses a popup with a JavaScript callback. It does not require a new redirect URI or a Google client secret.
5. Review the Google project's audience/test-user settings. An Internal audience is appropriate only when the project belongs to the university Workspace organization. Otherwise follow Google's External audience requirements. University IT may need to approve the client for student accounts.
6. Open the Vercel production website and sign in with an approved university Google account.

See the [existing Google setup guide](GOOGLE-AND-DATABASE-SETUP.md) and [Google's web client setup](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid). A later custom domain needs the same update in Render's `APP_ORIGIN` and Google's allowed origins.

## 7. Verify the complete deployment

1. Visit `https://YOUR-VERCEL-DOMAIN/api/health`: expect `{"ok":true}`.
2. Visit `/api/config` on the Vercel domain: confirm `googleOnly` is `true`, `devAuth` is `false`, and the university domains are correct. It must return JSON, not the website's HTML.
3. Sign in as a seller, upload a photo, and publish one real test listing. Confirm the photo appears in Cloudinary as an authenticated image and the listing appears in Turso.
4. Sign in as another approved student in a second browser session. Open the listing, save it, start a chat, and send messages both ways.
5. Sign out and confirm authenticated API/photo endpoints reject access. Try a personal Gmail account and confirm it is rejected.
6. Use Render's **Manual Deploy → Deploy latest commit** to restart/redeploy the backend. The listing, photo, chat and saved item must still exist afterward.
7. Delete an unused uploaded photo and verify it is removed from Cloudinary. Mark the test listing sold or unavailable after checking it.

For a database-only check from your computer, put the Turso URL/token in the private `server_side/.env` and run:

```sh
npm --prefix server_side run db:check
```

This initializes any missing schema, verifies reads/writes, and rolls back its test record. The app never seeds sample inventory into Turso and rejects development-code authentication with a remote database. Remove the Turso variables from your local `.env` afterward if you want to return to local SQLite. Use a separate database for development when working with real student data.

## Free-plan behavior and maintenance

- **Render:** free services sleep after 15 minutes without traffic; waking can take about a minute. Local files are temporary, and free services cannot attach persistent disks. There are monthly usage limits and possible suspension for unusually high outbound traffic to external databases/storage. Its free PostgreSQL offering expires after 30 days, so this setup uses Turso. [Render free limits](https://render.com/docs/free)
- **Turso:** the current Free plan lists 5 GB storage, 500 million rows read/month and 10 million rows written/month. Monitor usage; query scans count, not only returned rows. [Turso pricing](https://turso.tech/pricing)
- **Cloudinary:** the Image and Video API Free plan includes 25 monthly credits shared across storage, processing and delivery. Temporary authenticated downloads consume extra bandwidth, so monitor actual usage. [Cloudinary pricing](https://cloudinary.com/pricing)
- **Vercel:** Hobby is for personal, noncommercial use. If this becomes a commercial marketplace, review the plan before launch. [Vercel Hobby](https://vercel.com/docs/plans/hobby)

Start on Free, leave paid overages/upgrades disabled, and monitor each dashboard. A free pilot does not provide an uptime guarantee. Keep private exports of the Turso database and separate backups of the original photos; database exports contain photo references, not the image bytes. Rotate expired/revoked credentials in Render and redeploy. If changing the proxy secret, update both hosts and redeploy Vercel too.

Existing local data is not uploaded by this guide. Importing the old SQLite database alone would leave its locally stored photo references broken on Render. Preserve the database and uploads together and plan both parts of a migration before copying existing student data into the production services.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Render refuses startup | Read the first error: verify production mode, Google ID, Turso URL/token, all Cloudinary credentials and the proxy secret. |
| Vercel configuration fails | Set `BACKEND_ORIGIN` and `API_PROXY_SECRET` before deploying; select root `client_side`. |
| First page is slow or says unavailable | Wait about a minute for Render to wake, then retry; check `/api/health` and Render logs. |
| API says to use the marketplace website | Use the Vercel origin. If already there, reconcile `API_PROXY_SECRET` on both hosts and redeploy Vercel. |
| API rejects the request origin | Match Render's `APP_ORIGIN` to the exact production URL you opened. A preview/custom domain is a different origin. |
| Google reports `origin_mismatch` | Add the exact production origin to the web client's Authorized JavaScript origins. |
| A university account is rejected | Check the exact email domain, hosted domain and university Workspace approval. |
| Photos fail to load | Check Cloudinary credentials/usage, authenticated asset type and Render logs; do not use a local uploads folder on Render. |
| Database authentication fails | Check database URL, database-specific token permissions and expiry. |
| Changes do not appear | Push to `main`, confirm both hosts built that commit, and redeploy after environment changes. |
