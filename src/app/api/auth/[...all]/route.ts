import { createHash } from "node:crypto";
import { and, desc, eq, gte } from "drizzle-orm";
import { NextResponse } from "next/server";
import { toNextJsHandler } from "better-auth/next-js";
import { db } from "@/db";
import { auditEvents, loginAttempts } from "@/db/schema";
import { auth } from "@/lib/auth/auth";

const handlers = toNextJsHandler(auth.handler);
const lockoutWindowMs = 15 * 60 * 1_000;
const maximumFailures = 5;

export const GET = handlers.GET;

function requestIp(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
}

function identifierHash(identifier: string) {
  return createHash("sha256").update(identifier).digest("hex");
}

async function emailIdentifier(request: Request) {
  if (!request.url.includes("/sign-in/email")) return undefined;
  try {
    const body = (await request.clone().json()) as { email?: unknown };
    return typeof body.email === "string"
      ? body.email.trim().toLowerCase().slice(0, 320)
      : undefined;
  } catch {
    return undefined;
  }
}

async function isLocked(identifier: string) {
  const attempts = await db
    .select({ succeeded: loginAttempts.succeeded })
    .from(loginAttempts)
    .where(
      and(
        eq(loginAttempts.identifier, identifierHash(identifier)),
        gte(loginAttempts.occurredAt, new Date(Date.now() - lockoutWindowMs)),
      ),
    )
    .orderBy(desc(loginAttempts.occurredAt))
    .limit(maximumFailures);
  return (
    attempts.length === maximumFailures &&
    attempts.every((attempt) => !attempt.succeeded)
  );
}

async function auditAuthentication(
  request: Request,
  input: { action: string; identifier?: string; status: number },
) {
  await db.insert(auditEvents).values({
    action: input.action,
    targetType: "authentication",
    targetId: input.identifier
      ? identifierHash(input.identifier).slice(0, 24)
      : undefined,
    ipAddress: requestIp(request),
    userAgent: request.headers.get("user-agent"),
    requestId: request.headers.get("x-request-id"),
    metadata: { status: input.status },
  });
}

export async function POST(request: Request) {
  const identifier = await emailIdentifier(request);
  if (identifier && (await isLocked(identifier))) {
    await auditAuthentication(request, {
      action: "authentication.locked_out",
      identifier,
      status: 429,
    });
    return NextResponse.json(
      { message: "Too many sign-in attempts. Try again in 15 minutes." },
      { status: 429, headers: { "retry-after": "900" } },
    );
  }

  const response = await handlers.POST(request);
  const pathname = new URL(request.url).pathname;
  if (identifier) {
    const succeeded = response.status < 400;
    const credentialFailure = [400, 401].includes(response.status);
    if (succeeded || credentialFailure)
      await db.insert(loginAttempts).values({
        identifier: identifierHash(identifier),
        ipAddress: requestIp(request),
        succeeded,
      });
    await auditAuthentication(request, {
      action: succeeded
        ? "authentication.succeeded"
        : credentialFailure
          ? "authentication.failed"
          : "authentication.rejected",
      identifier,
      status: response.status,
    });
  } else if (
    response.ok &&
    (pathname.includes("two-factor") || pathname.includes("backup-code"))
  ) {
    await auditAuthentication(request, {
      action: `authentication.mfa.${pathname.split("/").at(-1) ?? "changed"}`,
      status: response.status,
    });
  }
  return response;
}
