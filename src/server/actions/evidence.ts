"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/permissions/require";
import {
  createEvidenceAnnotation,
  scopedEvidenceActor,
  type AnnotationOperation,
} from "@/server/services/evidence";

const id = z.string().uuid();
const finite = z.coerce.number().finite().min(0).max(100_000);
const positive = finite.refine(
  (value) => value > 0,
  "Must be greater than zero",
);
const optionalFinite = z.preprocess(
  (value) => (value === "" || value == null ? undefined : value),
  finite.optional(),
);
const optionalPositive = z.preprocess(
  (value) => (value === "" || value == null ? undefined : value),
  positive.optional(),
);
const colour = z
  .string()
  .regex(/^#[0-9a-f]{6}$/i)
  .optional();

export async function createEvidenceAnnotationAction(
  engagementId: string,
  evidenceId: string,
  formData: FormData,
) {
  id.parse(engagementId);
  id.parse(evidenceId);
  const context = await requirePermission("evidence:upload", { engagementId });
  const type = z
    .enum([
      "crop",
      "blur",
      "redaction",
      "highlight",
      "rectangle",
      "ellipse",
      "drawing",
      "text",
      "callout",
    ])
    .parse(formData.get("type"));
  const raw = Object.fromEntries(formData);
  let operation: AnnotationOperation;
  if (type === "crop") {
    operation = z
      .object({
        type: z.literal("crop"),
        left: finite,
        top: finite,
        width: positive,
        height: positive,
      })
      .parse({ ...raw, type });
  } else if (type === "blur") {
    operation = z
      .object({
        type: z.literal("blur"),
        left: optionalFinite,
        top: optionalFinite,
        width: optionalPositive,
        height: optionalPositive,
        sigma: z.preprocess(
          (value) => (value === "" || value == null ? undefined : value),
          z.coerce.number().min(0.3).max(100).optional(),
        ),
      })
      .parse({ ...raw, type });
  } else if (
    ["redaction", "highlight", "rectangle", "ellipse"].includes(type)
  ) {
    operation = z
      .object({
        type: z.enum(["redaction", "highlight", "rectangle", "ellipse"]),
        left: finite,
        top: finite,
        width: positive,
        height: positive,
        colour,
      })
      .parse({ ...raw, type });
  } else if (type === "drawing") {
    const encodedPoints = z.string().min(3).parse(formData.get("points"));
    const points = z
      .array(z.object({ x: finite, y: finite }))
      .min(2)
      .max(1_000)
      .parse(
        encodedPoints.split(/\s+/).map((pair) => {
          const [x, y] = pair.split(",").map(Number);
          return { x, y };
        }),
      );
    operation = {
      type,
      points,
      colour: colour.parse(formData.get("colour") || undefined),
    };
  } else if (type === "text") {
    operation = z
      .object({
        type: z.literal("text"),
        x: finite,
        y: finite,
        text: z.string().trim().min(1).max(500),
        colour,
      })
      .parse({ ...raw, type });
  } else {
    operation = z
      .object({
        type: z.literal("callout"),
        x: finite,
        y: finite,
        number: z.coerce.number().int().min(1).max(999),
        colour,
      })
      .parse({ ...raw, type });
  }
  const actor = await scopedEvidenceActor({
    organisationId: context.organisationId,
    userId: context.userId,
    roles: context.roles,
  });
  await createEvidenceAnnotation(actor, {
    evidenceId,
    engagementId,
    operations: [operation],
  });
  revalidatePath(`/engagements/${engagementId}`);
}
