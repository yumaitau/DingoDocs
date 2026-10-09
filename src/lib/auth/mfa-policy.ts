import "server-only";

import { cache } from "react";
import { and, eq, isNull } from "drizzle-orm";
import { organisations, users } from "@/db/schema";

const DAY_MS = 24 * 60 * 60 * 1000;

const MFA_ADMIN_ROLES = new Set<string>([
  "platform_administrator",
  "organisation_owner",
  "organisation_administrator",
  "client_administrator",
]);

export const MFA_REQUIRED_MESSAGE = "Multi-factor authentication is required";
export const MFA_ENROLMENT_PATH = "/account/security";

export class MfaRequiredError extends Error {
  readonly code = "mfa_required" as const;

  constructor() {
    super(MFA_REQUIRED_MESSAGE);
    this.name = "MfaRequiredError";
  }
}

export type MfaEnforcementInput = {
  mfaMode?: string | null;
  role: string;
  twoFactorEnabled: boolean;
  mfaEnforcedAt?: Date | null;
  mfaGracePeriodDays?: unknown;
  now: Date;
};

export type MfaEnforcementDecision = {
  inScope: boolean;
  satisfied: boolean;
  blocked: boolean;
  recordEnforcedAt: boolean;
};

export function decideMfaEnforcement(
  input: MfaEnforcementInput,
): MfaEnforcementDecision {
  const inScope = roleInMfaScope(input.mfaMode, input.role);
  if (!inScope) {
    return {
      inScope: false,
      satisfied: false,
      blocked: false,
      recordEnforcedAt: false,
    };
  }

  const satisfied = input.twoFactorEnabled;
  const enforcedAt = validInstant(input.mfaEnforcedAt);
  const recordEnforcedAt = enforcedAt == null;
  if (satisfied) {
    return { inScope: true, satisfied: true, blocked: false, recordEnforcedAt };
  }

  const nowInstant = validInstant(input.now);
  const graceDays = input.mfaGracePeriodDays;
  if (!nowInstant || !positiveGrace(graceDays)) {
    return { inScope: true, satisfied: false, blocked: true, recordEnforcedAt };
  }

  const startedAt = enforcedAt ?? nowInstant;
  const blocked =
    nowInstant.getTime() >= startedAt.getTime() + graceDays * DAY_MS;
  return { inScope: true, satisfied: false, blocked, recordEnforcedAt };
}

export function isAccountSecurityPath(pathname: string | null | undefined) {
  const path = pathnameOnly(pathname);
  return (
    path === MFA_ENROLMENT_PATH || path.startsWith(`${MFA_ENROLMENT_PATH}/`)
  );
}

export function isAuthApiPath(pathname: string | null | undefined) {
  const path = pathnameOnly(pathname);
  return path === "/api/auth" || path.startsWith("/api/auth/");
}

export function mfaAccessDecision(input: {
  blocked: boolean;
  pathname: string | null;
  serverAction: boolean;
}): "allow" | "redirect" | "deny" {
  if (!input.blocked || isAuthApiPath(input.pathname)) return "allow";
  if (!input.serverAction && isAccountSecurityPath(input.pathname))
    return "allow";
  if (
    input.serverAction ||
    !input.pathname ||
    input.pathname.startsWith("/api/")
  )
    return "deny";
  return "redirect";
}

export const loadMfaEnforcement = cache(loadMfaEnforcementUncached);

async function loadMfaEnforcementUncached(
  userId: string,
  organisationId: string,
  role: string,
): Promise<MfaEnforcementDecision> {
  const now = new Date();
  const { db } = await import("@/db");
  const [row] = await db
    .select({
      twoFactorEnabled: users.twoFactorEnabled,
      mfaEnforcedAt: users.mfaEnforcedAt,
      securityPolicy: organisations.securityPolicy,
    })
    .from(users)
    .innerJoin(organisations, eq(organisations.id, organisationId))
    .where(and(eq(users.id, userId), isNull(organisations.deletedAt)))
    .limit(1);
  const policy = readMfaPolicy(row?.securityPolicy);
  const decision = decideMfaEnforcement({
    mfaMode: policy.mfaMode,
    role,
    twoFactorEnabled: row?.twoFactorEnabled ?? false,
    mfaEnforcedAt: asDate(row?.mfaEnforcedAt),
    mfaGracePeriodDays: policy.mfaGracePeriodDays,
    now,
  });
  if (decision.recordEnforcedAt && row) {
    await db
      .update(users)
      .set({ mfaEnforcedAt: now })
      .where(and(eq(users.id, userId), isNull(users.mfaEnforcedAt)));
  }
  return decision;
}

function roleInMfaScope(mode: string | null | undefined, role: string) {
  if (mode === "all_users_required") return true;
  if (mode === "admin_required") return MFA_ADMIN_ROLES.has(role);
  return false;
}

function positiveGrace(days: unknown): days is number {
  return typeof days === "number" && Number.isFinite(days) && days > 0;
}

function validInstant(value: Date | null | undefined) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return null;
  return value;
}

function asDate(value: Date | string | null | undefined) {
  if (value == null) return null;
  return validInstant(value instanceof Date ? value : new Date(value));
}

function readMfaPolicy(value: unknown): {
  mfaMode?: string;
  mfaGracePeriodDays?: unknown;
} {
  if (!value || typeof value !== "object") return {};
  const record = value as { mfaMode?: unknown; mfaGracePeriodDays?: unknown };
  return {
    mfaMode: typeof record.mfaMode === "string" ? record.mfaMode : undefined,
    mfaGracePeriodDays: record.mfaGracePeriodDays,
  };
}

function pathnameOnly(pathname: string | null | undefined) {
  if (!pathname) return "";
  return pathname.split(/[?#]/, 1)[0] ?? "";
}
