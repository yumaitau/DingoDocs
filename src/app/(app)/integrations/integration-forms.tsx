"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { apiScopes } from "@/lib/api/scopes";
import {
  aiConfirmation,
  aiProviders,
  notificationProviders,
} from "@/lib/integrations/constants";
import {
  configureAiAction,
  createApiKeyAction,
  createNotificationChannelAction,
  createWebhookAction,
  requestAiDraftAction,
  rotateWebhookAction,
  type SecretActionState,
} from "@/server/actions/integrations";

const field = "h-10 w-full rounded-md border bg-paper px-3 text-sm";
const initial: SecretActionState = {};

function Result({ state }: { state: SecretActionState }) {
  if (!state.error && !state.message && !state.secret) return null;
  return (
    <div
      role={state.error ? "alert" : "status"}
      className={`mt-3 rounded-md border p-3 text-sm ${state.error ? "border-red-200 bg-red-50 text-red-800" : "border-amber-200 bg-amber-50 text-slate-800"}`}
    >
      <p>{state.error ?? state.message}</p>
      {state.secret ? (
        <textarea
          readOnly
          aria-label="One-time secret or untrusted draft"
          value={state.secret}
          className="mt-2 min-h-20 w-full rounded border bg-white p-2 font-mono text-xs"
          onFocus={(event) => event.currentTarget.select()}
        />
      ) : null}
    </div>
  );
}

export function ApiKeyForm() {
  const [state, action, pending] = useActionState(createApiKeyAction, initial);
  return (
    <form action={action} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <input
          className={field}
          name="name"
          required
          placeholder="Credential name"
        />
        <select className={field} name="kind" defaultValue="personal">
          <option value="personal">Personal access token</option>
          <option value="service">Service account</option>
        </select>
        <input
          className={field}
          name="serviceAccountName"
          placeholder="Service account name (if applicable)"
        />
        <input
          className={field}
          name="expiresAt"
          type="date"
          aria-label="Expiry date"
        />
      </div>
      <fieldset>
        <legend className="text-sm font-medium">Scopes</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {apiScopes.map((scope) => (
            <label key={scope} className="flex items-center gap-2 text-xs">
              <input type="checkbox" name="scopes" value={scope} /> {scope}
            </label>
          ))}
        </div>
      </fieldset>
      <Button disabled={pending}>
        {pending ? "Creating…" : "Create credential"}
      </Button>
      <Result state={state} />
    </form>
  );
}

export function WebhookForm() {
  const [state, action, pending] = useActionState(createWebhookAction, initial);
  return (
    <form action={action} className="space-y-3">
      <input
        className={field}
        name="name"
        required
        placeholder="Webhook name"
      />
      <input
        className={field}
        name="url"
        type="url"
        required
        placeholder="https://receiver.example/hooks/dingodocs"
      />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="events" value="*" defaultChecked /> All
        events
      </label>
      <Button disabled={pending}>
        {pending ? "Creating…" : "Create webhook"}
      </Button>
      <Result state={state} />
    </form>
  );
}

export function RotateWebhookForm({ webhookId }: { webhookId: string }) {
  const [state, action, pending] = useActionState(rotateWebhookAction, initial);
  return (
    <form action={action}>
      <input type="hidden" name="webhookId" value={webhookId} />
      <Button variant="secondary" size="sm" disabled={pending}>
        Rotate secret
      </Button>
      <Result state={state} />
    </form>
  );
}

export function NotificationChannelForm() {
  const [state, action, pending] = useActionState(
    createNotificationChannelAction,
    initial,
  );
  return (
    <form action={action} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <input
          className={field}
          name="name"
          required
          placeholder="Channel name"
        />
        <select className={field} name="provider">
          {notificationProviders.map((provider) => (
            <option key={provider}>{provider}</option>
          ))}
        </select>
        <input
          className={field}
          name="url"
          type="url"
          placeholder="Webhook URL for Teams, Slack, Discord, generic"
        />
        <input
          className={field}
          name="to"
          type="email"
          placeholder="SMTP recipient"
        />
        <input
          className={field}
          name="userId"
          placeholder="User UUID for in-app"
        />
      </div>
      <Button disabled={pending}>
        {pending ? "Creating…" : "Create channel"}
      </Button>
      <Result state={state} />
    </form>
  );
}

export function AiConfigurationForm() {
  const [state, action, pending] = useActionState(configureAiAction, initial);
  return (
    <form action={action} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <select className={field} name="provider">
          {aiProviders.map((provider) => (
            <option key={provider}>{provider}</option>
          ))}
        </select>
        <input
          className={field}
          name="model"
          required
          placeholder="Provider model identifier"
        />
        <input
          className={field}
          name="baseUrl"
          type="url"
          placeholder="Optional provider base URL"
        />
        <input
          className={field}
          name="apiKey"
          type="password"
          autoComplete="off"
          placeholder="Provider API key"
        />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input name="enabled" type="checkbox" /> Enable for this organisation
      </label>
      <Button disabled={pending}>
        {pending ? "Saving…" : "Save AI configuration"}
      </Button>
      <Result state={state} />
    </form>
  );
}

export function AiDraftForm() {
  const [state, action, pending] = useActionState(
    requestAiDraftAction,
    initial,
  );
  return (
    <form action={action} className="space-y-3">
      <input
        className={field}
        name="purpose"
        required
        placeholder="Purpose, e.g. remediation wording"
      />
      <textarea
        className="min-h-28 w-full rounded-md border p-3 text-sm"
        name="prompt"
        required
        placeholder="Content to send to the configured provider"
      />
      <label className="flex items-start gap-2 text-sm">
        <input
          className="mt-1"
          type="checkbox"
          name="confirmation"
          value={aiConfirmation}
          required
        />
        {aiConfirmation}. The result will be stored as an untrusted draft.
      </label>
      <Button disabled={pending}>
        {pending ? "Generating…" : "Generate untrusted draft"}
      </Button>
      <Result state={state} />
    </form>
  );
}
