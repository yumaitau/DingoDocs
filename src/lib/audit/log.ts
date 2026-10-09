import { headers } from "next/headers";
import { db } from "@/db";
import { auditEvents } from "@/db/schema";
import {
  assertPublicHttpUrl,
  outboundFetchInit,
} from "@/lib/security/outbound-url";

type AuditInput = {
  organisationId?: string | null;
  actorId?: string | null;
  action: string;
  targetType: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  previousValues?: Record<string, unknown>;
  newValues?: Record<string, unknown>;
};

const sensitiveKeys =
  /password|secret|token|key|cookie|authorization|credential|payload|body/i;

export function redactAuditValues(
  value?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!value) return undefined;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      sensitiveKeys.test(key)
        ? "[REDACTED]"
        : item && typeof item === "object" && !Array.isArray(item)
          ? redactAuditValues(item as Record<string, unknown>)
          : item,
    ]),
  );
}

async function forwardToSiem(event: Record<string, unknown>) {
  const webhook = process.env.SIEM_WEBHOOK_URL;
  if (!webhook) return;
  try {
    const url = await assertPublicHttpUrl(webhook);
    await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "DingoDocs-SIEM/1.0",
      },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(3_000),
      ...outboundFetchInit,
    });
  } catch {
    // Swallow SIEM delivery errors; audit insert already succeeded.
  }
}

export async function recordAudit(input: AuditInput) {
  const requestHeaders = await headers();
  const values = {
    organisationId: input.organisationId,
    actorId: input.actorId,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    ipAddress: requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim(),
    userAgent: requestHeaders.get("user-agent"),
    requestId: requestHeaders.get("x-request-id"),
    metadata: redactAuditValues(input.metadata) ?? {},
    previousValues: redactAuditValues(input.previousValues),
    newValues: redactAuditValues(input.newValues),
  };
  await db.insert(auditEvents).values(values);
  await forwardToSiem({
    ...values,
    emittedAt: new Date().toISOString(),
  });
}
