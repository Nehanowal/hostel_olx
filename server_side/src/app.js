import express from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { rateLimit } from "express-rate-limit";
import multer from "multer";
import sharp from "sharp";
import nodemailer from "nodemailer";
import { z } from "zod";
import {
  randomUUID,
  randomBytes,
  randomInt,
  createHash,
  timingSafeEqual,
} from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { openDatabase, root } from "./db.js";
import { categories, conditions, seedDemo } from "./catalog.js";
import { googleAuth } from "./google-auth.js";
import { createImageStorage } from "./image-storage.js";
import { configureProxy, rateLimitKey } from "./proxy.js";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const fail = (status, message) => Object.assign(new Error(message), { status });
const text = (min, max) => z.string().trim().min(min).max(max);
const listingSchema = z.object({
  title: text(3, 120),
  description: text(10, 4000),
  category: z.enum(categories.map((c) => c.id)),
  price: z.number().int().min(0).max(100000000),
  condition: z.enum(conditions),
  location: text(2, 80),
  attributes: z.record(z.string(), text(0, 100)).default({}),
  imageIds: z
    .array(z.string())
    .min(1)
    .max(6)
    .refine((ids) => new Set(ids).size === ids.length),
});

export async function createApp(options = {}) {
  const app = express();
  configureProxy(app);
  const production =
    options.production ?? process.env.NODE_ENV === "production";
  const googleClientId =
    options.googleClientId ?? process.env.GOOGLE_CLIENT_ID ?? "";
  const googleOnly = !!googleClientId;
  const devAuth =
    !googleOnly &&
    (options.devAuth ?? (!production && process.env.DEV_AUTH !== "false"));
  const domains = [
    ...new Set(
      (
        process.env.UNIVERSITY_DOMAINS ||
        "nst.rishihood.edu.in,csds.rishihood.edu.in,psy.rishihood.edu.in,makers.rishihood.edu.in,rishihood.edu.in"
      )
        .split(",")
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
  if (!domains.length)
    throw new Error("Configure at least one university email domain.");
  const domain = domains[0];
  const university = process.env.UNIVERSITY_NAME || "Rishihood University";
  const hostedDomains = (process.env.GOOGLE_HOSTED_DOMAINS || domains.join(","))
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const origin = (process.env.APP_ORIGIN || "http://localhost:5173").replace(
    /\/$/,
    "",
  );
  const uploads =
    options.uploads || process.env.UPLOADS_PATH || resolve(root, "uploads");
  if (
    production &&
    (devAuth ||
      (!googleOnly && (!process.env.SMTP_HOST || !process.env.SMTP_FROM)) ||
      !process.env.APP_ORIGIN?.startsWith("https://"))
  ) {
    throw new Error(
      "Production requires real authentication (GOOGLE_CLIENT_ID or DEV_AUTH=false with SMTP_HOST/SMTP_FROM) and an HTTPS APP_ORIGIN.",
    );
  }
  const appOrigin = new URL(origin);
  if (
    appOrigin.username ||
    appOrigin.password ||
    appOrigin.search ||
    appOrigin.hash ||
    appOrigin.pathname !== "/"
  )
    throw new Error(
      "APP_ORIGIN must be the website origin without a path, query, fragment or credentials.",
    );
  if (process.env.RENDER === "true" && (!production || !googleOnly))
    throw new Error(
      "Render requires NODE_ENV=production and GOOGLE_CLIENT_ID; its free tier blocks SMTP ports.",
    );
  const imageStorage = options.imageStorage || createImageStorage({ uploads });
  const db = options.db || (await openDatabase());
  if (db.remote && devAuth) {
    if (!options.db) db.close();
    throw new Error(
      "Remote databases require real authentication. Set GOOGLE_CLIENT_ID or disable DEV_AUTH and configure SMTP on a supported host.",
    );
  }
  const adminEmails = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase());
  if (
    !db.remote &&
    !production &&
    options.seed !== false &&
    process.env.SEED_DEMO !== "false"
  )
    await seedDemo(db, university, domain);
  const smtp = process.env.SMTP_HOST
    ? nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: process.env.SMTP_PORT === "465",
        ...(process.env.SMTP_USER
          ? {
              auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS,
              },
            }
          : {}),
      })
    : null;
  const userDto = (user) => ({
    id: user.id,
    name: user.name,
    email: user.email,
    university: user.university,
    campus: user.campus,
    authMethod: user.auth_method,
    isAdmin: adminEmails.includes(user.email),
  });
  const run = async (sql, ...args) => await db.prepare(sql).run(...args);
  const get = async (sql, ...args) => await db.prepare(sql).get(...args);
  const all = async (sql, ...args) => await db.prepare(sql).all(...args);
  const transaction = async (fn) => await db.transaction(fn);
  app.disable("x-powered-by");
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          "script-src": ["'self'", "https://accounts.google.com/gsi/client"],
          "frame-src": ["'self'", "https://accounts.google.com/gsi/"],
          "connect-src": ["'self'", "https://accounts.google.com/gsi/"],
          "style-src": [
            "'self'",
            "'unsafe-inline'",
            "https://accounts.google.com/gsi/style",
          ],
          "img-src": [
            "'self'",
            "blob:",
            "data:",
            "https://images.unsplash.com",
            "https://api.cloudinary.com",
          ],

          "upgrade-insecure-requests": production ? [] : null,
        },
      },
      strictTransportSecurity: production,
      crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
      referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    }),
  );
  app.use(express.json({ limit: "50kb" }), cookieParser());
  // Render health probes must not consume student rate limits or database reads.
  app.get("/api/health", (req, res) =>
    res.set("Cache-Control", "no-store").json({ ok: true }),
  );
  app.use("/api", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      const allowed = production
        ? [origin]
        : [
            origin,
            "http://localhost:5173",
            "http://127.0.0.1:5173",
            "http://localhost:3001",
            "http://127.0.0.1:3001",
          ];

      if (
        (req.headers.origin && !allowed.includes(req.headers.origin)) ||
        req.headers["x-requested-with"] !== "HostelOLX"
      )
        return next(fail(403, "Request origin is not allowed."));
    }
    next();
  });
  app.use(
    "/api",
    rateLimit({
      keyGenerator: rateLimitKey,
      windowMs: 60000,
      limit: 300,
      standardHeaders: "draft-7",
      legacyHeaders: false,
      message: { error: "Too many requests. Please wait a minute." },
    }),
  );
  app.use("/api", async (req, res, next) => {
    const token = req.cookies.session;
    req.user = token
      ? await get(
          "SELECT u.*,s.auth_method FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.status=? AND (?=0 OR s.auth_method IN ('email','google')) AND (?=0 OR s.auth_method='google')",
          hash(token),
          Date.now(),
          "active",
          devAuth ? 0 : 1,
          googleOnly ? 1 : 0,
        )
      : null;
    if (req.user && !domains.includes(req.user.email.split("@")[1]))
      req.user = null;
    next();
  });
  const auth = (req, res, next) =>
    req.user
      ? next()
      : next(fail(401, "Sign in with your university email to continue."));
  const admin = (req, res, next) =>
    adminEmails.includes(req.user.email)
      ? next()
      : next(fail(403, "Administrator access required."));
  const authLimit = rateLimit({
    keyGenerator: rateLimitKey,
    windowMs: 15 * 60000,
    limit: 15,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Too many sign-in attempts. Try again in 15 minutes." },
  });
  const sendLimit = rateLimit({
    keyGenerator: rateLimitKey,
    windowMs: 60000,
    limit: 40,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Please slow down and try again shortly." },
  });
  async function issueSession(req, res, user, authMethod) {
    const token = randomBytes(32).toString("hex");
    await run(
      "DELETE FROM sessions WHERE expires_at<? OR token_hash=?",
      Date.now(),
      hash(req.cookies.session || ""),
    );
    await run(
      "UPDATE users SET verified_at=? WHERE id=?",
      new Date().toISOString(),
      user.id,
    );
    await run(
      "INSERT INTO sessions(token_hash,user_id,expires_at,auth_method) VALUES (?,?,?,?)",
      hash(token),
      user.id,
      Date.now() + 7 * 86400000,
      authMethod,
    );
    res.cookie("session", token, {
      httpOnly: true,
      secure: production,
      sameSite: "lax",
      maxAge: 7 * 86400000,
      path: "/",
    });
    res.json({ user: userDto({ ...user, auth_method: authMethod }) });
  }
  googleAuth({
    app,
    db,
    clientId: googleClientId,
    domains,
    hostedDomains,
    university,
    production,
    authLimit,
    issueSession,
    client: options.googleClient,
  });
  const lookup = async (id, user) => {
    const row = await get(
      "SELECT l.*,u.name AS seller_name,u.status AS seller_status FROM listings l JOIN users u ON u.id=l.seller_id WHERE l.id=? AND l.university=?",
      id,
      user.university,
    );
    if (
      !row ||
      ["deleted", "removed"].includes(row.status) ||
      row.seller_status !== "active" ||
      (production && row.is_demo)
    )
      throw fail(404, "This listing is no longer available.");
    return row;
  };
  const listingDto = async (row, user) => ({
    ...row,
    attributes: JSON.parse(row.attributes),
    is_demo: !!row.is_demo,
    is_fresh:
      row.status === "active" &&
      Date.parse(row.created_at) >= Date.now() - 48 * 3600000,
    images: (
      await all(
        "SELECT id,path FROM images WHERE listing_id=? ORDER BY position,id",
        row.id,
      )
    ).map((im) => ({
      id: im.id,
      url: im.path.startsWith("https://") ? im.path : `/api/images/${im.id}`,
    })),
    saved: !!(await get(
      "SELECT 1 FROM favorites WHERE user_id=? AND listing_id=?",
      user.id,
      row.id,
    )),
    isOwner: row.seller_id === user.id,
  });
  const conversation = async (id, user) => {
    const c = await get(
      "SELECT c.*,l.title,l.status AS listing_status,l.price,l.university,l.is_demo FROM conversations c JOIN listings l ON l.id=c.listing_id WHERE c.id=? AND (c.buyer_id=? OR c.seller_id=?) AND l.university=?",
      id,
      user.id,
      user.id,
      user.university,
    );
    if (!c) throw fail(404, "Conversation not found.");
    return c;
  };
  const blocked = async (a, b) =>
    !!(await get(
      "SELECT 1 FROM blocks WHERE (blocker_id=? AND blocked_id=?) OR (blocker_id=? AND blocked_id=?)",
      a,
      b,
      b,
      a,
    ));

  app.get("/api/config", (req, res) =>
    res.json({
      university,
      domain,
      domains,
      devAuth,
      googleClientId,
      googleOnly,
      categories,
      conditions,
    }),
  );
  app.get("/api/me", (req, res) =>
    res.json({ user: req.user ? userDto(req.user) : null }),
  );
  app.post("/api/auth/request", authLimit, async (req, res) => {
    if (googleOnly)
      throw fail(
        403,
        "Use Google sign-in with your official university account.",
      );
    const { email, name } = z
      .object({
        email: z
          .email()
          .max(254)
          .transform((s) => s.toLowerCase().trim()),
        name: text(2, 60),
      })
      .parse(req.body);
    if (!domains.includes(email.split("@")[1]))
      throw fail(
        422,
        `Use your ${domains.map((value) => `@${value}`).join(" or ")} university email.`,
      );
    if (email.startsWith("demo-"))
      throw fail(
        422,
        "Demo seller accounts cannot sign in. Use your own student email.",
      );
    const latest = await get(
      "SELECT expires_at FROM challenges WHERE email=? ORDER BY expires_at DESC LIMIT 1",
      email,
    );
    if (latest && latest.expires_at > Date.now() + 9 * 60000)
      throw fail(429, "Please wait one minute before requesting another code.");
    if (!devAuth && !smtp)
      throw fail(
        503,
        "Email delivery is not configured yet. Please contact the marketplace administrator.",
      );
    const id = randomUUID(),
      code = String(randomInt(100000, 1000000));
    await run(
      "DELETE FROM challenges WHERE email=? OR expires_at<?",
      email,
      Date.now(),
    );
    await run(
      "INSERT INTO challenges(id,email,name,code_hash,expires_at) VALUES (?,?,?,?,?)",
      id,
      email,
      name,
      hash(`${id}:${code}`),
      Date.now() + 10 * 60000,
    );
    if (!devAuth) {
      try {
        await smtp.sendMail({
          from: process.env.SMTP_FROM,
          to: email,
          subject: "Your Hostel OLX sign-in code",
          text: `Your sign-in code is ${code}. It expires in 10 minutes. If you did not request this, ignore this email.`,
        });
      } catch {
        await run("DELETE FROM challenges WHERE id=?", id);
        throw fail(503, "We could not send your code. Please try again later.");
      }
    }
    res.json({
      challengeId: id,
      ...(devAuth ? { devCode: code } : {}),
      message: devAuth
        ? "Local test code generated."
        : "Check your university inbox.",
    });
  });
  app.post("/api/auth/verify", authLimit, async (req, res) => {
    if (googleOnly)
      throw fail(
        403,
        "Use Google sign-in with your official university account.",
      );
    const { challengeId, code } = z
      .object({ challengeId: z.uuid(), code: z.string().regex(/^\d{6}$/) })
      .parse(req.body);
    const c = await get("SELECT * FROM challenges WHERE id=?", challengeId);
    if (!c || c.expires_at < Date.now() || c.attempts >= 5)
      throw fail(400, "Code expired or too many attempts. Request a new code.");
    if (!domains.includes(c.email.split("@")[1]))
      throw fail(403, "This university domain is no longer allowed.");
    await run(
      "UPDATE challenges SET attempts=attempts+1 WHERE id=?",
      challengeId,
    );
    if (
      !timingSafeEqual(
        Buffer.from(c.code_hash, "hex"),
        Buffer.from(hash(`${challengeId}:${code}`), "hex"),
      )
    )
      throw fail(400, "That code is incorrect. Please try again.");
    const user = await transaction(async () => {
      await run("DELETE FROM challenges WHERE id=?", challengeId);
      await run(
        "INSERT OR IGNORE INTO users(id,email,name,university,verified_at) VALUES (?,?,?,?,?)",
        randomUUID(),
        c.email,
        c.name,
        university,
        new Date().toISOString(),
      );
      return await get("SELECT * FROM users WHERE email=?", c.email);
    });
    if (user.status !== "active")
      throw fail(403, "Your account is suspended. Contact the administrator.");
    await issueSession(req, res, user, devAuth ? "local" : "email");
  });
  app.post("/api/auth/logout", async (req, res) => {
    if (req.cookies.session)
      await run(
        "DELETE FROM sessions WHERE token_hash=?",
        hash(req.cookies.session),
      );
    res.clearCookie("session", { path: "/" }).json({ ok: true });
  });
  app.get("/api/listings", auth, async (req, res) => {
    const q = z
      .object({
        q: text(0, 100).optional(),
        category: z.string().optional(),
        condition: z.string().optional(),
        sort: z
          .enum(["recommended", "popular", "newest", "price-low", "price-high"])
          .default("recommended"),
        view: z.enum(["browse", "saved", "mine"]).default("browse"),
        maxPrice: z.coerce.number().min(0).optional(),
        page: z.coerce.number().int().min(1).max(10000).default(1),
      })
      .parse(req.query);
    const where = ["l.university=?", "u.status='active'"],
      args = [req.user.university];
    if (production) where.push("l.is_demo=0");
    if (q.view === "mine") {
      where.push("l.seller_id=? AND l.status NOT IN ('deleted','removed')");
      args.push(req.user.id);
    } else if (q.view === "saved") {
      where.push(
        "l.status NOT IN ('deleted','removed') AND EXISTS(SELECT 1 FROM favorites f WHERE f.listing_id=l.id AND f.user_id=?)",
      );
      args.push(req.user.id);
    } else where.push("l.status='active'");
    if (q.q) {
      where.push(
        "(l.title LIKE ? ESCAPE '\\' OR l.description LIKE ? ESCAPE '\\')",
      );
      const term = `%${q.q.replace(/[\\%_]/g, "\\$&")}%`;
      args.push(term, term);
    }
    if (q.category) {
      where.push("l.category=?");
      args.push(q.category);
    }
    if (q.condition) {
      where.push("l.condition=?");
      args.push(q.condition);
    }
    if (q.maxPrice !== undefined) {
      where.push("l.price<=?");
      args.push(Math.round(q.maxPrice * 100));
    }
    const base = `FROM listings l JOIN users u ON u.id=l.seller_id WHERE ${where.join(" AND ")}`;
    const total = (await get(`SELECT count(*) AS total ${base}`, ...args))
      .total;
    const sort = {
      recommended:
        "l.is_demo ASC,CASE WHEN l.created_at>=? THEN 0 ELSE 1 END ASC,CASE WHEN l.created_at>=? THEN l.created_at END DESC,l.impressions DESC,l.created_at DESC,l.id DESC",
      popular: "l.impressions DESC,l.created_at DESC,l.id DESC",
      newest: "l.created_at DESC,l.id DESC",
      "price-low": "l.price ASC,l.id DESC",
      "price-high": "l.price DESC,l.id DESC",
    }[q.sort];
    const freshSince = new Date(Date.now() - 48 * 3600000).toISOString();
    const rows = await all(
      `SELECT l.*,u.name AS seller_name ${base} ORDER BY ${sort} LIMIT 24 OFFSET ?`,
      ...args,
      ...(q.sort === "recommended" ? [freshSince, freshSince] : []),
      (q.page - 1) * 24,
    );
    res.json({
      items: await Promise.all(
        rows.map(async (row) => await listingDto(row, req.user)),
      ),
      total,
      page: q.page,
      hasMore: q.page * 24 < total,
    });
  });
  app.post("/api/listings/impressions", auth, async (req, res) => {
    const { ids } = z
      .object({ ids: z.array(z.uuid()).min(1).max(24) })
      .parse(req.body);
    const day = new Date().toISOString().slice(0, 10);
    await transaction(async () => {
      const uniqueIds = [...new Set(ids)];
      const inserted = await all(
        `INSERT OR IGNORE INTO listing_impressions(listing_id,viewer_id,day)
         SELECT id,?,? FROM listings WHERE id IN (${uniqueIds.map(() => "?").join(",")})
         AND university=? AND seller_id<>? AND status='active' AND is_demo=0
         AND EXISTS(SELECT 1 FROM users WHERE users.id=listings.seller_id AND users.status='active')
         RETURNING listing_id`,
        req.user.id,
        day,
        ...uniqueIds,
        req.user.university,
        req.user.id,
      );
      if (inserted.length)
        await run(
          `UPDATE listings SET impressions=impressions+1 WHERE id IN (${inserted.map(() => "?").join(",")})`,
          ...inserted.map((row) => row.listing_id),
        );
      await run("DELETE FROM listing_impressions WHERE day<?", day);
    });
    res.json({ ok: true });
  });
  app.get("/api/listings/most-viewed", auth, async (req, res) => {
    // This row ranks the entire campus inventory independently of the paginated
    // feed and its filters. Samples never compete with real student listings.
    const rows = await all(
      `SELECT l.*,u.name AS seller_name FROM listings l JOIN users u ON u.id=l.seller_id
       WHERE l.university=? AND l.status='active' AND l.is_demo=0 AND u.status='active'
       ORDER BY l.impressions DESC,l.created_at DESC,l.id DESC LIMIT 12`,
      req.user.university,
    );
    res.json({
      items: await Promise.all(
        rows.map(async (row) => await listingDto(row, req.user)),
      ),
    });
  });
  app.get("/api/listings/:id", auth, async (req, res) =>
    res.json(await listingDto(await lookup(req.params.id, req.user), req.user)),
  );
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  });
  app.post(
    "/api/images",
    auth,
    sendLimit,
    upload.single("photo"),
    async (req, res) => {
      if (!req.file) throw fail(422, "Choose a photo.");
      if (
        (
          await get(
            "SELECT count(*) AS n FROM images WHERE owner_id=? AND listing_id IS NULL",
            req.user.id,
          )
        ).n >= 30
      )
        throw fail(429, "Too many unused uploads. Remove some photos first.");
      const id = randomUUID();
      let buffer;
      try {
        buffer = await sharp(req.file.buffer, {
          limitInputPixels: 20000000,
          animated: false,
        })
          .rotate()
          .resize(1600, 1600, { fit: "inside", withoutEnlargement: true })
          .webp({ quality: 80 })
          .toBuffer();
      } catch {
        throw fail(
          422,
          "Use a valid JPEG, PNG or WebP image under 8 MB and 20 megapixels.",
        );
      }
      const path = await imageStorage.save(id, buffer);
      try {
        await run(
          "INSERT INTO images(id,owner_id,path,created_at) VALUES (?,?,?,?)",
          id,
          req.user.id,
          path,
          Date.now(),
        );
      } catch (error) {
        await imageStorage.remove(path).catch(() => {});
        throw error;
      }
      res.status(201).json({ id, url: `/api/images/${id}` });
    },
  );
  app.get("/api/images/:id", auth, async (req, res) => {
    const im = await get(
      "SELECT i.*,l.university,l.status,u.status AS seller_status FROM images i LEFT JOIN listings l ON l.id=i.listing_id LEFT JOIN users u ON u.id=l.seller_id WHERE i.id=?",
      req.params.id,
    );
    if (
      !im ||
      (im.owner_id !== req.user.id &&
        (!im.listing_id ||
          im.university !== req.user.university ||
          ["removed", "deleted"].includes(im.status) ||
          im.seller_status !== "active"))
    )
      throw fail(404, "Image not found.");
    imageStorage.send(im.path, res);
  });
  app.delete("/api/images/:id", auth, async (req, res) => {
    // Claim the unused image atomically before waiting for cloud deletion, so
    // another request cannot attach it to a listing while the file is removed.
    const im = await transaction(async () => {
      const row = await get(
        "SELECT * FROM images WHERE id=? AND owner_id=? AND listing_id IS NULL",
        req.params.id,
        req.user.id,
      );
      if (!row) throw fail(404, "Unused image not found.");
      await run("DELETE FROM images WHERE id=?", row.id);
      return row;
    });
    try {
      await imageStorage.remove(im.path);
    } catch (error) {
      // Restore the reference so the seller can retry a failed storage request.
      await run(
        "INSERT INTO images(id,owner_id,path,position,created_at) VALUES (?,?,?,?,?)",
        im.id,
        im.owner_id,
        im.path,
        im.position,
        im.created_at,
      );
      throw error;
    }
    res.json({ ok: true });
  });
  const saveListing = async (req, res, editing) => {
    const id = await transaction(async () => {
      const input = listingSchema.parse(req.body),
        existing = editing ? await lookup(req.params.id, req.user) : null;
      if (existing && existing.seller_id !== req.user.id)
        throw fail(403, "Only the seller can edit this listing.");
      if (existing && existing.status === "sold")
        throw fail(409, "Sold listings cannot be edited.");
      if (existing && req.body.version !== existing.version)
        throw fail(409, "This listing changed. Refresh before editing.");
      const allowed = categories.find((c) => c.id === input.category).fields;
      if (Object.keys(input.attributes).some((key) => !allowed.includes(key)))
        throw fail(422, "Some fields do not belong to this category.");
      for (const id of input.imageIds) {
        const im = await get(
          "SELECT * FROM images WHERE id=? AND owner_id=?",
          id,
          req.user.id,
        );
        if (!im || (im.listing_id && im.listing_id !== existing?.id))
          throw fail(422, "Use your own uploaded photos.");
      }
      const id = existing?.id || randomUUID();
      if (existing)
        await run(
          "UPDATE listings SET title=?,description=?,category=?,price=?,condition=?,location=?,attributes=?,version=version+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?",
          input.title,
          input.description,
          input.category,
          input.price,
          input.condition,
          input.location,
          JSON.stringify(input.attributes),
          id,
        );
      else
        await run(
          "INSERT INTO listings(id,seller_id,university,title,description,category,price,condition,location,attributes) VALUES (?,?,?,?,?,?,?,?,?,?)",
          id,
          req.user.id,
          req.user.university,
          input.title,
          input.description,
          input.category,
          input.price,
          input.condition,
          input.location,
          JSON.stringify(input.attributes),
        );
      await run("UPDATE images SET listing_id=NULL WHERE listing_id=?", id);
      for (const [i, imageId] of input.imageIds.entries()) {
        await run(
          "UPDATE images SET listing_id=?,position=? WHERE id=?",
          id,
          i,
          imageId,
        );
      }
      return id;
    });
    res
      .status(editing ? 200 : 201)
      .json(await listingDto(await lookup(id, req.user), req.user));
  };
  app.post(
    "/api/listings",
    auth,
    sendLimit,
    async (req, res) => await saveListing(req, res, false),
  );
  app.patch(
    "/api/listings/:id",
    auth,
    async (req, res) => await saveListing(req, res, true),
  );
  app.patch("/api/listings/:id/status", auth, async (req, res) => {
    const { status, version } = z
      .object({
        status: z.enum(["active", "sold", "unavailable", "deleted"]),
        version: z.number().int(),
      })
      .parse(req.body);
    const row = await lookup(req.params.id, req.user);
    if (row.seller_id !== req.user.id)
      throw fail(403, "Only the seller can change this listing.");
    if (row.version !== version)
      throw fail(409, "This listing changed. Refresh and try again.");
    if (row.status === "sold" && status !== "deleted")
      throw fail(
        409,
        "Sold listings cannot be reactivated. Create a new listing instead.",
      );
    const updated = await run(
      "UPDATE listings SET status=?,version=version+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND version=?",
      status,
      row.id,
      version,
    );
    if (!updated.changes)
      throw fail(409, "This listing changed. Refresh and try again.");
    res.json({ ok: true });
  });
  app.put("/api/listings/:id/favorite", auth, async (req, res) => {
    await lookup(req.params.id, req.user);
    const { saved } = z.object({ saved: z.boolean() }).parse(req.body);
    if (saved)
      await run(
        "INSERT OR IGNORE INTO favorites VALUES (?,?)",
        req.user.id,
        req.params.id,
      );
    else
      await run(
        "DELETE FROM favorites WHERE user_id=? AND listing_id=?",
        req.user.id,
        req.params.id,
      );
    res.json({ saved });
  });
  app.post(
    "/api/listings/:id/conversations",
    auth,
    sendLimit,
    async (req, res) => {
      const row = await lookup(req.params.id, req.user);
      if (row.seller_id === req.user.id)
        throw fail(409, "You cannot message yourself.");
      if (row.is_demo)
        throw fail(
          409,
          "This is sample inventory. Create a real listing with another student account to test chat.",
        );
      if (await blocked(req.user.id, row.seller_id))
        throw fail(403, "This conversation is blocked.");
      const existing = await get(
        "SELECT id FROM conversations WHERE listing_id=? AND buyer_id=?",
        row.id,
        req.user.id,
      );
      if (existing) return res.json(existing);
      if (row.status !== "active")
        throw fail(409, "This item is no longer available.");
      const id = randomUUID();
      await run(
        "INSERT OR IGNORE INTO conversations(id,listing_id,buyer_id,seller_id) VALUES (?,?,?,?)",
        id,
        row.id,
        req.user.id,
        row.seller_id,
      );
      res
        .status(201)
        .json(
          await get(
            "SELECT id FROM conversations WHERE listing_id=? AND buyer_id=?",
            row.id,
            req.user.id,
          ),
        );
    },
  );
  app.get("/api/conversations", auth, async (req, res) => {
    const rows = await all(
      "SELECT c.*,l.title,l.price,l.status AS listing_status FROM conversations c JOIN listings l ON l.id=c.listing_id WHERE (c.buyer_id=? OR c.seller_id=?) AND l.university=? ORDER BY c.updated_at DESC",
      req.user.id,
      req.user.id,
      req.user.university,
    );
    res.json(
      await Promise.all(
        rows.map(async (c) => ({
          ...c,
          other: await get(
            "SELECT id,name FROM users WHERE id=?",
            c.buyer_id === req.user.id ? c.seller_id : c.buyer_id,
          ),
          lastMessage:
            (
              await get(
                "SELECT body FROM messages WHERE conversation_id=? ORDER BY id DESC LIMIT 1",
                c.id,
              )
            )?.body || "Start the conversation",
          unread: (
            await get(
              "SELECT count(*) AS n FROM messages WHERE conversation_id=? AND sender_id<>? AND id>coalesce((SELECT last_id FROM conversation_reads WHERE conversation_id=? AND user_id=?),0)",
              c.id,
              req.user.id,
              c.id,
              req.user.id,
            )
          ).n,
        })),
      ),
    );
  });
  app.get("/api/conversations/:id/messages", auth, async (req, res) => {
    const c = await conversation(req.params.id, req.user);
    const before = z.coerce
      .number()
      .int()
      .positive()
      .default(Number.MAX_SAFE_INTEGER)
      .parse(req.query.before);
    const other = c.buyer_id === req.user.id ? c.seller_id : c.buyer_id;
    const rows = (
      await all(
        "SELECT * FROM messages WHERE conversation_id=? AND id<? ORDER BY id DESC LIMIT 50",
        c.id,
        before,
      )
    ).reverse();
    res.json({
      conversation: c,
      messages: rows,
      hasMore: rows.length === 50,
      blocked: await blocked(req.user.id, other),
      other: await get("SELECT id,name,status FROM users WHERE id=?", other),
    });
  });
  app.post(
    "/api/conversations/:id/messages",
    auth,
    sendLimit,
    async (req, res) => {
      const c = await conversation(req.params.id, req.user),
        other = c.buyer_id === req.user.id ? c.seller_id : c.buyer_id;
      if (
        (await blocked(req.user.id, other)) ||
        (await get("SELECT status FROM users WHERE id=?", other))?.status !==
          "active" ||
        ["removed", "deleted"].includes(c.listing_status)
      )
        throw fail(403, "Messaging is unavailable for this conversation.");
      const { body, clientId } = z
        .object({ body: text(1, 2000), clientId: z.uuid() })
        .parse(req.body);
      const message = await transaction(async () => {
        await run(
          "INSERT OR IGNORE INTO messages(conversation_id,sender_id,client_id,body) VALUES (?,?,?,?)",
          c.id,
          req.user.id,
          clientId,
          body,
        );
        await run(
          "UPDATE conversations SET updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?",
          c.id,
        );
        return await get(
          "SELECT * FROM messages WHERE conversation_id=? AND sender_id=? AND client_id=?",
          c.id,
          req.user.id,
          clientId,
        );
      });
      res.status(201).json(message);
    },
  );
  app.post("/api/conversations/:id/read", auth, async (req, res) => {
    const c = await conversation(req.params.id, req.user);
    const { lastId } = z
      .object({ lastId: z.number().int().min(0) })
      .parse(req.body);
    if (
      lastId &&
      !(await get(
        "SELECT 1 FROM messages WHERE conversation_id=? AND id=?",
        c.id,
        lastId,
      ))
    )
      throw fail(422, "Invalid message.");
    await run(
      "INSERT INTO conversation_reads VALUES (?,?,?) ON CONFLICT(conversation_id,user_id) DO UPDATE SET last_id=max(last_id,excluded.last_id)",
      c.id,
      req.user.id,
      lastId,
    );
    res.json({ ok: true });
  });
  app.post("/api/conversations/:id/block", auth, async (req, res) => {
    const c = await conversation(req.params.id, req.user);
    await run(
      "INSERT OR IGNORE INTO blocks VALUES (?,?)",
      req.user.id,
      c.buyer_id === req.user.id ? c.seller_id : c.buyer_id,
    );
    res.json({ ok: true });
  });
  app.post("/api/reports", auth, sendLimit, async (req, res) => {
    const data = z
      .object({
        listingId: z.string().optional(),
        conversationId: z.string().optional(),
        reason: z.enum([
          "Scam or fake listing",
          "Prohibited item",
          "Spam",
          "Harassment",
          "Other",
        ]),
        details: text(0, 2000).default(""),
      })
      .refine((v) => !!v.listingId !== !!v.conversationId)
      .parse(req.body);
    if (data.listingId) await lookup(data.listingId, req.user);
    else await conversation(data.conversationId, req.user);
    if (
      await get(
        "SELECT 1 FROM reports WHERE reporter_id=? AND status='open' AND (listing_id=? OR conversation_id=?)",
        req.user.id,
        data.listingId || null,
        data.conversationId || null,
      )
    )
      throw fail(409, "You have already reported this.");
    await run(
      "INSERT INTO reports(id,reporter_id,listing_id,conversation_id,reason,details) VALUES (?,?,?,?,?,?)",
      randomUUID(),
      req.user.id,
      data.listingId || null,
      data.conversationId || null,
      data.reason,
      data.details,
    );
    res.status(201).json({ ok: true });
  });
  app.get("/api/admin/reports", auth, admin, async (req, res) =>
    res.json(
      await all(
        "SELECT r.*,l.title,u.name AS reporter_name FROM reports r LEFT JOIN listings l ON l.id=r.listing_id JOIN users u ON u.id=r.reporter_id ORDER BY r.created_at DESC LIMIT 100",
      ),
    ),
  );
  app.post("/api/admin/reports/:id/resolve", auth, admin, async (req, res) => {
    const { action, reason } = z
      .object({
        action: z.enum(["dismiss", "remove_listing", "suspend_user"]),
        reason: text(3, 500),
      })
      .parse(req.body);
    const report = await get(
      "SELECT * FROM reports WHERE id=? AND status=?",
      req.params.id,
      "open",
    );
    if (!report) throw fail(404, "Open report not found.");
    if (action === "remove_listing" && !report.listing_id)
      throw fail(422, "This report does not target a listing.");
    await transaction(async () => {
      if (action === "remove_listing")
        await run(
          "UPDATE listings SET status='removed',version=version+1 WHERE id=?",
          report.listing_id,
        );
      if (action === "suspend_user") {
        const id = report.listing_id
          ? (
              await get(
                "SELECT seller_id AS id FROM listings WHERE id=?",
                report.listing_id,
              )
            ).id
          : await (async () => {
              const c = await get(
                "SELECT * FROM conversations WHERE id=?",
                report.conversation_id,
              );
              return c.buyer_id === report.reporter_id
                ? c.seller_id
                : c.buyer_id;
            })();
        if (id === req.user.id) throw fail(409, "You cannot suspend yourself.");
        await run("UPDATE users SET status='suspended' WHERE id=?", id);
        await run("DELETE FROM sessions WHERE user_id=?", id);
      }
      await run("UPDATE reports SET status='resolved' WHERE id=?", report.id);
      await run(
        "INSERT INTO admin_actions(id,admin_id,report_id,action,reason) VALUES (?,?,?,?,?)",
        randomUUID(),
        req.user.id,
        report.id,
        action,
        reason,
      );
    });
    res.json({ ok: true });
  });
  app.use("/api", (req, res) =>
    res.status(404).json({ error: "Endpoint not found." }),
  );
  const client = resolve(root, "../client_side/dist");
  if (existsSync(client)) {
    app.use(express.static(client));
    app.get("/{*path}", (req, res) =>
      res.sendFile(resolve(client, "index.html")),
    );
  }
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err instanceof z.ZodError)
      return res.status(422).json({
        error: err.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; "),
      });
    if (err instanceof multer.MulterError)
      return res
        .status(422)
        .json({ error: "Upload one image under 8 MB at a time." });
    const status = err.status || 500;
    if (status >= 500)
      console.error("Request failed:", req.method, req.path, err.message);
    res.status(status).json({
      error:
        status >= 500 ? "Service unavailable. Please try again." : err.message,
    });
  });
  return { app, db };
}
