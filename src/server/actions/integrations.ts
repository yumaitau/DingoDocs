"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  createApiCredential,
  revokeApiCredential,
} from "@/lib/api/authentication";
import { apiScopes } from "@/lib/api/scopes";
import {
  aiConfirmation,
  aiProviders,
  notificationProviders,
} from "@/lib/integrations/constants";
import { requirePermission } from "@/lib/permissions/require";
import { configureAiProvider, requestAiDraft } from "@/server/services/ai";
import { createNotificationChannel } from "@/server/services/notifications";
import { createWebhook, rotateWebhookSecret } from "@/server/services/webhooks";

export type SecretActionState = {
  secret?: string;
  message?: string;
  error?: string;
};

export async function createApiKeyAction(
  _state: SecretActionState,
  formData: FormData,
): Promise<SecretActionState> {
  try {
    const actor = await requirePermission("integration:configure");
    const kind = z.enum(["personal", "service"]).parse(formData.get("kind"));
    const expires = z
      .string()
      .optional()
      .parse(formData.get("expiresAt") || undefined);
    const credential = await createApiCredential(actor, {
      name: z.string().trim().min(2).max(100).parse(formData.get("name")),
      kind,
      serviceAccountName:
        kind === "service"
          ? z
              .string()
              .trim()
              .min(2)
              .max(100)
              .parse(formData.get("serviceAccountName"))
          : undefined,
      scopes: z
        .array(z.enum(apiScopes))
        .min(1)
        .parse(formData.getAll("scopes")),
      expiresAt: expires ? new Date(`${expires}T23:59:59.999Z`) : undefined,
    });
    revalidatePath("/integrations");
    return {
      secret: credential.plaintext,
      message: "Copy this API key now. It cannot be shown again.",
    };
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message : "Could not create API key",
    };
  }
}

export async function revokeApiKeyAction(formData: FormData) {
  const actor = await requirePermission("integration:configure");
  await revokeApiCredential(
    actor,
    z.string().uuid().parse(formData.get("apiKeyId")),
  );
  revalidatePath("/integrations");
}

export async function createWebhookAction(
  _state: SecretActionState,
  formData: FormData,
): Promise<SecretActionState> {
  try {
    const actor = await requirePermission("integration:configure");
    const result = await createWebhook(actor, {
      name: z.string().trim().min(2).max(100).parse(formData.get("name")),
      url: z.string().url().parse(formData.get("url")),
      events: z
        .array(z.string().min(1).max(80))
        .min(1)
        .parse(formData.getAll("events")),
    });
    revalidatePath("/integrations");
    return { secret: result.secret, message: "Copy the signing secret now." };
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message : "Could not create webhook",
    };
  }
}

export async function rotateWebhookAction(
  _state: SecretActionState,
  formData: FormData,
): Promise<SecretActionState> {
  try {
    const actor = await requirePermission("integration:configure");
    const result = await rotateWebhookSecret(
      actor,
      z.string().uuid().parse(formData.get("webhookId")),
    );
    revalidatePath("/integrations");
    return {
      secret: result.secret,
      message:
        "Copy the new secret. The previous secret remains valid for 24 hours.",
    };
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Could not rotate webhook secret",
    };
  }
}

export async function createNotificationChannelAction(
  _state: SecretActionState,
  formData: FormData,
): Promise<SecretActionState> {
  try {
    const actor = await requirePermission("integration:configure");
    const provider = z
      .enum(notificationProviders)
      .parse(formData.get("provider"));
    await createNotificationChannel(actor, {
      name: z.string().trim().min(2).max(100).parse(formData.get("name")),
      provider,
      configuration: {
        url: z
          .string()
          .url()
          .optional()
          .parse(formData.get("url") || undefined),
        to: z
          .string()
          .email()
          .optional()
          .parse(formData.get("to") || undefined),
        userId: z
          .string()
          .uuid()
          .optional()
          .parse(formData.get("userId") || undefined),
      },
    });
    revalidatePath("/integrations");
    return { message: "Notification channel created." };
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message : "Could not create channel",
    };
  }
}

export async function configureAiAction(
  _state: SecretActionState,
  formData: FormData,
): Promise<SecretActionState> {
  try {
    const actor = await requirePermission("integration:configure");
    await configureAiProvider(actor, {
      provider: z.enum(aiProviders).parse(formData.get("provider")),
      model: z.string().trim().min(1).max(100).parse(formData.get("model")),
      baseUrl: z
        .string()
        .url()
        .optional()
        .parse(formData.get("baseUrl") || undefined),
      apiKey: z
        .string()
        .trim()
        .optional()
        .parse(formData.get("apiKey") || undefined),
      enabled: formData.get("enabled") === "on",
    });
    revalidatePath("/integrations");
    return { message: "AI provider configuration saved." };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Could not configure AI",
    };
  }
}

export async function requestAiDraftAction(
  _state: SecretActionState,
  formData: FormData,
): Promise<SecretActionState> {
  try {
    const actor = await requirePermission("finding:create");
    const result = await requestAiDraft(actor, {
      purpose: z.string().trim().min(2).max(100).parse(formData.get("purpose")),
      prompt: z
        .string()
        .trim()
        .min(10)
        .max(50_000)
        .parse(formData.get("prompt")),
      confirmation: z
        .literal(aiConfirmation)
        .parse(formData.get("confirmation")),
    });
    return {
      secret: result.draft,
      message: "Untrusted draft generated. Review before use.",
    };
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message : "Could not generate AI draft",
    };
  }
}
