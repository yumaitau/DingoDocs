import "server-only";

import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { aiAssistRuns, aiConfigurations, auditEvents } from "@/db/schema";
import {
  decryptIntegrationSecret,
  encryptIntegrationSecret,
} from "@/lib/integrations/crypto";
import { aiConfirmation, aiProviders } from "@/lib/integrations/constants";

export { aiConfirmation, aiProviders } from "@/lib/integrations/constants";

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
  const baseUrl = providerBaseUrl(input.provider, input.baseUrl);
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

function providerBaseUrl(
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
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol))
    throw new Error("AI provider URL is invalid");
  if (
    process.env.NODE_ENV === "production" &&
    provider !== "ollama" &&
    url.protocol !== "https:"
  )
    throw new Error("External AI provider URL must use HTTPS");
  return url.toString().replace(/\/$/, "");
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
  const output = await callProvider({
    provider,
    baseUrl: configuration.baseUrl!,
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

async function callProvider(input: {
  provider: (typeof aiProviders)[number];
  baseUrl: string;
  model: string;
  apiKey?: string;
  prompt: string;
}) {
  if (input.provider === "openai") {
    const response = await fetch(`${input.baseUrl}/responses`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${input.apiKey}`,
      },
      body: JSON.stringify({
        model: input.model,
        input: input.prompt,
        store: false,
      }),
      signal: AbortSignal.timeout(60_000),
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
        messages: [{ role: "user", content: input.prompt }],
      }),
      signal: AbortSignal.timeout(60_000),
    });
    const data = (await checkedJson(response)) as {
      content?: Array<{ type?: string; text?: string }>;
    };
    const text = data.content?.find((item) => item.type === "text")?.text;
    if (!text) throw new Error("Anthropic returned no text output");
    return text;
  }
  const response = await fetch(`${input.baseUrl}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: input.model,
      stream: false,
      messages: [{ role: "user", content: input.prompt }],
    }),
    signal: AbortSignal.timeout(60_000),
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
