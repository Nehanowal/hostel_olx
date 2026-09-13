// Set BACKEND_ORIGIN in Vercel to the Render service's HTTPS origin.
// Keeping /api on the website's origin preserves HttpOnly session cookies.
const backend = process.env.BACKEND_ORIGIN;
if (!backend)
  throw new Error(
    "Set BACKEND_ORIGIN in Vercel, e.g. https://your-api.onrender.com",
  );
const url = new URL(backend);
if (!process.env.API_PROXY_SECRET || process.env.API_PROXY_SECRET.length < 32)
  throw new Error(
    "Set API_PROXY_SECRET in Vercel to the same random value (at least 32 characters) used on Render.",
  );
if (
  url.protocol !== "https:" ||
  url.username ||
  url.password ||
  url.search ||
  url.hash ||
  url.pathname !== "/"
) {
  throw new Error(
    "BACKEND_ORIGIN must be an HTTPS origin with no path, credentials, query or fragment.",
  );
}

export const config = {
  framework: "vite",
  installCommand: "npm ci",
  buildCommand: "npm run build",
  outputDirectory: "dist",
  rewrites: [
    routes.rewrite("/api/:path*", `${url.origin}/api/:path*`, {
      requestHeaders: {
        "x-api-proxy-secret": deploymentEnv("API_PROXY_SECRET"),
      },
    }),
    { source: "/((?!api(?:/|$)).*)", destination: "/index.html" },
  ],
  headers: [
    {
      source: "/(.*)",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        {
          key: "Cross-Origin-Opener-Policy",
          value: "same-origin-allow-popups",
        },
        { key: "X-Frame-Options", value: "SAMEORIGIN" },
        {
          key: "Content-Security-Policy",
          value:
            "default-src 'self'; script-src 'self' https://accounts.google.com/gsi/client; frame-src 'self' https://accounts.google.com/gsi/; connect-src 'self' https://accounts.google.com/gsi/; style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style; img-src 'self' data: blob: https://images.unsplash.com https://api.cloudinary.com; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'; upgrade-insecure-requests",
        },
      ],
    },
    {
      source: "/api/:path*",
      headers: [{ key: "Cache-Control", value: "no-store" }],
    },
  ],
};
import { routes, deploymentEnv } from "@vercel/config/v1";
