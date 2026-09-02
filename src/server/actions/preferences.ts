"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { auditEvents, users } from "@/db/schema";
import { requireOrganisationContext } from "@/lib/permissions/require";
import { isSupportedTimeZone } from "@/lib/time-zone";

const timeZoneSchema = z
  .string()
  .refine(isSupportedTimeZone, "Select a supported IANA time zone");

/** Persists the authenticated user's own display time zone. */
export async function updateTimeZoneAction(formData: FormData) {
  const context = await requireOrganisationContext();
  const timeZone = timeZoneSchema.parse(formData.get("timeZone"));

  if (timeZone !== context.timeZone) {
    await db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ timeZone, updatedAt: new Date() })
        .where(eq(users.id, context.userId));
      await tx.insert(auditEvents).values({
        organisationId: context.organisationId,
        actorId: context.userId,
        action: "user.time_zone.updated",
        targetType: "user",
        targetId: context.userId,
        previousValues: { timeZone: context.timeZone },
        newValues: { timeZone },
      });
    });
  }

  revalidatePath("/account/preferences");
}
