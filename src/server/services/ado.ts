import "server-only";

import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { auditEvents, integrationConnections } from "@/db/schema";
import {
  decryptIntegrationSecret,
  encryptIntegrationSecret,
} from "@/lib/integrations/crypto";
import {
  assertPublicHttpUrl,
  outboundFetchInit,
} from "@/lib/security/outbound-url";

export type IntegrationActor = { organisationId: string; userId: string };

const configSchema = z.object({
  organisation: z.string().trim().min(1),
  project: z.string().trim().min(1),
  pat: z.string().min(8),
  baseUrl: z.string().url().optional(),
});

export async function saveAzureDevOpsConnection(
  actor: IntegrationActor,
  input: z.infer<typeof configSchema> & { enabled?: boolean },
) {
  const config = configSchema.parse(input);
  const encrypted = encryptIntegrationSecret(JSON.stringify(config));
  const [existing] = await db
    .select({ id: integrationConnections.id })
    .from(integrationConnections)
    .where(
      and(
        eq(integrationConnections.organisationId, actor.organisationId),
        eq(integrationConnections.provider, "azure_devops"),
      ),
    )
    .limit(1);
  if (existing) {
    await db
      .update(integrationConnections)
      .set({
        configurationEncrypted: encrypted,
        enabled: input.enabled ?? true,
      })
      .where(eq(integrationConnections.id, existing.id));
  } else {
    await db.insert(integrationConnections).values({
      organisationId: actor.organisationId,
      provider: "azure_devops",
      configurationEncrypted: encrypted,
      enabled: input.enabled ?? true,
    });
  }
  await db.insert(auditEvents).values({
    organisationId: actor.organisationId,
    actorId: actor.userId,
    action: "integration.azure_devops.saved",
    targetType: "integration_connection",
    targetId: actor.organisationId,
    metadata: { provider: "azure_devops" },
  });
}

async function loadConfig(organisationId: string) {
  const [row] = await db
    .select({
      configurationEncrypted: integrationConnections.configurationEncrypted,
      enabled: integrationConnections.enabled,
    })
    .from(integrationConnections)
    .where(
      and(
        eq(integrationConnections.organisationId, organisationId),
        eq(integrationConnections.provider, "azure_devops"),
      ),
    )
    .limit(1);
  if (!row?.enabled)
    throw new Error("Azure DevOps integration is not configured");
  return configSchema.parse(
    JSON.parse(decryptIntegrationSecret(row.configurationEncrypted)),
  );
}

export async function createAzureDevOpsIssue(
  actor: IntegrationActor,
  input: { title: string; description: string },
) {
  const config = await loadConfig(actor.organisationId);
  const base =
    config.baseUrl?.replace(/\/+$/, "") ??
    `https://dev.azure.com/${encodeURIComponent(config.organisation)}`;
  const url = await assertPublicHttpUrl(
    `${base}/${encodeURIComponent(config.project)}/_apis/wit/workitems/$Issue?api-version=7.1`,
  );
  const response = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`:${config.pat}`).toString("base64")}`,
      "content-type": "application/json-patch+json",
      accept: "application/json",
    },
    body: JSON.stringify([
      {
        op: "add",
        path: "/fields/System.Title",
        value: input.title.slice(0, 255),
      },
      {
        op: "add",
        path: "/fields/System.Description",
        value: input.description.slice(0, 30_000),
      },
    ]),
    signal: AbortSignal.timeout(15_000),
    ...outboundFetchInit,
  });
  if (!response.ok)
    throw new Error(
      `Azure DevOps create issue failed (HTTP ${response.status})`,
    );
  const body = (await response.json()) as { id?: number; url?: string };
  await db.insert(auditEvents).values({
    organisationId: actor.organisationId,
    actorId: actor.userId,
    action: "integration.azure_devops.issue_created",
    targetType: "integration_connection",
    targetId: actor.organisationId,
    metadata: { workItemId: body.id },
  });
  return { id: body.id, url: body.url };
}
