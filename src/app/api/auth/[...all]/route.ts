import { createHash } from "node:crypto";
import { and, desc, eq, gte } from "drizzle-orm";
import { NextResponse } from "next/server";
import { toNextJsHandler } from "better-auth/next-js";
import { db } from "@/db";
import { loginAttempts } from "@/db/schema";
import { auth } from "@/lib/auth/auth";
import {
  insertAuthenticationAudit,
  userIdForEmail,
} from "@/lib/auth/authentication-audit";
import { emailIdentifier } from "@/lib/auth/sign-in-identifier";

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
  input: {
    action: string;
    identifier?: string;
    userId?: string | null;
    status: number;
  },
) {
  const userId =
    input.userId ??
    (input.identifier ? await userIdForEmail(input.identifier) : undefined);
  await insertAuthenticationAudit(
    {
      action: input.action,
      targetType: "authentication",
      targetId: input.identifier
        ? identifierHash(input.identifier).slice(0, 24)
        : undefined,
      ipAddress: requestIp(request),
      userAgent: request.headers.get("user-agent"),
      requestId: request.headers.get("x-request-id"),
      metadata: { status: input.status },
    },
    userId,
  );
}

async function sessionUserId(request: Request) {
  try {
    const session = await auth.api.getSession({
      headers: request.headers,
      query: { disableRefresh: true },
    });
    return session?.user.id ?? null;
  } catch {
    return null;
  }
}

function isMfaPath(pathname: string) {
  return pathname.includes("two-factor") || pathname.includes("backup-code");
}

export async function POST(request: Request) {
  const identifier = await emailIdentifier(request);
  if (identifier === null) {
    // An email sign-in whose identifier cannot be read would skip the lockout.
    return NextResponse.json(
      { message: "Send the sign-in email as JSON or form data." },
      { status: 400 },
    );
  }
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

  const pathname = new URL(request.url).pathname;
  // Resolve before forwarding: MFA enrolment rotates the session it arrived on.
  const mfaUserId =
    !identifier && isMfaPath(pathname) ? await sessionUserId(request) : null;
  const response = await handlers.POST(request);
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
  } else if (response.ok && isMfaPath(pathname)) {
    await auditAuthentication(request, {
      action: `authentication.mfa.${pathname.split("/").at(-1) ?? "changed"}`,
      userId: mfaUserId,
      status: response.status,
    });
  }
  return response;
}
