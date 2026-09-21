import { QueueClient } from "@vercel/queue";
import { waitUntil } from "@vercel/functions";
import { createApp } from "./app.js";
import { createJobDispatcher, validCronRequest } from "./job-dispatcher.js";

const queue = new QueueClient({ region: "bom1" });
let runtime;
export function getRuntime() {
  // Reuse connections inside an instance, and allow recovery after a failed init.
  runtime ??= createApp({
    onMessageCommitted: () => waitUntil(runtime.then(({ jobs }) => jobs.wake("messages"))
      .catch(() => console.warn("Message queue unavailable; outbox retained"))),
  }).then(instance => ({ ...instance, jobs: createJobDispatcher({
    ...instance, publish: (...args) => queue.send(...args),
  }) })).catch(error => { runtime = undefined; throw error; });
  return runtime;
}

export const queueHandler = queue.handleNodeCallback(async payload => {
  const { jobs } = await getRuntime();
  await jobs.processJob(payload);
  console.info("Email queue reconciliation completed", payload.kind);
});

export async function dailyHandler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!validCronRequest(req, process.env.CRON_SECRET)) {
    res.statusCode = 401;
    return res.end("Unauthorized");
  }
  try {
    const { jobs } = await getRuntime();
    await jobs.daily();
    res.statusCode = 200;
    res.end("OK");
  } catch {
    res.statusCode = 503;
    res.end("Job scheduling unavailable");
  }
}
