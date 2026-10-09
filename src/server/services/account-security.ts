import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, gt, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  auditEvents,
  organisationInvitations,
  organisationMembers,
  sessions,
  users,
} from "@/db/schema";
import { sendAuthenticationEmail } from "@/lib/email/send";
import { canGrantRole, type Role } from "@/lib/permissions/matrix";
import { emitDomainEvent } from "./domain-events";

export type SecurityActor = { organisationId: string; userId: string };

const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");

export async function listUserDevices(userId: string) {
  return db
    .select({
      id: sessions.id,
      userAgent: sessions.userAgent,
      ipAddress: sessions.ipAddress,
      createdAt: sessions.createdAt,
      updatedAt: sessions.updatedAt,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .where(and(eq(sessions.userId, userId), isNull(sessions.impersonatedBy)))
    .orderBy(desc(sessions.updatedAt));
}

export async function revokeOwnSession(
  actor: SecurityActor,
  sessionId: string,
) {
  const [revoked] = await db
    .delete(sessions)
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, actor.userId)))
    .returning({ id: sessions.id });
  if (!revoked) throw new Error("Session was not found");
  await db.insert(auditEvents).values({
    organisationId: actor.organisationId,
    actorId: actor.userId,
    action: "authentication.session.revoked",
    targetType: "session",
    targetId: revoked.id,
    metadata: { initiatedBy: "user" },
  });
}

export async function revokeOrganisationUserSessions(
  actor: SecurityActor,
  targetUserId: string,
) {
  const actorRole = await requireActorRole(actor);
  const [member] = await db
    .select({ id: organisationMembers.id, role: organisationMembers.role })
    .from(organisationMembers)
    .where(
      and(
        eq(organisationMembers.organisationId, actor.organisationId),
        eq(organisationMembers.userId, targetUserId),
        isNull(organisationMembers.deletedAt),
      ),
    )
    .limit(1);
  if (!member) throw new Error("User is not an active organisation member");
  if (!canGrantRole(actorRole, member.role as Role))
    throw new Error("Cannot revoke sessions for a more privileged member");
  const revoked = await db
    .delete(sessions)
    .where(eq(sessions.userId, targetUserId))
    .returning({ id: sessions.id });
  await db.insert(auditEvents).values({
    organisationId: actor.organisationId,
    actorId: actor.userId,
    action: "authentication.sessions.admin_revoked",
    targetType: "user",
    targetId: targetUserId,
    metadata: { sessionCount: revoked.length },
  });
  return revoked.length;
}

export async function listOrganisationUsers(organisationId: string) {
  const members = await db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      role: organisationMembers.role,
    })
    .from(organisationMembers)
    .innerJoin(users, eq(users.id, organisationMembers.userId))
    .where(
      and(
        eq(organisationMembers.organisationId, organisationId),
        isNull(organisationMembers.deletedAt),
      ),
    );
  const userIds = members.map((member) => member.userId);
  const activeSessions = userIds.length
    ? await db
        .select({ userId: sessions.userId, id: sessions.id })
        .from(sessions)
        .where(inArray(sessions.userId, userIds))
    : [];
  return members.map((member) => ({
    ...member,
    activeSessions: activeSessions.filter(
      (session) => session.userId === member.userId,
    ).length,
  }));
}

export async function createSecureInvitation(
  actor: SecurityActor,
  input: { email: string; role: typeof organisationMembers.$inferInsert.role },
) {
  const actorRole = await requireActorRole(actor);
  if (!canGrantRole(actorRole, input.role as Role))
    throw new Error("Cannot invite a more privileged role");
  const email = input.email.trim().toLowerCase();
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1_000);
  const [invitation] = await db
    .insert(organisationInvitations)
    .values({
      organisationId: actor.organisationId,
      email,
      role: input.role,
      tokenHash: hashToken(token),
      invitedBy: actor.userId,
      expiresAt,
    })
    .returning({ id: organisationInvitations.id });
  await db.insert(auditEvents).values({
    organisationId: actor.organisationId,
    actorId: actor.userId,
    action: "invitation.created",
    targetType: "invitation",
    targetId: invitation.id,
    metadata: { emailDomain: email.split("@")[1], role: input.role },
  });
  const baseURL = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
  await sendAuthenticationEmail({
    to: email,
    url: `${baseURL}/invite/${token}`,
    purpose: "invitation",
  });
  await emitDomainEvent({
    organisationId: actor.organisationId,
    actorUserId: actor.userId,
    eventType: "invitation.sent",
    title: "Invitation sent",
    actionUrl: "/team",
    payload: { invitationId: invitation.id, role: input.role },
  });
  return invitation;
}

export async function listPendingInvitations(organisationId: string) {
  return db
    .select({
      id: organisationInvitations.id,
      email: organisationInvitations.email,
      role: organisationInvitations.role,
      expiresAt: organisationInvitations.expiresAt,
    })
    .from(organisationInvitations)
    .where(
      and(
        eq(organisationInvitations.organisationId, organisationId),
        isNull(organisationInvitations.acceptedAt),
        isNull(organisationInvitations.revokedAt),
      ),
    )
    .orderBy(desc(organisationInvitations.createdAt));
}

export async function acceptSecureInvitation(
  user: { id: string; email: string },
  token: string,
) {
  return db.transaction(async (tx) => {
    const now = new Date();
    const [invitation] = await tx
      .update(organisationInvitations)
      .set({ acceptedAt: now })
      .where(
        and(
          eq(organisationInvitations.tokenHash, hashToken(token)),
          eq(organisationInvitations.email, user.email.trim().toLowerCase()),
          isNull(organisationInvitations.acceptedAt),
          isNull(organisationInvitations.revokedAt),
          gt(organisationInvitations.expiresAt, now),
        ),
      )
      .returning();
    if (!invitation)
      throw new Error(
        "Invitation is invalid, expired, or belongs to another user",
      );
    if (invitation.invitedBy) {
      const [inviter] = await tx
        .select({ role: organisationMembers.role })
        .from(organisationMembers)
        .where(
          and(
            eq(organisationMembers.organisationId, invitation.organisationId),
            eq(organisationMembers.userId, invitation.invitedBy),
            isNull(organisationMembers.deletedAt),
          ),
        )
        .limit(1);
      if (
        !inviter ||
        !canGrantRole(inviter.role as Role, invitation.role as Role)
      )
        throw new Error(
          "Invitation is invalid, expired, or belongs to another user",
        );
    }
    const [existing] = await tx
      .select({
        role: organisationMembers.role,
        deletedAt: organisationMembers.deletedAt,
      })
      .from(organisationMembers)
      .where(
        and(
          eq(organisationMembers.organisationId, invitation.organisationId),
          eq(organisationMembers.userId, user.id),
        ),
      )
      .limit(1);
    if (existing && !existing.deletedAt) {
      throw new Error("User is already a member of this organisation");
    }
    await tx
      .insert(organisationMembers)
      .values({
        organisationId: invitation.organisationId,
        userId: user.id,
        role: invitation.role,
        invitedBy: invitation.invitedBy,
        joinedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          organisationMembers.organisationId,
          organisationMembers.userId,
        ],
        set: { role: invitation.role, joinedAt: now, deletedAt: null },
      });
    await tx.insert(auditEvents).values({
      organisationId: invitation.organisationId,
      actorId: user.id,
      action: "invitation.accepted",
      targetType: "invitation",
      targetId: invitation.id,
      metadata: { role: invitation.role },
    });
    return invitation.organisationId;
  });
}

export async function revokeSecureInvitation(
  actor: SecurityActor,
  invitationId: string,
) {
  const [invitation] = await db
    .update(organisationInvitations)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(organisationInvitations.id, invitationId),
        eq(organisationInvitations.organisationId, actor.organisationId),
        isNull(organisationInvitations.acceptedAt),
        isNull(organisationInvitations.revokedAt),
      ),
    )
    .returning({ id: organisationInvitations.id });
  if (!invitation) throw new Error("Active invitation was not found");
  await db.insert(auditEvents).values({
    organisationId: actor.organisationId,
    actorId: actor.userId,
    action: "invitation.revoked",
    targetType: "invitation",
    targetId: invitation.id,
  });
}

export async function updateOrganisationMemberRole(
  actor: SecurityActor,
  input: { userId: string; role: Role },
) {
  const actorRole = await requireActorRole(actor);
  if (input.userId === actor.userId)
    throw new Error("Cannot change your own role");
  if (!canGrantRole(actorRole, input.role))
    throw new Error("Cannot assign a more privileged role");
  const [member] = await db
    .select({
      id: organisationMembers.id,
      role: organisationMembers.role,
    })
    .from(organisationMembers)
    .where(
      and(
        eq(organisationMembers.organisationId, actor.organisationId),
        eq(organisationMembers.userId, input.userId),
        isNull(organisationMembers.deletedAt),
      ),
    )
    .limit(1);
  if (!member) throw new Error("User is not an active organisation member");
  if (!canGrantRole(actorRole, member.role as Role))
    throw new Error("Cannot change a more privileged member");
  if (
    member.role === "organisation_owner" &&
    input.role !== "organisation_owner"
  ) {
    const owners = await db
      .select({ id: organisationMembers.id })
      .from(organisationMembers)
      .where(
        and(
          eq(organisationMembers.organisationId, actor.organisationId),
          eq(organisationMembers.role, "organisation_owner"),
          isNull(organisationMembers.deletedAt),
        ),
      );
    if (owners.length <= 1)
      throw new Error("Cannot demote the last organisation owner");
  }
  const [updated] = await db
    .update(organisationMembers)
    .set({ role: input.role })
    .where(eq(organisationMembers.id, member.id))
    .returning({ id: organisationMembers.id, role: organisationMembers.role });
  await db.insert(auditEvents).values({
    organisationId: actor.organisationId,
    actorId: actor.userId,
    action: "organisation.member.role_changed",
    targetType: "user",
    targetId: input.userId,
    metadata: { from: member.role, to: input.role },
  });
  return updated;
}

async function requireActorRole(actor: SecurityActor) {
  const [membership] = await db
    .select({ role: organisationMembers.role })
    .from(organisationMembers)
    .where(
      and(
        eq(organisationMembers.organisationId, actor.organisationId),
        eq(organisationMembers.userId, actor.userId),
        isNull(organisationMembers.deletedAt),
      ),
    )
    .limit(1);
  if (!membership) throw new Error("User is not an active organisation member");
  return membership.role as Role;
}
