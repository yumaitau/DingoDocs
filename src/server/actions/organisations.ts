"use server";

import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { db } from "@/db";
import { auditEvents, organisationMembers, organisations } from "@/db/schema";
import { activeOrganisationCookie } from "@/lib/auth/active-organisation";
import { requireSession } from "@/lib/auth/session";

const schema = z.object({ name: z.string().trim().min(2).max(100) });

export async function createOrganisation(formData: FormData) {
  const session = await requireSession();
  const input = schema.parse({ name: formData.get("name") });
  const organisationId = uuidv7();
  const base =
    input.name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || "organisation";
  const suffix = createHash("sha256")
    .update(organisationId)
    .digest("hex")
    .slice(0, 6);
  const slug = `${base}-${suffix}`;

  await db.transaction(async (tx) => {
    await tx
      .insert(organisations)
      .values({ id: organisationId, name: input.name, slug });
    await tx.insert(organisationMembers).values({
      organisationId,
      userId: session.user.id,
      role: "organisation_owner",
      joinedAt: new Date(),
    });
    await tx.insert(auditEvents).values({
      organisationId,
      actorId: session.user.id,
      action: "organisation.created",
      targetType: "organisation",
      targetId: organisationId,
      metadata: { name: input.name },
    });
  });

  const cookieStore = await cookies();
  cookieStore.set(activeOrganisationCookie, organisationId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  redirect("/dashboard");
}
