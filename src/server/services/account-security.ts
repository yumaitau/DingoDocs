import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  auditEvents,
  organisationInvitations,
  organisationMembers,
  sessions,
  users,
} from "@/db/schema";
import { sendAuthenticationEmail } from "@/lib/email/send";

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
  const [member] = await db
    .select({ id: organisationMembers.id })
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
  const now = new Date();
  const [invitation] = await db
    .select()
    .from(organisationInvitations)
    .where(eq(organisationInvitations.tokenHash, hashToken(token)))
    .limit(1);
  if (
    !invitation ||
    invitation.acceptedAt ||
    invitation.revokedAt ||
    invitation.expiresAt <= now ||
    invitation.email !== user.email.trim().toLowerCase()
  )
    throw new Error(
      "Invitation is invalid, expired, or belongs to another user",
    );
  await db.transaction(async (tx) => {
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
    await tx
      .update(organisationInvitations)
      .set({ acceptedAt: now })
      .where(
        and(
          eq(organisationInvitations.id, invitation.id),
          isNull(organisationInvitations.acceptedAt),
          isNull(organisationInvitations.revokedAt),
        ),
      );
    await tx.insert(auditEvents).values({
      organisationId: invitation.organisationId,
      actorId: user.id,
      action: "invitation.accepted",
      targetType: "invitation",
      targetId: invitation.id,
      metadata: { role: invitation.role },
    });
  });
  return invitation.organisationId;
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
