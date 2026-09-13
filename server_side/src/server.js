import { createApp } from "./app.js";
const { app, db } = await createApp();
const host =
  process.env.HOST ||
  (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");
if (
  process.env.NODE_ENV !== "production" &&
  process.env.DEV_AUTH !== "false" &&
  !process.env.GOOGLE_CLIENT_ID &&
  !["localhost", "127.0.0.1", "::1"].includes(host)
)
  throw new Error("Local test authentication may only bind to loopback.");
const server = app.listen(Number(process.env.PORT || 3001), host, () =>
  console.log(`Hostel OLX API: http://${host}:${process.env.PORT || 3001}`),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () =>
    server.close(() => {
      db.close();
      process.exit(0);
    }),
  );
