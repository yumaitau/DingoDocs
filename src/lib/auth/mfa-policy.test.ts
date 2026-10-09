import { describe, expect, it } from "vitest";
import {
  decideMfaEnforcement,
  MFA_REQUIRED_MESSAGE,
  MfaRequiredError,
  mfaAccessDecision,
  type MfaEnforcementInput,
} from "./mfa-policy";

const now = new Date("2026-06-15T00:00:00.000Z");
const day = 24 * 60 * 60 * 1000;

const adminRoles = [
  "platform_administrator",
  "organisation_owner",
  "organisation_administrator",
  "client_administrator",
] as const;

const otherRoles = [
  "engagement_manager",
  "lead_consultant",
  "consultant",
  "reviewer",
  "client_user",
  "read_only",
] as const;

function decide(overrides: Partial<MfaEnforcementInput> = {}) {
  return decideMfaEnforcement({
    mfaMode: "all_users_required",
    role: "consultant",
    twoFactorEnabled: false,
    mfaEnforcedAt: null,
    now,
    ...overrides,
  });
}

describe("decideMfaEnforcement", () => {
  it.each([undefined, null, "optional", "forced"])(
    "does not enforce when mfaMode is %s",
    (mfaMode) => {
      expect(
        decide({ mfaMode, role: "organisation_owner", mfaEnforcedAt: null }),
      ).toEqual({
        inScope: false,
        satisfied: false,
        blocked: false,
        recordEnforcedAt: false,
      });
    },
  );

  it.each(adminRoles)(
    "admin_required blocks %s without MFA or grace",
    (role) => {
      expect(decide({ mfaMode: "admin_required", role })).toMatchObject({
        inScope: true,
        satisfied: false,
        blocked: true,
        recordEnforcedAt: true,
      });
    },
  );

  it.each(otherRoles)("admin_required leaves %s alone", (role) => {
    expect(
      decide({ mfaMode: "admin_required", role, mfaEnforcedAt: null }),
    ).toMatchObject({
      inScope: false,
      blocked: false,
      recordEnforcedAt: false,
    });
  });

  it.each([...adminRoles, ...otherRoles])(
    "all_users_required includes %s",
    (role) => {
      expect(decide({ role })).toMatchObject({ inScope: true, blocked: true });
    },
  );

  it("treats enrolled MFA as satisfied and still stamps a missing clock", () => {
    expect(
      decide({
        twoFactorEnabled: true,
        mfaEnforcedAt: null,
        mfaGracePeriodDays: 0,
      }),
    ).toEqual({
      inScope: true,
      satisfied: true,
      blocked: false,
      recordEnforcedAt: true,
    });
    expect(
      decide({
        twoFactorEnabled: true,
        mfaEnforcedAt: new Date(now.getTime() - 30 * day),
        mfaGracePeriodDays: 1,
      }),
    ).toMatchObject({ blocked: false, recordEnforcedAt: false });
  });

  it("blocks immediately when grace is missing, zero, negative, or not a finite number", () => {
    for (const mfaGracePeriodDays of [undefined, 0, -3, Number.NaN, "7"]) {
      expect(decide({ mfaGracePeriodDays })).toMatchObject({
        blocked: true,
        recordEnforcedAt: true,
      });
    }
  });

  it("allows a positive grace window from now when enforcement has not started", () => {
    expect(decide({ mfaGracePeriodDays: 7 })).toEqual({
      inScope: true,
      satisfied: false,
      blocked: false,
      recordEnforcedAt: true,
    });
  });

  it("allows until enforcedAt plus grace days, then blocks", () => {
    const enforcedAt = new Date("2026-06-01T00:00:00.000Z");
    const deadline = enforcedAt.getTime() + 7 * day;
    expect(
      decide({
        mfaEnforcedAt: enforcedAt,
        mfaGracePeriodDays: 7,
        now: new Date(deadline - 1),
      }),
    ).toMatchObject({ blocked: false, recordEnforcedAt: false });
    expect(
      decide({
        mfaEnforcedAt: enforcedAt,
        mfaGracePeriodDays: 7,
        now: new Date(deadline),
      }),
    ).toMatchObject({ blocked: true, recordEnforcedAt: false });
  });

  it("accepts a fractional grace period", () => {
    const enforcedAt = new Date(now.getTime() - Math.floor(0.5 * day));
    expect(
      decide({ mfaEnforcedAt: enforcedAt, mfaGracePeriodDays: 1 }),
    ).toMatchObject({ blocked: false });
    expect(
      decide({ mfaEnforcedAt: enforcedAt, mfaGracePeriodDays: 0.5 }),
    ).toMatchObject({ blocked: true });
  });

  it("treats an invalid enforcement timestamp as unset", () => {
    expect(
      decide({ mfaEnforcedAt: new Date(Number.NaN), mfaGracePeriodDays: 7 }),
    ).toMatchObject({ blocked: false, recordEnforcedAt: true });
  });
});

describe("mfaAccessDecision", () => {
  it("lets the enrolment page render and leaves auth enrolment open", () => {
    expect(
      mfaAccessDecision({
        blocked: true,
        pathname: "/account/security",
        serverAction: false,
      }),
    ).toBe("allow");
    expect(
      mfaAccessDecision({
        blocked: true,
        pathname: "/account/security/devices",
        serverAction: false,
      }),
    ).toBe("allow");
    expect(
      mfaAccessDecision({
        blocked: true,
        pathname: "/api/auth/two-factor/enable",
        serverAction: false,
      }),
    ).toBe("allow");
  });

  it("fails closed for API calls, server actions, and an unknown path", () => {
    expect(
      mfaAccessDecision({
        blocked: true,
        pathname: "/api/v1/tasks",
        serverAction: false,
      }),
    ).toBe("deny");
    expect(
      mfaAccessDecision({
        blocked: true,
        pathname: "/account/security",
        serverAction: true,
      }),
    ).toBe("deny");
    expect(
      mfaAccessDecision({
        blocked: true,
        pathname: null,
        serverAction: false,
      }),
    ).toBe("deny");
  });

  it("redirects other blocked pages", () => {
    expect(
      mfaAccessDecision({
        blocked: true,
        pathname: "/dashboard",
        serverAction: false,
      }),
    ).toBe("redirect");
    expect(
      mfaAccessDecision({
        blocked: false,
        pathname: "/dashboard",
        serverAction: false,
      }),
    ).toBe("allow");
  });
});

describe("MfaRequiredError", () => {
  it("uses a stable message", () => {
    const error = new MfaRequiredError();
    expect(error.message).toBe(MFA_REQUIRED_MESSAGE);
    expect(error.code).toBe("mfa_required");
    expect(error.name).toBe("MfaRequiredError");
  });
});
