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
  const data = await response
    .json()
    .catch(() => ({ error: "The server is unavailable. Please try again." }));
  if (!response.ok)
    throw new Error(data.error || "Something went wrong. Please try again.");
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
