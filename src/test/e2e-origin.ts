function isLoopback(hostname: string) {
  return (
    hostname === "localhost" ||
    hostname === "[::1]" ||
    /^127(?:\.\d{1,3}){3}$/.test(hostname)
  );
}

export function approvedE2EBaseURL(value: string | undefined) {
  if (!value) return undefined;
  const url = new URL(value);
  const secure = url.protocol === "https:";
  const loopbackHTTP = url.protocol === "http:" && isLoopback(url.hostname);
  if (!secure && !loopbackHTTP)
    throw new Error(
      "PLAYWRIGHT_BASE_URL must use HTTPS unless it targets a loopback host",
    );
  return value.replace(/\/$/, "");
}
