import { api } from "./api.js";

function pause(ms, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}

async function attempt(signal, timeoutMs) {
  const request = new AbortController();
  const abort = () => request.abort(signal.reason);
  signal.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => request.abort(
    new DOMException("The connection is taking longer than usual.", "TimeoutError"),
  ), timeoutMs);
  try {
    signal.throwIfAborted();
    return await Promise.all([
      api("/config", { signal: request.signal }),
      api("/me", { signal: request.signal }),
    ]);
  } catch (error) {
    if (request.signal.aborted) throw request.signal.reason;
    throw error;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
    request.abort(); // Cancel a sibling request if the other one failed.
  }
}

// Only these two read-only startup requests retry; messages and other writes do not.
export async function loadMarketplace({
  signal,
  onRetry = () => {},
  maxWaitMs = 90000,
  requestTimeoutMs = 20000,
  retryDelayMs = 4000,
} = {}) {
  signal?.throwIfAborted();
  const startup = new AbortController();
  const abort = () => startup.abort(signal.reason);
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => startup.abort(new Error(
    "Connecting is taking longer than usual. Check your internet connection and try again.",
  )), maxWaitMs);
  try {
    while (true) {
      startup.signal.throwIfAborted();
      try {
        return await attempt(startup.signal, requestTimeoutMs);
      } catch (error) {
        startup.signal.throwIfAborted();
        if (!error.retryable && !(error instanceof TypeError) && error.name !== "TimeoutError") throw error;
        onRetry();
        await pause(retryDelayMs, startup.signal);
      }
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}
