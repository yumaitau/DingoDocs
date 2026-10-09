import "server-only";

import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { auditEvents, findings, integrationConnections } from "@/db/schema";
import type { FindingStatus } from "@/features/findings/workflow";
import {
  decryptIntegrationSecret,
  encryptIntegrationSecret,
} from "@/lib/integrations/crypto";
import {
  assertPublicHttpUrl,
  outboundFetchInit,
} from "@/lib/security/outbound-url";
import { transitionFinding } from "./findings";

export type IntegrationActor = { organisationId: string; userId: string };

const jiraConfigSchema = z.object({
  baseUrl: z.string().url(),
  email: z.string().email(),
  apiToken: z.string().min(8),
  projectKey: z.string().trim().min(1).max(32).optional(),
  issueType: z.string().trim().min(1).max(64).optional(),
});

type JiraConfig = z.infer<typeof jiraConfigSchema>;

const statusAliases: Record<string, FindingStatus> = {
  draft: "draft",
  "in progress": "in_progress",
  in_progress: "in_progress",
  "ready for review": "ready_for_review",
  ready_for_review: "ready_for_review",
  "changes requested": "changes_requested",
  changes_requested: "changes_requested",
  "peer reviewed": "peer_reviewed",
  peer_reviewed: "peer_reviewed",
  "qa approved": "qa_approved",
  qa_approved: "qa_approved",
  published: "published",
  "remediation in progress": "remediation_in_progress",
  remediation_in_progress: "remediation_in_progress",
  "ready for retest": "ready_for_retest",
  ready_for_retest: "ready_for_retest",
  retested: "retested",
  resolved: "resolved",
  done: "resolved",
  "risk accepted": "risk_accepted",
  risk_accepted: "risk_accepted",
  closed: "closed",
  close: "closed",
};

function basicAuth(email: string, apiToken: string) {
  return `Basic ${Buffer.from(`${email}:${apiToken}`).toString("base64")}`;
}

async function loadJiraConfig(organisationId: string): Promise<JiraConfig> {
  const [row] = await db
    .select({
      configurationEncrypted: integrationConnections.configurationEncrypted,
      enabled: integrationConnections.enabled,
    })
    .from(integrationConnections)
    .where(
      and(
        eq(integrationConnections.organisationId, organisationId),
        eq(integrationConnections.provider, "jira"),
      ),
    )
    .limit(1);
  if (!row?.enabled) throw new Error("Jira integration is not configured");
  return jiraConfigSchema.parse(
    JSON.parse(decryptIntegrationSecret(row.configurationEncrypted)),
  );
}

export async function saveJiraConnection(
  actor: IntegrationActor,
  input: {
    baseUrl: string;
    email: string;
    apiToken: string;
    projectKey?: string;
    issueType?: string;
    enabled?: boolean;
  },
) {
  const config = jiraConfigSchema.parse({
    baseUrl: input.baseUrl.replace(/\/+$/, ""),
    email: input.email,
    apiToken: input.apiToken,
    projectKey: input.projectKey,
    issueType: input.issueType,
  });
  await assertPublicHttpUrl(config.baseUrl);
  const encrypted = encryptIntegrationSecret(JSON.stringify(config));
  const [existing] = await db
    .select({ id: integrationConnections.id })
    .from(integrationConnections)
    .where(
      and(
        eq(integrationConnections.organisationId, actor.organisationId),
        eq(integrationConnections.provider, "jira"),
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
      provider: "jira",
      configurationEncrypted: encrypted,
      enabled: input.enabled ?? true,
    });
  }
  await db.insert(auditEvents).values({
    organisationId: actor.organisationId,
    actorId: actor.userId,
    action: "integration.jira.saved",
    targetType: "integration_connection",
    targetId: actor.organisationId,
    metadata: { provider: "jira", baseUrl: config.baseUrl },
  });
}

export async function testJiraConnection(actor: IntegrationActor) {
  const config = await loadJiraConfig(actor.organisationId);
  const url = await assertPublicHttpUrl(`${config.baseUrl}/rest/api/3/myself`);
  const response = await fetch(url, {
    method: "GET",
    headers: {
      authorization: basicAuth(config.email, config.apiToken),
      accept: "application/json",
    },
    signal: AbortSignal.timeout(10_000),
    ...outboundFetchInit,
  });
  if (!response.ok)
    throw new Error(`Jira connection test failed (HTTP ${response.status})`);
  const body = (await response.json()) as {
    displayName?: string;
    emailAddress?: string;
  };
  return {
    ok: true as const,
    displayName: body.displayName,
    emailAddress: body.emailAddress,
  };
}

export async function pushFindingToJira(
  actor: IntegrationActor,
  findingId: string,
) {
  const config = await loadJiraConfig(actor.organisationId);
  const [finding] = await db
    .select({
      id: findings.id,
      title: findings.title,
      identifier: findings.identifier,
      severity: findings.severity,
      status: findings.status,
      executiveSummary: findings.executiveSummary,
      technicalDetail: findings.technicalDetail,
      remediation: findings.remediation,
      sourceProvenance: findings.sourceProvenance,
    })
    .from(findings)
    .where(
      and(
        eq(findings.id, findingId),
        eq(findings.organisationId, actor.organisationId),
        isNull(findings.deletedAt),
      ),
    )
    .limit(1);
  if (!finding) throw new Error("Finding was not found");
  if (!config.projectKey)
    throw new Error("Jira projectKey is required to create issues");

  const description = [
    `DingoDocs finding ${finding.identifier}`,
    `Severity: ${finding.severity}`,
    `Status: ${finding.status}`,
    "",
    finding.executiveSummary?.trim() || finding.title,
    "",
    finding.technicalDetail?.trim() ?? "",
    "",
    finding.remediation ? `Remediation:\n${finding.remediation}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const url = await assertPublicHttpUrl(`${config.baseUrl}/rest/api/3/issue`);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      authorization: basicAuth(config.email, config.apiToken),
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      fields: {
        project: { key: config.projectKey },
        summary: `${finding.identifier}: ${finding.title}`.slice(0, 255),
        description: {
          type: "doc",
          version: 1,
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: description.slice(0, 30_000) }],
            },
          ],
        },
        issuetype: { name: config.issueType ?? "Task" },
      },
    }),
    signal: AbortSignal.timeout(15_000),
    ...outboundFetchInit,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Jira create issue failed (HTTP ${response.status})${detail ? `: ${detail.slice(0, 200)}` : ""}`,
    );
  }
  const created = (await response.json()) as { key?: string; id?: string };
  if (!created.key) throw new Error("Jira did not return an issue key");

  const provenance = {
    ...(finding.sourceProvenance ?? {}),
    jiraKey: created.key,
  };
  await db
    .update(findings)
    .set({ sourceProvenance: provenance, updatedAt: new Date() })
    .where(
      and(
        eq(findings.id, finding.id),
        eq(findings.organisationId, actor.organisationId),
      ),
    );
  await db.insert(auditEvents).values({
    organisationId: actor.organisationId,
    actorId: actor.userId,
    action: "integration.jira.issue_created",
    targetType: "finding",
    targetId: finding.id,
    metadata: { jiraKey: created.key },
  });
  return { jiraKey: created.key, jiraId: created.id };
}

export async function pullJiraStatus(
  actor: IntegrationActor,
  findingId: string,
) {
  const config = await loadJiraConfig(actor.organisationId);
  const [finding] = await db
    .select({
      id: findings.id,
      status: findings.status,
      sourceProvenance: findings.sourceProvenance,
    })
    .from(findings)
    .where(
      and(
        eq(findings.id, findingId),
        eq(findings.organisationId, actor.organisationId),
        isNull(findings.deletedAt),
      ),
    )
    .limit(1);
  if (!finding) throw new Error("Finding was not found");
  const jiraKey = finding.sourceProvenance?.jiraKey;
  if (typeof jiraKey !== "string" || !jiraKey)
    throw new Error("Finding has no jiraKey in sourceProvenance");

  const url = await assertPublicHttpUrl(
    `${config.baseUrl}/rest/api/3/issue/${encodeURIComponent(jiraKey)}?fields=status`,
  );
  const response = await fetch(url, {
    method: "GET",
    headers: {
      authorization: basicAuth(config.email, config.apiToken),
      accept: "application/json",
    },
    signal: AbortSignal.timeout(10_000),
    ...outboundFetchInit,
  });
  if (!response.ok)
    throw new Error(`Jira get issue failed (HTTP ${response.status})`);
  const body = (await response.json()) as {
    fields?: { status?: { name?: string } };
  };
  const remoteStatus = body.fields?.status?.name?.trim() ?? "";
  if (!remoteStatus) throw new Error("Jira issue status was missing");

  const mapped =
    statusAliases[remoteStatus.toLowerCase()] ??
    statusAliases[remoteStatus.toLowerCase().replace(/\s+/g, "_")];
  if (!mapped) {
    return {
      jiraKey,
      remoteStatus,
      mapped: null as FindingStatus | null,
      transitioned: false,
    };
  }
  if (mapped === finding.status) {
    return {
      jiraKey,
      remoteStatus,
      mapped,
      transitioned: false,
    };
  }
  await transitionFinding(actor, {
    findingId: finding.id,
    toStatus: mapped,
    comment: `Synced from Jira ${jiraKey} status "${remoteStatus}"`,
  });
  return {
    jiraKey,
    remoteStatus,
    mapped,
    transitioned: true,
  };
}
