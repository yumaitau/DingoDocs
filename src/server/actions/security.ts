"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { roles } from "@/lib/permissions/matrix";
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
} from "@/server/services/account-security";
import {
  placeLegalHold,
  purgeExpiredEvidence,
  releaseLegalHold,
} from "@/server/services/retention";

const id = z.string().uuid();

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
  await createSecureInvitation(context, {
    email: z.string().email().parse(formData.get("email")),
    role: z.enum(roles).parse(formData.get("role")),
  });
  revalidatePath("/settings");
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
