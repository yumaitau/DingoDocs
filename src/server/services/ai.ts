import "server-only";

import { createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  aiAssistRuns,
  aiConfigurations,
  auditEvents,
  clients,
  engagements,
  evidence,
  evidenceFindings,
  findings,
} from "@/db/schema";
import {
  decryptIntegrationSecret,
  encryptIntegrationSecret,
} from "@/lib/integrations/crypto";
import { aiConfirmation, aiProviders } from "@/lib/integrations/constants";
import {
  assertPublicHttpUrl,
  outboundFetchInit,
} from "@/lib/security/outbound-url";
import { storage } from "@/lib/storage";

export { aiConfirmation, aiProviders } from "@/lib/integrations/constants";

export const findingAssistActions = [
  "remediation",
  "executive",
  "reproduction",
  "scanner_summary",
  "executive_summary",
  "grammar",
  "translate",
  "vision_caption",
] as const;

export type FindingAssistAction = (typeof findingAssistActions)[number];

const assistField: Record<
  FindingAssistAction,
  | "remediation"
  | "executiveSummary"
  | "reproductionSteps"
  | "technicalDetail"
  | "caption"
  | null
> = {
  remediation: "remediation",
  executive: "executiveSummary",
  reproduction: "reproductionSteps",
  scanner_summary: "technicalDetail",
  executive_summary: null,
  grammar: "technicalDetail",
  translate: "executiveSummary",
  vision_caption: "caption",
};

export async function configureAiProvider(
  actor: { organisationId: string; userId: string },
  input: {
    provider: (typeof aiProviders)[number];
    model: string;
    baseUrl?: string;
    apiKey?: string;
    enabled: boolean;
  },
) {
  if (input.provider !== "ollama" && !input.apiKey?.trim())
    throw new Error("An API key is required for this provider");
  const baseUrl = await providerBaseUrl(input.provider, input.baseUrl);
  const [configuration] = await db
    .insert(aiConfigurations)
    .values({
      organisationId: actor.organisationId,
      provider: input.provider,
      model: input.model.trim(),
      baseUrl,
      apiKeyEncrypted: input.apiKey
        ? encryptIntegrationSecret(input.apiKey.trim())
        : undefined,
      enabled: input.enabled,
      updatedBy: actor.userId,
    })
    .onConflictDoUpdate({
      target: aiConfigurations.organisationId,
      set: {
        provider: input.provider,
        model: input.model.trim(),
        baseUrl,
        apiKeyEncrypted: input.apiKey
          ? encryptIntegrationSecret(input.apiKey.trim())
          : undefined,
        enabled: input.enabled,
        updatedBy: actor.userId,
        updatedAt: new Date(),
      },
    })
    .returning({ id: aiConfigurations.id });
  await db.insert(auditEvents).values({
    organisationId: actor.organisationId,
    actorId: actor.userId,
    action: "ai.configuration.updated",
    targetType: "ai_configuration",
    targetId: configuration.id,
    metadata: {
      provider: input.provider,
      model: input.model,
      enabled: input.enabled,
    },
  });
  return configuration;
}

async function providerBaseUrl(
  provider: (typeof aiProviders)[number],
  configured?: string,
) {
  const value =
    configured ??
    (provider === "openai"
      ? "https://api.openai.com/v1"
      : provider === "anthropic"
        ? "https://api.anthropic.com/v1"
        : "http://127.0.0.1:11434");
  const allowLoopback = provider === "ollama";
  const url = await assertPublicHttpUrl(value, {
    allowHttp: allowLoopback || process.env.NODE_ENV !== "production",
    allowLoopback,
  });
  return url.replace(/\/$/, "");
}

export async function requestAiDraft(
  actor: { organisationId: string; userId: string },
  input: {
    purpose: string;
    prompt: string;
    confirmation: string;
  },
) {
  if (process.env.AI_ENABLED !== "true")
    throw new Error("AI features are disabled at the deployment level");
  if (input.confirmation !== aiConfirmation)
    throw new Error("Explicit AI data-transfer confirmation is required");
  const [configuration] = await db
    .select()
    .from(aiConfigurations)
    .where(eq(aiConfigurations.organisationId, actor.organisationId))
    .limit(1);
  if (!configuration?.enabled)
    throw new Error("AI is not enabled for this organisation");
  const provider = z.enum(aiProviders).parse(configuration.provider);
  const apiKey = configuration.apiKeyEncrypted
    ? decryptIntegrationSecret(configuration.apiKeyEncrypted)
    : undefined;
  const baseUrl = await providerBaseUrl(provider, configuration.baseUrl!);
  const output = await callProvider({
    provider,
    baseUrl,
    model: configuration.model,
    apiKey,
    prompt: input.prompt,
  });
  const [run] = await db
    .insert(aiAssistRuns)
    .values({
      organisationId: actor.organisationId,
      actorId: actor.userId,
      provider,
      model: configuration.model,
      purpose: input.purpose,
      inputHash: createHash("sha256").update(input.prompt).digest("hex"),
      outputDraft: output,
      confirmation: input.confirmation,
      status: "untrusted_draft",
    })
    .returning({ id: aiAssistRuns.id, outputDraft: aiAssistRuns.outputDraft });
  await db.insert(auditEvents).values({
    organisationId: actor.organisationId,
    actorId: actor.userId,
    action: "ai.draft.generated",
    targetType: "ai_assist_run",
    targetId: run.id,
    metadata: {
      provider,
      model: configuration.model,
      purpose: input.purpose,
      status: "untrusted_draft",
    },
  });
  return { id: run.id, draft: run.outputDraft, trusted: false as const };
}

export async function requestFindingAssist(
  actor: { organisationId: string; userId: string },
  input: {
    findingId: string;
    action: FindingAssistAction;
    confirmation: string;
  },
) {
  if (process.env.AI_ENABLED !== "true")
    throw new Error("AI features are disabled at the deployment level");
  if (input.confirmation !== aiConfirmation)
    throw new Error("Explicit AI data-transfer confirmation is required");
  const [configuration] = await db
    .select()
    .from(aiConfigurations)
    .where(eq(aiConfigurations.organisationId, actor.organisationId))
    .limit(1);
  if (!configuration?.enabled)
    throw new Error("AI is not enabled for this organisation");
  const provider = z.enum(aiProviders).parse(configuration.provider);

  const [finding] = await db
    .select({
      id: findings.id,
      title: findings.title,
      severity: findings.severity,
      status: findings.status,
      executiveSummary: findings.executiveSummary,
      technicalDetail: findings.technicalDetail,
      reproductionSteps: findings.reproductionSteps,
      remediation: findings.remediation,
      engagementId: findings.engagementId,
      engagementName: engagements.name,
      clientName: clients.name,
      clientPreferences: clients.reportPreferences,
    })
    .from(findings)
    .innerJoin(engagements, eq(engagements.id, findings.engagementId))
    .innerJoin(clients, eq(clients.id, engagements.clientId))
    .where(
      and(
        eq(findings.id, input.findingId),
        eq(findings.organisationId, actor.organisationId),
        isNull(findings.deletedAt),
      ),
    )
    .limit(1);
  if (!finding) throw new Error("Finding is unavailable");

  let image:
    | { mediaType: string; base64: string }
    | undefined;
  if (input.action === "vision_caption") {
    if (provider === "ollama")
      throw new Error("Vision caption requires OpenAI or Anthropic");
    image = await loadFindingImage(actor.organisationId, finding.id);
  }

  const published =
    input.action === "executive_summary"
      ? await db
          .select({
            identifier: findings.identifier,
            title: findings.title,
            severity: findings.severity,
            executiveSummary: findings.executiveSummary,
          })
          .from(findings)
          .where(
            and(
              eq(findings.organisationId, actor.organisationId),
              eq(findings.engagementId, finding.engagementId),
              eq(findings.status, "published"),
              isNull(findings.deletedAt),
            ),
          )
      : [];

  const languageHint =
    typeof finding.clientPreferences === "object" &&
    finding.clientPreferences &&
    "language" in finding.clientPreferences &&
    typeof finding.clientPreferences.language === "string"
      ? finding.clientPreferences.language
      : undefined;

  const system = [
    "You assist authorised security consultants drafting finding text.",
    `Finding title: ${finding.title}`,
    `Severity: ${finding.severity}`,
    `Engagement: ${finding.engagementName}`,
    "Mark the response as an untrusted_draft for human review. Do not claim the text is final.",
    input.action === "translate"
      ? `write in the client's language if known, else English. Client: ${finding.clientName}. Language hint: ${languageHint ?? "unknown"}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");

  const userPrompt = buildAssistPrompt(input.action, finding, published);
  const prompt = `${system}\n\n${userPrompt}`;
  const apiKey = configuration.apiKeyEncrypted
    ? decryptIntegrationSecret(configuration.apiKeyEncrypted)
    : undefined;
  const baseUrl = await providerBaseUrl(provider, configuration.baseUrl!);
  const output = await callProvider({
    provider,
    baseUrl,
    model: configuration.model,
    apiKey,
    prompt,
    image,
  });
  const [run] = await db
    .insert(aiAssistRuns)
    .values({
      organisationId: actor.organisationId,
      actorId: actor.userId,
      provider,
      model: configuration.model,
      purpose: `finding.${input.action}`,
      inputHash: createHash("sha256").update(prompt).digest("hex"),
      outputDraft: output,
      confirmation: input.confirmation,
      status: "untrusted_draft",
    })
    .returning({ id: aiAssistRuns.id, outputDraft: aiAssistRuns.outputDraft });
  await db.insert(auditEvents).values({
    organisationId: actor.organisationId,
    actorId: actor.userId,
    action: "ai.draft.generated",
    targetType: "ai_assist_run",
    targetId: run.id,
    metadata: {
      provider,
      model: configuration.model,
      purpose: `finding.${input.action}`,
      findingId: finding.id,
      status: "untrusted_draft",
    },
  });
  return {
    id: run.id,
    draft: run.outputDraft,
    field: assistField[input.action],
    trusted: false as const,
  };
}

function buildAssistPrompt(
  action: FindingAssistAction,
  finding: {
    title: string;
    executiveSummary: string | null;
    technicalDetail: string | null;
    reproductionSteps: string | null;
    remediation: string | null;
  },
  published: Array<{
    identifier: string;
    title: string;
    severity: string;
    executiveSummary: string | null;
  }>,
) {
  switch (action) {
    case "remediation":
      return `Draft remediation guidance for this finding.\nTechnical detail:\n${finding.technicalDetail ?? ""}`;
    case "executive":
      return `Rewrite this finding for an executive audience.\nCurrent summary:\n${finding.executiveSummary ?? ""}\nTechnical detail:\n${finding.technicalDetail ?? ""}`;
    case "reproduction":
      return `Expand reproduction steps for this finding.\nCurrent steps:\n${finding.reproductionSteps ?? ""}\nTechnical detail:\n${finding.technicalDetail ?? ""}`;
    case "scanner_summary":
      return `Summarise scanner or technical notes into clear technical detail.\nNotes:\n${finding.technicalDetail ?? ""}`;
    case "executive_summary":
      return `Generate an engagement executive summary from these published findings:\n${published
        .map(
          (item) =>
            `- ${item.identifier} [${item.severity}] ${item.title}: ${item.executiveSummary ?? ""}`,
        )
        .join("\n")}`;
    case "grammar":
      return `Improve grammar and consistency of this technical detail. Keep meaning unchanged.\n${finding.technicalDetail ?? ""}`;
    case "translate":
      return `Translate or rewrite the executive summary for the client audience.\n${finding.executiveSummary ?? ""}`;
    case "vision_caption":
      return `Write a short evidence caption suitable for a finding note. Describe only what is visible.`;
  }
}

async function loadFindingImage(organisationId: string, findingId: string) {
  if ((process.env.STORAGE_PROVIDER ?? "local") !== "local") return undefined;
  const rows = await db
    .select({
      storageKey: evidence.storageKey,
      mediaType: evidence.mediaType,
    })
    .from(evidenceFindings)
    .innerJoin(evidence, eq(evidence.id, evidenceFindings.evidenceId))
    .where(
      and(
        eq(evidenceFindings.findingId, findingId),
        eq(evidence.organisationId, organisationId),
        isNull(evidence.deletedAt),
      ),
    );
  const image = rows.find((item) => item.mediaType.startsWith("image/"));
  if (!image) return undefined;
  try {
    const stream = await storage().get(image.storageKey);
    const bytes = Buffer.from(await new Response(stream).arrayBuffer());
    if (!bytes.length) return undefined;
    return {
      mediaType: image.mediaType,
      base64: bytes.toString("base64"),
    };
  } catch {
    return undefined;
  }
}

async function callProvider(input: {
  provider: (typeof aiProviders)[number];
  baseUrl: string;
  model: string;
  apiKey?: string;
  prompt: string;
  image?: { mediaType: string; base64: string };
}) {
  if (input.provider === "openai") {
    const body = input.image
      ? {
          model: input.model,
          store: false,
          input: [
            {
              role: "user",
              content: [
                { type: "input_text", text: input.prompt },
                {
                  type: "input_image",
                  image_url: `data:${input.image.mediaType};base64,${input.image.base64}`,
                },
              ],
            },
          ],
        }
      : {
          model: input.model,
          input: input.prompt,
          store: false,
        };
    const response = await fetch(`${input.baseUrl}/responses`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${input.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
      ...outboundFetchInit,
    });
    const data = (await checkedJson(response)) as {
      output_text?: string;
      output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
    };
    const text =
      data.output_text ??
      data.output
        ?.flatMap((item) => item.content ?? [])
        .find((item) => item.type === "output_text")?.text;
    if (!text) throw new Error("OpenAI returned no text output");
    return text;
  }
  if (input.provider === "anthropic") {
    const content = input.image
      ? [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: input.image.mediaType,
              data: input.image.base64,
            },
          },
          { type: "text", text: input.prompt },
        ]
      : input.prompt;
    const response = await fetch(`${input.baseUrl}/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": input.apiKey!,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: input.model,
        max_tokens: 2_000,
        messages: [{ role: "user", content }],
      }),
      signal: AbortSignal.timeout(60_000),
      ...outboundFetchInit,
    });
    const data = (await checkedJson(response)) as {
      content?: Array<{ type?: string; text?: string }>;
    };
    const text = data.content?.find((item) => item.type === "text")?.text;
    if (!text) throw new Error("Anthropic returned no text output");
    return text;
  }
  if (input.image)
    throw new Error("Vision caption is not supported for Ollama");
  const response = await fetch(`${input.baseUrl}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: input.model,
      stream: false,
      messages: [{ role: "user", content: input.prompt }],
    }),
    signal: AbortSignal.timeout(60_000),
    ...outboundFetchInit,
  });
  const data = (await checkedJson(response)) as {
    message?: { content?: string };
  };
  if (!data.message?.content) throw new Error("Ollama returned no text output");
  return data.message.content;
}

async function checkedJson(response: Response) {
  if (!response.ok)
    throw new Error(`AI provider returned HTTP ${response.status}`);
  return response.json();
}
