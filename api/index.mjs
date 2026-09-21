import { getRuntime } from "../server_side/src/vercel-runtime.js";

export default async function handler(req, res) {
  try {
    const { app } = await getRuntime();
    return app(req, res);
  } catch {
    res.statusCode = 503;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify({ error: "The marketplace is temporarily unavailable. Please try again." }));
    console.error("Marketplace initialization failed");
  }
}
