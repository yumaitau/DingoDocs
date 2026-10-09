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
  instanceUrl: z.string().url(),
  username: z.string().trim().min(1),
  password: z.string().min(1),
  table: z.string().trim().min(1).default("incident"),
});

export async function saveServiceNowConnection(
  actor: IntegrationActor,
  input: z.infer<typeof configSchema> & { enabled?: boolean },
) {
  const config = configSchema.parse({
    ...input,
    instanceUrl: input.instanceUrl.replace(/\/+$/, ""),
  });
  await assertPublicHttpUrl(config.instanceUrl);
  const encrypted = encryptIntegrationSecret(JSON.stringify(config));
  const [existing] = await db
    .select({ id: integrationConnections.id })
    .from(integrationConnections)
    .where(
      and(
        eq(integrationConnections.organisationId, actor.organisationId),
        eq(integrationConnections.provider, "servicenow"),
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
      provider: "servicenow",
      configurationEncrypted: encrypted,
      enabled: input.enabled ?? true,
    });
  }
  await db.insert(auditEvents).values({
    organisationId: actor.organisationId,
    actorId: actor.userId,
    action: "integration.servicenow.saved",
    targetType: "integration_connection",
    targetId: actor.organisationId,
    metadata: { provider: "servicenow" },
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
        eq(integrationConnections.provider, "servicenow"),
      ),
    )
    .limit(1);
  if (!row?.enabled)
    throw new Error("ServiceNow integration is not configured");
  return configSchema.parse(
    JSON.parse(decryptIntegrationSecret(row.configurationEncrypted)),
  );
}

export async function createServiceNowIncident(
  actor: IntegrationActor,
  input: { shortDescription: string; description: string },
) {
  const config = await loadConfig(actor.organisationId);
  const url = await assertPublicHttpUrl(
    `${config.instanceUrl}/api/now/table/${encodeURIComponent(config.table)}`,
  );
  const response = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`${config.username}:${config.password}`).toString("base64")}`,
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      short_description: input.shortDescription.slice(0, 160),
      description: input.description.slice(0, 40_000),
    }),
    signal: AbortSignal.timeout(15_000),
    ...outboundFetchInit,
  });
  if (!response.ok)
    throw new Error(`ServiceNow create failed (HTTP ${response.status})`);
  const body = (await response.json()) as {
    result?: { sys_id?: string; number?: string };
  };
  await db.insert(auditEvents).values({
    organisationId: actor.organisationId,
    actorId: actor.userId,
    action: "integration.servicenow.issue_created",
    targetType: "integration_connection",
    targetId: actor.organisationId,
    metadata: {
      sysId: body.result?.sys_id,
      number: body.result?.number,
    },
  });
  return {
    sysId: body.result?.sys_id,
    number: body.result?.number,
  };
}
