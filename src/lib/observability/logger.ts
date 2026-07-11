const sensitiveKey =
  /authorization|cookie|password|secret|token|credential|private.?key|payload|body/i;

export function redactSensitive(
  value: unknown,
  seen = new WeakSet<object>(),
): unknown {
  if (value == null || typeof value !== "object") return value;
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);
  if (Array.isArray(value))
    return value.map((item) => redactSensitive(item, seen));
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      sensitiveKey.test(key) ? "[REDACTED]" : redactSensitive(item, seen),
    ]),
  );
}

type LogLevel = "debug" | "info" | "warn" | "error";

export function structuredLog(
  level: LogLevel,
  event: string,
  attributes: Record<string, unknown> = {},
) {
  const safeAttributes = redactSensitive(attributes) as Record<string, unknown>;
  const entry = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    event,
    ...safeAttributes,
  });
  if (level === "error") console.error(entry);
  else if (level === "warn") console.warn(entry);
  else console.info(entry);
}
