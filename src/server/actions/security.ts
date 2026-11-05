"use server";

import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { organisations, type SecurityPolicy } from "@/db/schema";
import { recordAudit } from "@/lib/audit/log";
import { MFA_MODES } from "@/lib/auth/mfa-modes";
import { requireSession } from "@/lib/auth/session";
import { encryptIntegrationSecret } from "@/lib/integrations/crypto";
import { canGrantRole, roles, type Role } from "@/lib/permissions/matrix";
import {
  requireOrganisationContext,
  requirePermission,
} from "@/lib/permissions/require";
import {
  acceptSecureInvitation,
  createSecureInvitation,
  revokeOrganisationUserSessions,
  revokeOwnSession,
  revokeSecureInvitation,
  updateOrganisationMemberRole,
} from "@/server/services/account-security";
import { saveJiraConnection, testJiraConnection } from "@/server/services/jira";
import {
  placeLegalHold,
  purgeExpiredEvidence,
  releaseLegalHold,
} from "@/server/services/retention";
import { createScimToken, parseScimGroupRoles } from "@/server/services/scim";
import {
  addScimDomain,
  removeScimDomain,
  scimDomainTxtName,
  scimDomainTxtValue,
  verifyScimDomain,
} from "@/server/services/domain-verification";
import { userFacingError } from "@/lib/errors";

const id = z.string().uuid();

/**
 * Audit-safe view of the SSO policy: never the raw certificate or client
 * secret, only a certificate fingerprint and the entry point host.
 */
function ssoAuditSummary(policy: SecurityPolicy): Record<string, unknown> {
  const sso = policy.sso;
  let entryPointHost: string | null = null;
  if (sso?.entryPoint) {
    try {
      entryPointHost = new URL(sso.entryPoint).host;
    } catch {
      entryPointHost = "(invalid URL)";
    }
  }
  return {
    protocol: sso?.protocol ?? null,
    issuer: sso?.issuer ?? null,
    clientId: sso?.clientId ?? null,
    entryPointHost,
    certificateSha256: sso?.certificate
      ? createHash("sha256").update(sso.certificate.trim()).digest("hex")
      : null,
    confidentialClient: Boolean(sso?.clientSecretEncrypted),
    groupRoles: sso?.groupRoles ?? null,
    scimGroupRoles: policy.scimGroupRoles ?? null,
  };
}

export type SettingsSecretState = {
  secret?: string;
  message?: string;
  error?: string;
};

export async function revokeOwnSessionAction(formData: FormData) {
  const context = await requireOrganisationContext();
  await revokeOwnSession(context, id.parse(formData.get("sessionId")));
  revalidatePath("/account/security");
}

export async function revokeUserSessionsAction(formData: FormData) {
  const context = await requirePermission("user:manage");
  await revokeOrganisationUserSessions(
    context,
    id.parse(formData.get("userId")),
  );
  revalidatePath("/settings");
}

export async function createInvitationAction(formData: FormData) {
  const context = await requirePermission("user:manage");
  const role = z.enum(roles).parse(formData.get("role"));
  if (!canGrantRole(context.role as Role, role))
    throw new Error("Cannot invite a more privileged role");
  await createSecureInvitation(context, {
    email: z.string().email().parse(formData.get("email")),
    role,
  });
  revalidatePath("/settings");
}

export async function updateMemberRoleAction(formData: FormData) {
  const context = await requirePermission("user:manage");
  await updateOrganisationMemberRole(context, {
    userId: id.parse(formData.get("userId")),
    role: z.enum(roles).parse(formData.get("role")),
  });
  revalidatePath("/settings");
  revalidatePath("/team");
}

export async function revokeInvitationAction(formData: FormData) {
  const context = await requirePermission("user:manage");
  await revokeSecureInvitation(context, id.parse(formData.get("invitationId")));
  revalidatePath("/settings");
}

export async function acceptInvitationAction(token: string) {
  const session = await requireSession();
  await acceptSecureInvitation(session.user, z.string().min(20).parse(token));
  redirect("/dashboard");
}

export async function placeLegalHoldAction(formData: FormData) {
  const context = await requirePermission("user:manage");
  await placeLegalHold(context, {
    evidenceId: id.parse(formData.get("evidenceId")),
    reason: z.string().trim().min(4).max(500).parse(formData.get("reason")),
  });
  revalidatePath("/settings");
}

export async function releaseLegalHoldAction(formData: FormData) {
  const context = await requirePermission("user:manage");
  await releaseLegalHold(context, id.parse(formData.get("holdId")));
  revalidatePath("/settings");
}

export async function purgeRetentionAction(formData: FormData) {
  const context = await requirePermission("user:manage");
  await purgeExpiredEvidence(context.organisationId, {
    actorId: context.userId,
    confirmation: z.string().parse(formData.get("confirmation")),
  });
  revalidatePath("/settings");
}

export async function updateDataRegionAction(formData: FormData) {
  const context = await requirePermission("user:manage");
  const dataRegion = z
    .string()
    .trim()
    .min(2)
    .max(64)
    .default("ap-southeast-2")
    .parse(formData.get("dataRegion") || "ap-southeast-2");
  const previous = await db.transaction(async (tx) => {
    const [org] = await tx
      .select({ dataRegion: organisations.dataRegion })
      .from(organisations)
      .where(eq(organisations.id, context.organisationId))
      .limit(1)
      .for("update");
    await tx
      .update(organisations)
      .set({ dataRegion, updatedAt: new Date() })
      .where(eq(organisations.id, context.organisationId));
    return org?.dataRegion ?? null;
  });
  await recordAudit({
    organisationId: context.organisationId,
    actorId: context.userId,
    action: "organisation.data_region.updated",
    targetType: "organisation",
    targetId: context.organisationId,
    metadata: { from: previous, to: dataRegion },
  });
  revalidatePath("/settings");
}

export type MfaPolicyState = { message?: string; error?: string };

export async function saveMfaPolicyAction(
  _state: MfaPolicyState,
  formData: FormData,
): Promise<MfaPolicyState> {
  try {
    const context = await requirePermission("user:manage");
    const mfaMode = z
      .enum(MFA_MODES, { message: "Choose a valid MFA requirement" })
      .parse(formData.get("mfaMode"));
    const mfaGracePeriodDays = z.coerce
      .number({ message: "Grace period must be a number of days" })
      .int("Grace period must be a whole number of days")
      .min(0, "Grace period must be between 0 and 30 days")
      .max(30, "Grace period must be between 0 and 30 days")
      .parse(formData.get("mfaGracePeriodDays") || 0);
    const previous = await db.transaction(async (tx) => {
      const [org] = await tx
        .select({ securityPolicy: organisations.securityPolicy })
        .from(organisations)
        .where(eq(organisations.id, context.organisationId))
        .limit(1)
        .for("update");
      const current = (org?.securityPolicy ?? {}) as SecurityPolicy;
      await tx
        .update(organisations)
        .set({
          securityPolicy: { ...current, mfaMode, mfaGracePeriodDays },
          updatedAt: new Date(),
        })
        .where(eq(organisations.id, context.organisationId));
      return current;
    });
    await recordAudit({
      organisationId: context.organisationId,
      actorId: context.userId,
      action: "organisation.mfa_policy.updated",
      targetType: "organisation",
      targetId: context.organisationId,
      previousValues: {
        mfaMode: previous.mfaMode ?? null,
        mfaGracePeriodDays: previous.mfaGracePeriodDays ?? null,
      },
      newValues: { mfaMode, mfaGracePeriodDays },
    });
    revalidatePath("/settings");
    return { message: "MFA requirement saved." };
  } catch (error) {
    return { error: userFacingError(error, "Could not save MFA requirement") };
  }
}

export async function saveJiraConnectionAction(
  _state: SettingsSecretState,
  formData: FormData,
): Promise<SettingsSecretState> {
  try {
    const context = await requirePermission("integration:configure");
    await saveJiraConnection(context, {
      baseUrl: z.string().url().parse(formData.get("baseUrl")),
      email: z.string().email().parse(formData.get("email")),
      apiToken: z.string().min(8).parse(formData.get("apiToken")),
      projectKey: z
        .string()
        .trim()
        .max(32)
        .optional()
        .parse(formData.get("projectKey") || undefined),
      issueType: z
        .string()
        .trim()
        .max(64)
        .optional()
        .parse(formData.get("issueType") || undefined),
      enabled: formData.get("enabled") === "on",
    });
    revalidatePath("/settings");
    return { message: "Jira connection saved." };
  } catch (error) {
    return {
      error: userFacingError(error, "Could not save Jira connection"),
    };
  }
}

export async function testJiraConnectionAction(): Promise<SettingsSecretState> {
  try {
    const context = await requirePermission("integration:configure");
    const result = await testJiraConnection(context);
    return {
      message: `Jira OK${result.displayName ? `: ${result.displayName}` : ""}`,
    };
  } catch (error) {
    return {
      error: userFacingError(error, "Jira connection test failed"),
    };
  }
}

export async function createScimTokenAction(
  _state: SettingsSecretState,
  formData: FormData,
): Promise<SettingsSecretState> {
  try {
    const context = await requirePermission("integration:configure");
    void formData;
    const token = await createScimToken(context);
    revalidatePath("/settings");
    return {
      secret: token.token,
      message: "Copy this SCIM bearer token now. It cannot be shown again.",
    };
  } catch (error) {
    return {
      error: userFacingError(error, "Could not create SCIM token"),
    };
  }
}

const scimDomainInput = z.string().trim().min(1, "Enter a domain").max(253);

export async function addScimDomainAction(
  _state: SettingsSecretState,
  formData: FormData,
): Promise<SettingsSecretState> {
  try {
    const context = await requirePermission("integration:configure");
    const entry = await addScimDomain(
      context,
      scimDomainInput.parse(formData.get("domain")),
    );
    revalidatePath("/settings");
    return {
      message: `Create a TXT record ${scimDomainTxtName(entry.domain)} with value ${scimDomainTxtValue(entry.token)}, then select Verify.`,
    };
  } catch (error) {
    return { error: userFacingError(error, "Could not add SCIM domain") };
  }
}

export async function verifyScimDomainAction(
  _state: SettingsSecretState,
  formData: FormData,
): Promise<SettingsSecretState> {
  try {
    const context = await requirePermission("integration:configure");
    const entry = await verifyScimDomain(
      context,
      scimDomainInput.parse(formData.get("domain")),
    );
    revalidatePath("/settings");
    return { message: `${entry.domain} is verified for SCIM provisioning.` };
  } catch (error) {
    return { error: userFacingError(error, "Could not verify SCIM domain") };
  }
}

export async function removeScimDomainAction(
  _state: SettingsSecretState,
  formData: FormData,
): Promise<SettingsSecretState> {
  try {
    const context = await requirePermission("integration:configure");
    await removeScimDomain(
      context,
      scimDomainInput.parse(formData.get("domain")),
    );
    revalidatePath("/settings");
    return { message: "SCIM domain removed." };
  } catch (error) {
    return { error: userFacingError(error, "Could not remove SCIM domain") };
  }
}

export async function saveSsoPolicyAction(
  _state: SettingsSecretState,
  formData: FormData,
): Promise<SettingsSecretState> {
  try {
    const context = await requirePermission("integration:configure");
    const protocol = z.enum(["oidc", "saml"]).parse(formData.get("protocol"));
    const issuer = z
      .string()
      .trim()
      .min(2)
      .max(500)
      .parse(formData.get("issuer"));
    const clientId = z
      .string()
      .trim()
      .min(1)
      .max(200)
      .parse(formData.get("clientId"));
    const clientSecret = z
      .string()
      .optional()
      .parse(formData.get("clientSecret") || undefined);
    const entryPoint = z
      .string()
      .optional()
      .parse(formData.get("entryPoint") || undefined);
    const certificate = z
      .string()
      .optional()
      .parse(formData.get("certificate") || undefined);
    const scimGroupRolesRaw = z
      .string()
      .optional()
      .parse(formData.get("scimGroupRoles") || undefined);
    const groupRolesRaw = z
      .string()
      .optional()
      .parse(formData.get("groupRoles") || undefined);

    // Same rules as SCIM: valid, non-protected roles the actor may grant.
    const parsedScimGroupRoles = scimGroupRolesRaw
      ? parseScimGroupRoles(scimGroupRolesRaw, context.role as Role)
      : undefined;
    const parsedGroupRoles = groupRolesRaw
      ? parseScimGroupRoles(groupRolesRaw, context.role as Role)
      : undefined;

    // Lock the row so a concurrent SCIM-domain change is not overwritten.
    const { before, after } = await db.transaction(async (tx) => {
      const [org] = await tx
        .select({ securityPolicy: organisations.securityPolicy })
        .from(organisations)
        .where(eq(organisations.id, context.organisationId))
        .limit(1)
        .for("update");
      const current = (org?.securityPolicy ?? {}) as SecurityPolicy;
      const scimGroupRoles = parsedScimGroupRoles ?? current.scimGroupRoles;
      const groupRoles = parsedGroupRoles ?? current.sso?.groupRoles;

      const next: SecurityPolicy = {
        ...current,
        scimGroupRoles,
        sso: {
          protocol,
          issuer,
          clientId,
          clientSecretEncrypted: clientSecret
            ? encryptIntegrationSecret(clientSecret)
            : current.sso?.clientSecretEncrypted,
          entryPoint: entryPoint || current.sso?.entryPoint,
          certificate: certificate || current.sso?.certificate,
          groupRoles,
        },
      };
      await tx
        .update(organisations)
        .set({ securityPolicy: next, updatedAt: new Date() })
        .where(eq(organisations.id, context.organisationId));
      return { before: current, after: next };
    });
    const previousSummary = ssoAuditSummary(before);
    const nextSummary = ssoAuditSummary(after);
    await recordAudit({
      organisationId: context.organisationId,
      actorId: context.userId,
      action: "organisation.sso_policy.updated",
      targetType: "organisation",
      targetId: context.organisationId,
      metadata: {
        changed: Object.keys(nextSummary).filter(
          (field) =>
            JSON.stringify(previousSummary[field]) !==
            JSON.stringify(nextSummary[field]),
        ),
        // Key names avoid "secret" so audit redaction keeps the boolean.
        oidcClientRotated: Boolean(clientSecret),
      },
      previousValues: previousSummary,
      newValues: nextSummary,
    });
    revalidatePath("/settings");
    return {
      message:
        protocol === "oidc"
          ? "Per-org OIDC config stored. Deployment-wide env providers still apply; this config is for ACS/login redirect wiring."
          : "Per-org SAML config saved. ACS is /api/auth/saml/acs.",
    };
  } catch (error) {
    return {
      error: userFacingError(error, "Could not save SSO policy"),
    };
  }
}
