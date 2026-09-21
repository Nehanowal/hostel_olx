export async function api(path, options = {}) {
  const form = options.body instanceof FormData;
  const response = await fetch(`/api${path}`, {
    ...options,
    credentials: "same-origin",
    headers: {
      "X-Requested-With": "HostelOLX",
      ...(!form && options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
    body: options.body
      ? form
        ? options.body
        : JSON.stringify(options.body)
      : undefined,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || data === null) {
    const error = new Error(
      data?.error ||
        "The marketplace is unavailable or waking up. Wait a minute and try again.",
    );
    error.retryable = response.status === 408 || response.status >= 500 ||
      (response.ok && data === null);
    throw error;
  }
  return data;
}
export const money = (value) =>
  value === 0
    ? "Free"
    : new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        maximumFractionDigits: 0,
      }).format(value / 100);
