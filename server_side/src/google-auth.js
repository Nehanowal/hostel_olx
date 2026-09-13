import { OAuth2Client } from "google-auth-library";
import { randomBytes, randomUUID, createHash } from "node:crypto";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const fail = (status, message) => Object.assign(new Error(message), { status });

// GIS popup callback sends credentials through our same-origin JSON API. Its
// Origin/custom-header CSRF check is supplemented by a one-use, cookie-bound nonce.
export function googleAuth({
  app,
  db,
  clientId,
  domains,
  hostedDomains,
  university,
  production,
  authLimit,
  issueSession,
  client = new OAuth2Client(),
}) {
  const cookieOptions = {
    httpOnly: true,
    secure: production,
    sameSite: "strict",
    path: "/api/auth/google",
  };
  app.post("/api/auth/google/nonce", authLimit, async (req, res) => {
    if (!clientId) throw fail(503, "Google sign-in is not configured yet.");
    const nonce = randomBytes(32).toString("hex");
    await db
      .prepare(
        "DELETE FROM google_challenges WHERE expires_at<? OR nonce_hash=?",
      )
      .run(Date.now(), hash(req.cookies.google_nonce || ""));
    await db
      .prepare(
        "INSERT INTO google_challenges(nonce_hash,expires_at) VALUES (?,?)",
      )
      .run(hash(nonce), Date.now() + 10 * 60000);
    res.cookie("google_nonce", nonce, { ...cookieOptions, maxAge: 10 * 60000 });
    res.json({ nonce });
  });
  app.post("/api/auth/google", authLimit, async (req, res) => {
    if (!clientId) throw fail(503, "Google sign-in is not configured yet.");
    const nonce = req.cookies.google_nonce;
    const credential = req.body?.credential;
    if (typeof credential !== "string" || credential.length > 16000 || !nonce)
      throw fail(400, "Restart Google sign-in and try again.");
    const challenge = await db
      .prepare(
        "DELETE FROM google_challenges WHERE nonce_hash=? AND expires_at>? RETURNING nonce_hash",
      )
      .get(hash(nonce), Date.now());
    res.clearCookie("google_nonce", cookieOptions);
    if (!challenge) throw fail(400, "Sign-in expired. Restart Google sign-in.");
    let payload;
    try {
      const ticket = await client.verifyIdToken({
        idToken: credential,
        audience: clientId,
      });
      payload = ticket.getPayload();
    } catch {
      throw fail(
        401,
        "Google could not verify this sign-in. Please try again.",
      );
    }
    if (
      !payload ||
      payload.nonce !== nonce ||
      !payload.sub ||
      payload.exp * 1000 <= Date.now()
    )
      throw fail(401, "Invalid Google sign-in. Please try again.");
    const email =
      typeof payload.email === "string"
        ? payload.email.toLowerCase().trim()
        : "";
    if (
      payload.email_verified !== true ||
      !domains.includes(email.split("@")[1]) ||
      !hostedDomains.includes(payload.hd)
    )
      throw fail(
        403,
        `Use your official university Google account (${domains.map((d) => `@${d}`).join(" or ")}). Personal Google accounts are not accepted.`,
      );
    if (email.startsWith("demo-"))
      throw fail(403, "Sample seller accounts cannot sign in.");

    let user;
    await db.transaction(async () => {
      // Google's stable subject identifies returning accounts. Link a legacy
      // email account only after Google proves ownership of its Workspace email.
      const identity = await db
        .prepare(
          "SELECT u.* FROM google_identities g JOIN users u ON u.id=g.user_id WHERE g.subject=?",
        )
        .get(payload.sub);
      const byEmail = await db
        .prepare("SELECT * FROM users WHERE email=?")
        .get(email);
      if (identity && byEmail && identity.id !== byEmail.id)
        throw fail(
          409,
          "This email belongs to a different account. Contact the administrator.",
        );
      user = identity || byEmail;
      if (user && (user.status !== "active" || user.university !== university))
        throw fail(
          403,
          "This account cannot access this marketplace. Contact the administrator.",
        );
      if (user) {
        const linked = await db
          .prepare("SELECT subject FROM google_identities WHERE user_id=?")
          .get(user.id);
        if (linked && linked.subject !== payload.sub)
          throw fail(
            409,
            "This account is already linked to another Google identity.",
          );
      } else {
        const id = randomUUID();
        const name =
          String(payload.name || email.split("@")[0])
            .trim()
            .slice(0, 60) || "Student";
        await db
          .prepare(
            "INSERT INTO users(id,email,name,university,verified_at) VALUES (?,?,?,?,?)",
          )
          .run(id, email, name, university, new Date().toISOString());
        user = await db.prepare("SELECT * FROM users WHERE id=?").get(id);
      }
      await db
        .prepare(
          "INSERT OR IGNORE INTO google_identities(subject,user_id) VALUES (?,?)",
        )
        .run(payload.sub, user.id);
      await db
        .prepare("UPDATE users SET email=?,verified_at=? WHERE id=?")
        .run(email, new Date().toISOString(), user.id);
      // Test sessions must never retain access after an account is verified.
      await db
        .prepare("DELETE FROM sessions WHERE user_id=? AND auth_method='local'")
        .run(user.id);
    });
    await issueSession(req, res, { ...user, email }, "google");
  });
}
