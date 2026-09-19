# Owner dashboard

Set `ADMIN_EMAILS` on the backend to the owner's verified university login email. There is no client-side admin password: every dashboard endpoint checks the authenticated email against this server-side allowlist. An ordinary student cannot read these endpoints even by entering their URLs.

Sign in to the existing website and select **Dashboard** in the header. The dashboard includes searchable, paginated users, all listing statuses (including deleted), an activity timeline, and the existing reports interface. No private chat messages are returned.

- Registered users: accounts in the owner's university.
- Signed in: distinct active accounts with an unexpired login session; closing a browser does not end a session.
- Active in last 5 minutes: accounts whose visible site sent a recent heartbeat.
- Active today: distinct signed-in visitors on the current UTC date.
- Daily chart: 14 UTC days; visits are counted once per account per day, across tabs/devices.

The browser sends a heartbeat once a minute while visible. Dashboard data refreshes once a minute. These are approximate presence counts, not a guaranteed real-time connection count. Signed-out visitors are not tracked. Earlier visits cannot be recovered.

Turso stores visits and activity. Database triggers record registrations, sign-ins, listing creations/edits/status changes, and account suspension changes in the same transaction as the underlying changes. Existing records are included in inventories without fabricated historical events. The UI displays the tracking start timestamp.
