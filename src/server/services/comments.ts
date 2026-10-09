import "server-only";

import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  commentRevisions,
  comments,
  organisationMembers,
  users,
} from "@/db/schema";
import { emitDomainEvent } from "./domain-events";

export type CommentActor = { organisationId: string; userId: string };

export type CommentTargetType = "finding" | "report";

export type CommentVisibility = "private" | "team" | "client";

export class CommentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommentError";
  }
}

const mentionPattern = /@([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;

export type CommentRecord = {
  id: string;
  organisationId: string;
  targetType: string;
  targetId: string;
  body: string;
  visibility: string;
  parentId: string | null;
  mentions: string[];
  authorId: string | null;
  createdAt: Date;
  editedAt: Date | null;
};

export type ThreadedComment = CommentRecord & { replies: CommentRecord[] };

export async function createComment(
  actor: CommentActor,
  input: {
    targetType: CommentTargetType;
    targetId: string;
    body: string;
    visibility: CommentVisibility;
    title?: string;
    actionUrl?: string;
  },
) {
  const body = input.body.trim();
  if (!body) throw new CommentError("Comment body is required");
  const mentions = await resolveMentions(actor.organisationId, body);
  const [comment] = await db
    .insert(comments)
    .values({
      organisationId: actor.organisationId,
      targetType: input.targetType,
      targetId: input.targetId,
      body,
      visibility: input.visibility,
      mentions,
      authorId: actor.userId,
    })
    .returning();
  if (!comment) throw new CommentError("Comment could not be created");
  if (input.visibility !== "private") {
    await emitDomainEvent({
      organisationId: actor.organisationId,
      actorUserId: actor.userId,
      eventType: "comment.created",
      title: (input.title ?? "Comment added").slice(0, 160),
      actionUrl: input.actionUrl,
      payload: {
        commentId: comment.id,
        targetType: input.targetType,
        targetId: input.targetId,
        visibility: input.visibility,
      },
    });
  }
  return comment as CommentRecord;
}

export async function replyComment(
  actor: CommentActor,
  input: {
    parentId: string;
    body: string;
    targetType?: CommentTargetType;
    targetId?: string;
    visibility?: CommentVisibility;
    title?: string;
    actionUrl?: string;
  },
) {
  const body = input.body.trim();
  if (!body) throw new CommentError("Comment body is required");
  const parent = await requireComment(actor.organisationId, input.parentId);
  const rootParentId = parent.parentId ?? parent.id;
  const root = parent.parentId
    ? await requireComment(actor.organisationId, parent.parentId)
    : parent;
  if (
    (input.targetType && root.targetType !== input.targetType) ||
    (input.targetId && root.targetId !== input.targetId)
  ) {
    throw new CommentError("Reply parent must belong to the same target");
  }
  const visibility = input.visibility ?? (root.visibility as CommentVisibility);
  const mentions = await resolveMentions(actor.organisationId, body);
  const [comment] = await db
    .insert(comments)
    .values({
      organisationId: actor.organisationId,
      targetType: root.targetType,
      targetId: root.targetId,
      body,
      visibility,
      parentId: rootParentId,
      mentions,
      authorId: actor.userId,
    })
    .returning();
  if (!comment) throw new CommentError("Comment could not be created");
  const title = (input.title ?? "Comment reply").slice(0, 160);
  if (visibility !== "private") {
    await emitDomainEvent({
      organisationId: actor.organisationId,
      actorUserId: actor.userId,
      eventType: "comment.created",
      title,
      actionUrl: input.actionUrl,
      payload: {
        commentId: comment.id,
        parentId: rootParentId,
        targetType: root.targetType,
        targetId: root.targetId,
        visibility,
      },
    });
  }
  await emitDomainEvent({
    organisationId: actor.organisationId,
    actorUserId: actor.userId,
    eventType: "comment.replied",
    title,
    actionUrl: input.actionUrl,
    clientSafe: true,
    payload: {
      commentId: comment.id,
      parentId: rootParentId,
      targetType: root.targetType,
      targetId: root.targetId,
      visibility,
    },
  });
  return comment as CommentRecord;
}

export async function editComment(
  actor: CommentActor,
  input: { commentId: string; body: string },
) {
  const body = input.body.trim();
  if (!body) throw new CommentError("Comment body is required");
  const current = await requireComment(actor.organisationId, input.commentId);
  if (current.authorId !== actor.userId) {
    throw new CommentError("Only the author can edit this comment");
  }
  const mentions = await resolveMentions(actor.organisationId, body);
  await db.insert(commentRevisions).values({
    organisationId: actor.organisationId,
    commentId: current.id,
    body: current.body,
    editedBy: actor.userId,
  });
  const [updated] = await db
    .update(comments)
    .set({
      body,
      mentions,
      editedAt: new Date(),
    })
    .where(
      and(
        eq(comments.id, current.id),
        eq(comments.organisationId, actor.organisationId),
      ),
    )
    .returning();
  if (!updated) throw new CommentError("Comment could not be updated");
  return updated as CommentRecord;
}

export async function listComments(
  actor: CommentActor,
  input: {
    targetType: CommentTargetType;
    targetId: string;
    visibility?: CommentVisibility | CommentVisibility[];
  },
): Promise<ThreadedComment[]> {
  const visibility = input.visibility
    ? Array.isArray(input.visibility)
      ? input.visibility
      : [input.visibility]
    : undefined;
  const rows = await db
    .select({
      id: comments.id,
      organisationId: comments.organisationId,
      targetType: comments.targetType,
      targetId: comments.targetId,
      body: comments.body,
      visibility: comments.visibility,
      parentId: comments.parentId,
      mentions: comments.mentions,
      authorId: comments.authorId,
      createdAt: comments.createdAt,
      editedAt: comments.editedAt,
    })
    .from(comments)
    .where(
      and(
        eq(comments.organisationId, actor.organisationId),
        eq(comments.targetType, input.targetType),
        eq(comments.targetId, input.targetId),
        isNull(comments.deletedAt),
        visibility ? inArray(comments.visibility, visibility) : undefined,
      ),
    )
    .orderBy(asc(comments.createdAt));
  const records = rows as CommentRecord[];
  const roots = records.filter((row) => !row.parentId);
  return roots.map((root) => ({
    ...root,
    replies: records.filter((row) => row.parentId === root.id),
  }));
}

export function parseMentionEmails(body: string): string[] {
  const emails = new Set<string>();
  for (const match of body.matchAll(mentionPattern)) {
    const email = match[1]?.trim().toLowerCase();
    if (email) emails.add(email);
  }
  return [...emails];
}

async function resolveMentions(organisationId: string, body: string) {
  const emails = parseMentionEmails(body);
  if (!emails.length) return [] as string[];
  const members = await db
    .select({ email: users.email })
    .from(organisationMembers)
    .innerJoin(users, eq(users.id, organisationMembers.userId))
    .where(
      and(
        eq(organisationMembers.organisationId, organisationId),
        isNull(organisationMembers.deletedAt),
        sql`lower(${users.email}) in (${sql.join(
          emails.map((email) => sql`${email}`),
          sql`, `,
        )})`,
      ),
    );
  return [
    ...new Set(
      members
        .map((member) => member.email.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
}

async function requireComment(organisationId: string, commentId: string) {
  const [row] = await db
    .select({
      id: comments.id,
      organisationId: comments.organisationId,
      targetType: comments.targetType,
      targetId: comments.targetId,
      body: comments.body,
      visibility: comments.visibility,
      parentId: comments.parentId,
      mentions: comments.mentions,
      authorId: comments.authorId,
      createdAt: comments.createdAt,
      editedAt: comments.editedAt,
    })
    .from(comments)
    .where(
      and(
        eq(comments.id, commentId),
        eq(comments.organisationId, organisationId),
        isNull(comments.deletedAt),
      ),
    )
    .limit(1);
  if (!row) throw new CommentError("Comment was not found");
  return row as CommentRecord;
}
