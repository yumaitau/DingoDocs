import "server-only";

import { createHash } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import sharp from "sharp";
import { db } from "@/db";
import {
  assetEvidence,
  auditEvents,
  backgroundJobs,
  engagements,
  evidence,
  evidenceAnnotations,
} from "@/db/schema";
import {
  portalEngagementQuery,
  requirePortalEngagement,
} from "@/lib/permissions/portal";
import { hasPermission, type Role } from "@/lib/permissions/matrix";
import {
  validateContentSignature,
  validateUpload,
} from "@/lib/security/upload";
import { storage } from "@/lib/storage";
import type { StorageProvider } from "@/lib/storage/types";

export type EvidenceActor = {
  organisationId: string;
  userId: string;
  canViewRestricted?: boolean;
  clientIds?: string[];
  engagementIds?: string[];
};

export type AnnotationOperation =
  | { type: "crop"; left: number; top: number; width: number; height: number }
  | {
      type: "blur";
      left?: number;
      top?: number;
      width?: number;
      height?: number;
      sigma?: number;
    }
  | {
      type: "redaction" | "highlight" | "rectangle" | "ellipse";
      left: number;
      top: number;
      width: number;
      height: number;
      colour?: string;
    }
  | {
      type: "drawing";
      points: Array<{ x: number; y: number }>;
      colour?: string;
    }
  | { type: "text"; x: number; y: number; text: string; colour?: string }
  | { type: "callout"; x: number; y: number; number: number; colour?: string };

export class EvidenceScopeError extends Error {
  constructor(
    message = "Evidence is not available in the active organisation",
  ) {
    super(message);
    this.name = "EvidenceScopeError";
  }
}

export class EvidenceDuplicateError extends Error {
  constructor(readonly evidenceId: string) {
    super(`Duplicate evidence already exists: ${evidenceId}`);
    this.name = "EvidenceDuplicateError";
  }
}

export async function uploadEvidence(
  actor: EvidenceActor,
  input: {
    engagementId: string;
    filename: string;
    mediaType: string;
    bytes: Uint8Array;
    classification: "internal" | "restricted" | "client_visible";
    restrictionReason?: string;
    restrictedUserIds?: string[];
    retentionUntil?: Date;
    replaceEvidenceId?: string;
    assetIds?: string[];
    allowDuplicate?: boolean;
  },
  provider: StorageProvider = storage(),
) {
  if (actor.clientIds)
    await requirePortalEngagement(actor, input.engagementId, true);
  const upload = validateUpload({
    size: input.bytes.byteLength,
    mediaType: input.mediaType,
    filename: input.filename,
  });
  validateContentSignature(input.bytes, input.mediaType);
  const sha256 = createHash("sha256").update(input.bytes).digest("hex");

  const [engagement] = await db
    .select({ id: engagements.id, clientId: engagements.clientId })
    .from(engagements)
    .where(
      and(
        eq(engagements.id, input.engagementId),
        eq(engagements.organisationId, actor.organisationId),
        isNull(engagements.deletedAt),
      ),
    )
    .limit(1);
  if (!engagement) throw new EvidenceScopeError();
  assertActorScope(actor, engagement.clientId, input.engagementId);

  const [duplicate] = await db
    .select({ id: evidence.id })
    .from(evidence)
    .where(
      and(
        eq(evidence.organisationId, actor.organisationId),
        eq(evidence.engagementId, input.engagementId),
        eq(evidence.sha256, sha256),
        isNull(evidence.deletedAt),
      ),
    )
    .limit(1);
  if (duplicate && !input.allowDuplicate && !input.replaceEvidenceId) {
    throw new EvidenceDuplicateError(duplicate.id);
  }

  let parentId: string | null = null;
  let version = 1;
  if (input.replaceEvidenceId) {
    const [parent] = await db
      .select({
        id: evidence.id,
        parentId: evidence.parentId,
        version: evidence.version,
      })
      .from(evidence)
      .where(
        and(
          eq(evidence.id, input.replaceEvidenceId),
          eq(evidence.organisationId, actor.organisationId),
          eq(evidence.engagementId, input.engagementId),
          isNull(evidence.deletedAt),
        ),
      )
      .limit(1);
    if (!parent) throw new EvidenceScopeError();
    parentId = parent.parentId ?? parent.id;
    const [latest] = await db
      .select({ version: evidence.version })
      .from(evidence)
      .where(
        and(
          eq(evidence.organisationId, actor.organisationId),
          eq(evidence.parentId, parentId),
          isNull(evidence.deletedAt),
        ),
      )
      .orderBy(desc(evidence.version))
      .limit(1);
    version = Math.max(parent.version, latest?.version ?? 0) + 1;
  }

  const storageKey = `${actor.organisationId}/${engagement.clientId}/${input.engagementId}/${upload.storageKey}`;
  const stored = await provider.put({
    key: storageKey,
    body: input.bytes,
    mediaType: input.mediaType,
    expectedSize: input.bytes.byteLength,
  });
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(evidence)
        .values({
          organisationId: actor.organisationId,
          clientId: engagement.clientId,
          engagementId: input.engagementId,
          parentId,
          originalFilename: upload.safeName,
          storageProvider: provider.name,
          storageKey: stored.key,
          mediaType: input.mediaType.toLowerCase(),
          sizeBytes: stored.size,
          sha256: stored.sha256,
          uploadedBy: actor.userId,
          classification: input.classification,
          restrictions: {
            reason: input.restrictionReason,
            userIds: input.restrictedUserIds,
          },
          retentionUntil: input.retentionUntil,
          version,
          malwareScanStatus: "pending",
        })
        .returning();
      if (!row) throw new Error("Unable to persist evidence");
      if (input.assetIds?.length) {
        const validAssets = await tx.query.assets.findMany({
          columns: { id: true },
          where: (
            asset,
            { and: all, eq: equal, inArray: within, isNull: empty },
          ) =>
            all(
              equal(asset.organisationId, actor.organisationId),
              equal(asset.engagementId, input.engagementId),
              within(asset.id, [...new Set(input.assetIds)]),
              empty(asset.deletedAt),
            ),
        });
        if (validAssets.length !== new Set(input.assetIds).size)
          throw new EvidenceScopeError(
            "One or more linked assets are unavailable",
          );
        await tx.insert(assetEvidence).values(
          validAssets.map((asset) => ({
            organisationId: actor.organisationId,
            assetId: asset.id,
            evidenceId: row.id,
          })),
        );
      }
      await tx.insert(backgroundJobs).values({
        organisationId: actor.organisationId,
        type: "evidence.scan",
        payload: { evidenceId: row.id },
        idempotencyKey: `evidence.scan:${row.id}`,
      });
      await tx.insert(auditEvents).values({
        organisationId: actor.organisationId,
        actorId: actor.userId,
        action: "evidence.uploaded",
        targetType: "evidence",
        targetId: row.id,
        metadata: {
          engagementId: input.engagementId,
          classification: input.classification,
          sha256: stored.sha256,
          version,
        },
      });
      return row;
    });
  } catch (error) {
    await provider.delete(stored.key);
    throw error;
  }
}

export async function getEvidenceForAccess(
  actor: EvidenceActor,
  evidenceId: string,
) {
  const [row] = await db
    .select()
    .from(evidence)
    .where(
      and(
        eq(evidence.id, evidenceId),
        eq(evidence.organisationId, actor.organisationId),
        isNull(evidence.deletedAt),
      ),
    )
    .limit(1);
  if (!row) throw new EvidenceScopeError();
  assertActorScope(actor, row.clientId, row.engagementId);
  if (actor.clientIds && row.classification !== "client_visible")
    throw new EvidenceScopeError("Evidence is not client visible");
  if (row.classification === "restricted" && !actor.canViewRestricted) {
    throw new EvidenceScopeError("Restricted evidence permission is required");
  }
  const restrictedUsers = row.restrictions.userIds ?? [];
  if (
    restrictedUsers.length &&
    !restrictedUsers.includes(actor.userId) &&
    row.uploadedBy !== actor.userId
  ) {
    throw new EvidenceScopeError("Evidence is restricted to named users");
  }
  if (row.quarantinedAt || row.malwareScanStatus === "infected") {
    throw new EvidenceScopeError("Evidence is quarantined");
  }
  return row;
}

export async function scopedEvidenceActor(input: {
  organisationId: string;
  userId: string;
  roles: Role[];
}): Promise<EvidenceActor> {
  const actor: EvidenceActor = {
    organisationId: input.organisationId,
    userId: input.userId,
    canViewRestricted: input.roles.some((role) =>
      hasPermission(role, "evidence:view_restricted"),
    ),
  };
  const internalRole = input.roles.some(
    (role) => role !== "client_administrator" && role !== "client_user",
  );
  if (internalRole) return actor;
  const grants = await portalEngagementQuery(input);
  actor.clientIds = [...new Set(grants.map((grant) => grant.clientId))];
  actor.engagementIds = grants.map((grant) => grant.id);
  return actor;
}

export async function getEvidenceLocator(
  organisationId: string,
  evidenceId: string,
) {
  const [row] = await db
    .select({
      id: evidence.id,
      engagementId: evidence.engagementId,
      classification: evidence.classification,
    })
    .from(evidence)
    .where(
      and(
        eq(evidence.id, evidenceId),
        eq(evidence.organisationId, organisationId),
        isNull(evidence.deletedAt),
      ),
    )
    .limit(1);
  if (!row) throw new EvidenceScopeError();
  return row;
}

export async function auditEvidenceDownload(
  actor: EvidenceActor,
  row: typeof evidence.$inferSelect,
) {
  await db.insert(auditEvents).values({
    organisationId: actor.organisationId,
    actorId: actor.userId,
    action: "evidence.downloaded",
    targetType: "evidence",
    targetId: row.id,
    metadata: {
      engagementId: row.engagementId,
      classification: row.classification,
      version: row.version,
    },
  });
}

export async function createEvidenceAnnotation(
  actor: EvidenceActor,
  input: {
    evidenceId: string;
    engagementId?: string;
    operations: AnnotationOperation[];
  },
  provider: StorageProvider = storage(),
) {
  if (!input.operations.length)
    throw new Error("At least one annotation is required");
  const source = await getEvidenceForAccess(actor, input.evidenceId);
  if (actor.clientIds)
    await requirePortalEngagement(actor, source.engagementId, true);
  if (input.engagementId && source.engagementId !== input.engagementId)
    throw new EvidenceScopeError("Evidence belongs to another engagement");
  if (!source.mediaType.startsWith("image/"))
    throw new Error("Only image evidence can be annotated");
  const sourceBytes = await streamToBytes(
    await provider.get(source.storageKey),
  );
  const output = await applyAnnotationOperations(sourceBytes, input.operations);
  const derived = await uploadEvidence(
    actor,
    {
      engagementId: source.engagementId,
      filename: `${source.originalFilename.replace(/\.[^.]+$/, "")}-annotated.png`,
      mediaType: "image/png",
      bytes: output,
      classification: source.classification,
      restrictionReason: source.restrictions.reason,
      restrictedUserIds: source.restrictions.userIds,
      retentionUntil: source.retentionUntil ?? undefined,
      replaceEvidenceId: source.id,
      allowDuplicate: true,
    },
    provider,
  );
  await db.transaction(async (tx) => {
    await tx.insert(evidenceAnnotations).values({
      organisationId: actor.organisationId,
      sourceEvidenceId: source.id,
      outputEvidenceId: derived.id,
      authorId: actor.userId,
      annotationData: { operations: input.operations },
    });
    await tx.insert(auditEvents).values({
      organisationId: actor.organisationId,
      actorId: actor.userId,
      action: "evidence.annotation.created",
      targetType: "evidence",
      targetId: derived.id,
      metadata: {
        sourceEvidenceId: source.id,
        operationTypes: input.operations.map((operation) => operation.type),
      },
    });
  });
  return derived;
}

export async function applyAnnotationOperations(
  bytes: Uint8Array,
  operations: AnnotationOperation[],
) {
  let current = Buffer.from(bytes);
  for (const operation of operations) {
    if (operation.type === "crop") {
      current = await sharp(current)
        .extract({
          left: integer(operation.left),
          top: integer(operation.top),
          width: positiveInteger(operation.width),
          height: positiveInteger(operation.height),
        })
        .png()
        .toBuffer();
      continue;
    }
    if (operation.type === "blur") {
      const sigma = Math.min(100, Math.max(0.3, operation.sigma ?? 12));
      if (
        operation.left === undefined ||
        operation.top === undefined ||
        operation.width === undefined ||
        operation.height === undefined
      ) {
        current = await sharp(current).blur(sigma).png().toBuffer();
      } else {
        const region = {
          left: integer(operation.left),
          top: integer(operation.top),
          width: positiveInteger(operation.width),
          height: positiveInteger(operation.height),
        };
        const blurred = await sharp(current)
          .extract(region)
          .blur(sigma)
          .png()
          .toBuffer();
        current = await sharp(current)
          .composite([{ input: blurred, left: region.left, top: region.top }])
          .png()
          .toBuffer();
      }
      continue;
    }
    const metadata = await sharp(current).metadata();
    if (!metadata.width || !metadata.height)
      throw new Error("Image dimensions unavailable");
    const svg = annotationSvg(metadata.width, metadata.height, operation);
    current = await sharp(current)
      .composite([{ input: Buffer.from(svg), left: 0, top: 0 }])
      .png()
      .toBuffer();
  }
  return new Uint8Array(current);
}

export async function scanEvidenceJob(
  evidenceId: string,
  provider: StorageProvider = storage(),
) {
  const [row] = await db
    .select()
    .from(evidence)
    .where(eq(evidence.id, evidenceId))
    .limit(1);
  if (!row || row.deletedAt) return;
  const endpoint = process.env.MALWARE_SCAN_URL;
  if (!endpoint) {
    await db
      .update(evidence)
      .set({
        malwareScanStatus: "unavailable",
        malwareScanResult: {
          engine: "not-configured",
          scannedAt: new Date().toISOString(),
        },
      })
      .where(eq(evidence.id, evidenceId));
    return;
  }
  const bytes = await streamToBytes(await provider.get(row.storageKey));
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/octet-stream",
      "x-content-sha256": row.sha256,
    },
    body: bytes,
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok)
    throw new Error(`Malware scanner returned ${response.status}`);
  const result = (await response.json()) as {
    clean: boolean;
    engine?: string;
    signature?: string;
  };
  await db.transaction(async (tx) => {
    await tx
      .update(evidence)
      .set({
        malwareScanStatus: result.clean ? "clean" : "infected",
        malwareScanResult: {
          engine: result.engine,
          signature: result.signature,
          scannedAt: new Date().toISOString(),
        },
        quarantinedAt: result.clean ? null : new Date(),
      })
      .where(eq(evidence.id, evidenceId));
    if (!result.clean) {
      await tx.insert(auditEvents).values({
        organisationId: row.organisationId,
        action: "evidence.quarantined",
        targetType: "evidence",
        targetId: row.id,
        metadata: { engine: result.engine, signature: result.signature },
      });
    }
  });
}

export async function listEngagementEvidence(
  organisationId: string,
  engagementId: string,
) {
  return db
    .select()
    .from(evidence)
    .where(
      and(
        eq(evidence.organisationId, organisationId),
        eq(evidence.engagementId, engagementId),
        isNull(evidence.deletedAt),
      ),
    )
    .orderBy(desc(evidence.createdAt));
}

export async function streamToBytes(stream: ReadableStream<Uint8Array>) {
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = stream.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      size += value.byteLength;
    }
  }
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function annotationSvg(
  width: number,
  height: number,
  operation: Exclude<AnnotationOperation, { type: "crop" | "blur" }>,
) {
  const colour = safeColour(operation.colour);
  let content = "";
  if (operation.type === "redaction") {
    content = `<rect x="${operation.left}" y="${operation.top}" width="${operation.width}" height="${operation.height}" fill="#111827"/>`;
  } else if (operation.type === "highlight") {
    content = `<rect x="${operation.left}" y="${operation.top}" width="${operation.width}" height="${operation.height}" fill="${colour}" fill-opacity="0.28" stroke="${colour}" stroke-width="3"/>`;
  } else if (operation.type === "rectangle") {
    content = `<rect x="${operation.left}" y="${operation.top}" width="${operation.width}" height="${operation.height}" fill="none" stroke="${colour}" stroke-width="4"/>`;
  } else if (operation.type === "ellipse") {
    content = `<ellipse cx="${operation.left + operation.width / 2}" cy="${operation.top + operation.height / 2}" rx="${operation.width / 2}" ry="${operation.height / 2}" fill="none" stroke="${colour}" stroke-width="4"/>`;
  } else if (operation.type === "drawing") {
    const points = operation.points
      .map((point) => `${integer(point.x)},${integer(point.y)}`)
      .join(" ");
    content = `<polyline points="${points}" fill="none" stroke="${colour}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`;
  } else if (operation.type === "text") {
    content = `<text x="${operation.x}" y="${operation.y}" fill="${colour}" font-family="sans-serif" font-size="24" font-weight="600">${escapeXml(operation.text.slice(0, 500))}</text>`;
  } else if (operation.type === "callout") {
    content = `<circle cx="${operation.x}" cy="${operation.y}" r="18" fill="${colour}"/><text x="${operation.x}" y="${operation.y + 7}" fill="white" text-anchor="middle" font-family="sans-serif" font-size="20" font-weight="700">${integer(operation.number)}</text>`;
  } else {
    throw new Error("Unsupported annotation operation");
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${content}</svg>`;
}

function safeColour(value?: string) {
  return value && /^#[0-9a-f]{6}$/i.test(value) ? value : "#dc2626";
}

function assertActorScope(
  actor: EvidenceActor,
  clientId: string,
  engagementId: string,
) {
  if (actor.clientIds && !actor.clientIds.includes(clientId))
    throw new EvidenceScopeError("Evidence belongs to another client");
  if (actor.engagementIds && !actor.engagementIds.includes(engagementId))
    throw new EvidenceScopeError("Evidence belongs to another engagement");
}
function integer(value: number) {
  if (!Number.isFinite(value) || value < 0)
    throw new Error("Invalid annotation coordinate");
  return Math.round(value);
}
function positiveInteger(value: number) {
  const result = integer(value);
  if (!result) throw new Error("Annotation dimensions must be positive");
  return result;
}
function escapeXml(value: string) {
  return value.replace(/[<>&"']/g, (character) => {
    const entities: Record<string, string> = {
      "<": "&lt;",
      ">": "&gt;",
      "&": "&amp;",
      '"': "&quot;",
      "'": "&apos;",
    };
    return entities[character] ?? character;
  });
}
