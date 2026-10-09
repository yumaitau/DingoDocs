"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { organisations, type SecurityPolicy } from "@/db/schema";
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
import {
  saveJiraConnection,
  testJiraConnection,
} from "@/server/services/jira";
import {
  placeLegalHold,
  purgeExpiredEvidence,
  releaseLegalHold,
} from "@/server/services/retention";
import { createScimToken } from "@/server/services/scim";

const id = z.string().uuid();

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
  await db
    .update(organisations)
    .set({ dataRegion, updatedAt: new Date() })
    .where(eq(organisations.id, context.organisationId));
  revalidatePath("/settings");
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
      error:
        error instanceof Error ? error.message : "Could not save Jira connection",
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
      error:
        error instanceof Error ? error.message : "Jira connection test failed",
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
      error:
        error instanceof Error ? error.message : "Could not create SCIM token",
    };
  }
}

export async function saveSsoPolicyAction(
  _state: SettingsSecretState,
  formData: FormData,
): Promise<SettingsSecretState> {
  try {
    const context = await requirePermission("integration:configure");
    const protocol = z.enum(["oidc", "saml"]).parse(formData.get("protocol"));
    const issuer = z.string().trim().min(2).max(500).parse(formData.get("issuer"));
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

    const [org] = await db
      .select({ securityPolicy: organisations.securityPolicy })
      .from(organisations)
      .where(eq(organisations.id, context.organisationId))
      .limit(1);
    const current = (org?.securityPolicy ?? {}) as SecurityPolicy;
    const scimGroupRoles = scimGroupRolesRaw
      ? (JSON.parse(scimGroupRolesRaw) as Record<string, string>)
      : current.scimGroupRoles;
    const groupRoles = groupRolesRaw
      ? (JSON.parse(groupRolesRaw) as Record<string, string>)
      : current.sso?.groupRoles;

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
    await db
      .update(organisations)
      .set({ securityPolicy: next, updatedAt: new Date() })
      .where(eq(organisations.id, context.organisationId));
    revalidatePath("/settings");
    return {
      message:
        protocol === "oidc"
          ? "Per-org OIDC config stored. Deployment-wide env providers still apply; this config is for ACS/login redirect wiring."
          : "Per-org SAML config saved. ACS is /api/auth/saml/acs.",
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Could not save SSO policy",
    };
  }
}
