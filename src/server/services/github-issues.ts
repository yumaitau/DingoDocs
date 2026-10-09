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
  owner: z.string().trim().min(1),
  repo: z.string().trim().min(1),
  token: z.string().min(8),
  apiBaseUrl: z.string().url().optional(),
});

export async function saveGitHubIssuesConnection(
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
        eq(integrationConnections.provider, "github"),
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
      provider: "github",
      configurationEncrypted: encrypted,
      enabled: input.enabled ?? true,
    });
  }
  await db.insert(auditEvents).values({
    organisationId: actor.organisationId,
    actorId: actor.userId,
    action: "integration.github.saved",
    targetType: "integration_connection",
    targetId: actor.organisationId,
    metadata: { provider: "github", owner: config.owner, repo: config.repo },
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
        eq(integrationConnections.provider, "github"),
      ),
    )
    .limit(1);
  if (!row?.enabled)
    throw new Error("GitHub issues integration is not configured");
  return configSchema.parse(
    JSON.parse(decryptIntegrationSecret(row.configurationEncrypted)),
  );
}

export async function createGitHubIssue(
  actor: IntegrationActor,
  input: { title: string; body: string },
) {
  const config = await loadConfig(actor.organisationId);
  const apiBase = (config.apiBaseUrl ?? "https://api.github.com").replace(
    /\/+$/,
    "",
  );
  const url = await assertPublicHttpUrl(
    `${apiBase}/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/issues`,
  );
  const response = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.token}`,
      accept: "application/vnd.github+json",
      "content-type": "application/json",
      "x-github-api-version": "2022-11-28",
    },
    body: JSON.stringify({
      title: input.title.slice(0, 256),
      body: input.body.slice(0, 65_000),
    }),
    signal: AbortSignal.timeout(15_000),
    ...outboundFetchInit,
  });
  if (!response.ok)
    throw new Error(`GitHub create issue failed (HTTP ${response.status})`);
  const body = (await response.json()) as {
    number?: number;
    html_url?: string;
    id?: number;
  };
  await db.insert(auditEvents).values({
    organisationId: actor.organisationId,
    actorId: actor.userId,
    action: "integration.github.issue_created",
    targetType: "integration_connection",
    targetId: actor.organisationId,
    metadata: { issueNumber: body.number, issueId: body.id },
  });
  return { number: body.number, url: body.html_url, id: body.id };
}
