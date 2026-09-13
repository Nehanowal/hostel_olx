import { createHash, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { ipKeyGenerator } from "express-rate-limit";

const hash = (value) => createHash("sha256").update(value).digest();

export function configureProxy(app, env = process.env) {
  const secret = env.API_PROXY_SECRET;
  if ((secret && secret.length < 32) || (env.RENDER === "true" && !secret))
    throw new Error(
      "Set API_PROXY_SECRET to the same random value (at least 32 characters) on Render and Vercel.",
    );
  app.set("trust proxy", env.RENDER === "true" ? 1 : false);
  app.use("/api", (req, res, next) => {
    if (!secret || req.path === "/health") return next();
    if (
      !timingSafeEqual(hash(req.get("x-api-proxy-secret") || ""), hash(secret))
    )
      return res
        .status(403)
        .json({ error: "Use the marketplace website to access this API." });
    // Vercel overwrites this header. Trust it only after authenticating the
    // proxy, because the Render service also has a directly reachable URL.
    const clientIp = req.get("x-vercel-forwarded-for");
    if (!isIP(clientIp || ""))
      return res
        .status(400)
        .json({
          error: "The website proxy did not forward a valid client address.",
        });
    req.clientIp = clientIp;
    next();
  });
}

export const rateLimitKey = (req) => ipKeyGenerator(req.clientIp || req.ip);
