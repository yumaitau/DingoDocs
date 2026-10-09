import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { notificationChannels } from "@/db/schema";
import { apiReadContext, apiWriteContext } from "@/lib/api/authentication";
import { apiError } from "@/lib/api/responses";
import { notificationProviders } from "@/lib/integrations/constants";
import { createNotificationChannel } from "@/server/services/notifications";

export async function GET(request: Request) {
  const requestId = request.headers.get("x-request-id");
  try {
    const context = await apiReadContext(request, "notifications:manage");
    const data = await db
      .select({
        id: notificationChannels.id,
        name: notificationChannels.name,
        provider: notificationChannels.provider,
        enabled: notificationChannels.enabled,
        createdAt: notificationChannels.createdAt,
      })
      .from(notificationChannels)
      .where(eq(notificationChannels.organisationId, context.organisationId))
      .orderBy(desc(notificationChannels.createdAt));
    return NextResponse.json({ data, requestId });
  } catch (error) {
    return apiError(error, requestId);
  }
}

const createSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    provider: z.enum(notificationProviders),
    userId: z.string().uuid().optional(),
    to: z.string().email().optional(),
    url: z.string().url().optional(),
  })
  .superRefine((input, context) => {
    if (input.provider === "in_app" && !input.userId)
      context.addIssue({
        code: "custom",
        path: ["userId"],
        message: "in_app channels require userId",
      });
    if (input.provider === "smtp" && !input.to)
      context.addIssue({
        code: "custom",
        path: ["to"],
        message: "smtp channels require to",
      });
    if (input.provider !== "in_app" && input.provider !== "smtp" && !input.url)
      context.addIssue({
        code: "custom",
        path: ["url"],
        message: "this provider requires url",
      });
  });

export async function POST(request: Request) {
  const requestId = request.headers.get("x-request-id");
  try {
    const input = createSchema.parse(await request.json());
    const principal = await apiWriteContext(
      request,
      "notifications:manage",
      "integration:configure",
    );
    if (!principal.userId)
      throw new Error("API key does not have an attributable owner");
    const channel = await createNotificationChannel(
      { organisationId: principal.organisationId, userId: principal.userId },
      {
        name: input.name,
        provider: input.provider,
        configuration: {
          userId: input.userId,
          to: input.to,
          url: input.url,
        },
      },
    );
    return NextResponse.json({ data: channel, requestId }, { status: 201 });
  } catch (error) {
    return apiError(error, requestId);
  }
}
