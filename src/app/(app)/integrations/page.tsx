import { and, desc, eq, isNull } from "drizzle-orm";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { db } from "@/db";
import {
  aiConfigurations,
  apiKeys,
  notificationChannels,
  serviceAccounts,
  webhooks,
} from "@/db/schema";
import { requirePermission } from "@/lib/permissions/require";
import { revokeApiKeyAction } from "@/server/actions/integrations";
import { listWebhookFailures } from "@/server/services/webhooks";
import {
  AiConfigurationForm,
  AiDraftForm,
  ApiKeyForm,
  NotificationChannelForm,
  RotateWebhookForm,
  WebhookForm,
} from "./integration-forms";

export default async function IntegrationsPage() {
  const context = await requirePermission("integration:configure");
  const [keys, hooks, channels, ai, failures] = await Promise.all([
    db
      .select({
        id: apiKeys.id,
        name: apiKeys.name,
        kind: apiKeys.kind,
        prefix: apiKeys.keyPrefix,
        scopes: apiKeys.scopes,
        expiresAt: apiKeys.expiresAt,
        serviceAccount: serviceAccounts.name,
      })
      .from(apiKeys)
      .leftJoin(
        serviceAccounts,
        eq(serviceAccounts.id, apiKeys.serviceAccountId),
      )
      .where(
        and(
          eq(apiKeys.organisationId, context.organisationId),
          isNull(apiKeys.revokedAt),
        ),
      )
      .orderBy(desc(apiKeys.createdAt)),
    db
      .select({
        id: webhooks.id,
        name: webhooks.name,
        url: webhooks.url,
        events: webhooks.events,
        version: webhooks.secretVersion,
      })
      .from(webhooks)
      .where(eq(webhooks.organisationId, context.organisationId)),
    db
      .select({
        id: notificationChannels.id,
        name: notificationChannels.name,
        provider: notificationChannels.provider,
      })
      .from(notificationChannels)
      .where(eq(notificationChannels.organisationId, context.organisationId)),
    db
      .select({
        provider: aiConfigurations.provider,
        model: aiConfigurations.model,
        enabled: aiConfigurations.enabled,
      })
      .from(aiConfigurations)
      .where(eq(aiConfigurations.organisationId, context.organisationId))
      .limit(1),
    listWebhookFailures(context.organisationId),
  ]);

  return (
    <>
      <PageHeader
        title="Integrations and automation"
        description="Capture pen-test write-ups and evidence from the CLI with scoped MCP tools, alongside webhooks and automation."
      />
      <div className="grid gap-6 px-4 py-6 sm:px-6 xl:grid-cols-2 lg:px-8">
        <section className="rounded-xl border border-cyan-200 bg-cyan-50 p-5 xl:col-span-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-cyan-800">
            Built for the terminal
          </p>
          <h2 className="mt-1 text-xl font-semibold text-slate-950">
            MCP server for live testing notes
          </h2>
          <p className="mt-2 max-w-3xl text-sm text-slate-700">
            Give your CLI agent a scoped DingoDocs credential and send evidence,
            finding write-ups, and review-ready updates as you work. Every
            mutation uses the same tenant boundaries and audit trail as the web
            app.
          </p>
          <pre className="mt-4 overflow-x-auto rounded-lg bg-slate-950 p-4 text-xs text-cyan-100">
            <code>{`DINGODOCS_URL=http://localhost:3000
DINGODOCS_API_KEY=dd_pat_… pnpm mcp`}</code>
          </pre>
          <p className="mt-3 text-xs text-cyan-900">
            Tools include <code>capture_evidence</code>,{" "}
            <code>create_finding_write_up</code>,{" "}
            <code>update_finding_write_up</code>, and{" "}
            <code>attach_evidence_to_finding</code>.
          </p>
        </section>
        <section className="rounded-xl border bg-paper p-5">
          <h2 className="font-semibold">API credentials</h2>
          <p className="mt-1 text-sm text-slate-500">
            Personal and service credentials are hashed at rest. Plaintext
            appears once.
          </p>
          <div className="mt-4">
            <ApiKeyForm />
          </div>
          <ul className="mt-5 divide-y border-t">
            {keys.map((key) => (
              <li key={key.id} className="flex items-start gap-3 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {key.name} · {key.prefix}…
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {key.kind}
                    {key.serviceAccount
                      ? ` · ${key.serviceAccount}`
                      : ""} · {key.scopes.join(", ")}
                  </p>
                </div>
                <form action={revokeApiKeyAction}>
                  <input type="hidden" name="apiKeyId" value={key.id} />
                  <Button variant="secondary" size="sm">
                    Revoke
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-xl border bg-paper p-5">
          <h2 className="font-semibold">Signed webhooks</h2>
          <p className="mt-1 text-sm text-slate-500">
            HMAC-SHA256 signatures include an event ID and five-minute timestamp
            window.
          </p>
          <div className="mt-4">
            <WebhookForm />
          </div>
          <ul className="mt-5 divide-y border-t">
            {hooks.map((hook) => (
              <li key={hook.id} className="py-3 text-sm">
                <p className="font-medium">
                  {hook.name} · secret v{hook.version}
                </p>
                <p className="truncate text-xs text-slate-500">{hook.url}</p>
                <div className="mt-2">
                  <RotateWebhookForm webhookId={hook.id} />
                </div>
              </li>
            ))}
          </ul>
          {failures.length ? (
            <p className="mt-3 rounded bg-red-50 p-3 text-sm text-red-800">
              {failures.length} webhook delivery failure(s) require attention.
            </p>
          ) : null}
        </section>

        <section className="rounded-xl border bg-paper p-5">
          <h2 className="font-semibold">Notification channels</h2>
          <p className="mt-1 text-sm text-slate-500">
            In-app, SMTP, Teams, Slack, Discord, and generic webhook providers
            send titles and links only.
          </p>
          <div className="mt-4">
            <NotificationChannelForm />
          </div>
          <ul className="mt-5 divide-y border-t">
            {channels.map((channel) => (
              <li key={channel.id} className="py-3 text-sm">
                {channel.name} · {channel.provider}
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-xl border bg-paper p-5">
          <h2 className="font-semibold">Optional AI provider</h2>
          <p className="mt-1 text-sm text-slate-500">
            Deployment default: disabled. Organisation:{" "}
            {ai[0]?.enabled ? `${ai[0].provider} / ${ai[0].model}` : "disabled"}
            .
          </p>
          <div className="mt-4">
            <AiConfigurationForm />
          </div>
          <div className="mt-6 border-t pt-5">
            <AiDraftForm />
          </div>
        </section>
      </div>
    </>
  );
}
