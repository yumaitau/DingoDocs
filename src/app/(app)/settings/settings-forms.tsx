"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import {
  createScimTokenAction,
  saveJiraConnectionAction,
  saveSsoPolicyAction,
  testJiraConnectionAction,
  type SettingsSecretState,
} from "@/server/actions/security";

const field = "h-10 w-full rounded-md border bg-paper px-3 text-sm";
const initial: SettingsSecretState = {};

function Result({ state }: { state: SettingsSecretState }) {
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
          aria-label="One-time secret"
          className="mt-2 w-full rounded border bg-white p-2 font-mono text-xs"
          rows={3}
          value={state.secret}
        />
      ) : null}
    </div>
  );
}

export function JiraConnectionForm({
  defaultBaseUrl,
  defaultEmail,
  defaultProjectKey,
}: {
  defaultBaseUrl?: string;
  defaultEmail?: string;
  defaultProjectKey?: string;
}) {
  const [state, action, pending] = useActionState(
    saveJiraConnectionAction,
    initial,
  );
  const [testState, testAction, testPending] = useActionState(
    async (_prev: SettingsSecretState, _formData: FormData) =>
      testJiraConnectionAction(),
    initial,
  );
  return (
    <div className="space-y-3">
      <form action={action} className="space-y-3">
        <label className="block text-sm font-medium">
          Base URL
          <input
            className={`${field} mt-1`}
            name="baseUrl"
            type="url"
            required
            defaultValue={defaultBaseUrl}
            placeholder="https://example.atlassian.net"
          />
        </label>
        <label className="block text-sm font-medium">
          Email
          <input
            className={`${field} mt-1`}
            name="email"
            type="email"
            required
            defaultValue={defaultEmail}
          />
        </label>
        <label className="block text-sm font-medium">
          API token
          <input
            className={`${field} mt-1`}
            name="apiToken"
            type="password"
            required
            autoComplete="off"
          />
        </label>
        <label className="block text-sm font-medium">
          Project key
          <input
            className={`${field} mt-1`}
            name="projectKey"
            defaultValue={defaultProjectKey}
            placeholder="SEC"
          />
        </label>
        <label className="block text-sm font-medium">
          Issue type
          <input className={`${field} mt-1`} name="issueType" placeholder="Task" />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input name="enabled" type="checkbox" defaultChecked /> Enabled
        </label>
        <Button disabled={pending}>{pending ? "Saving…" : "Save Jira"}</Button>
        <Result state={state} />
      </form>
      <form action={testAction}>
        <Button variant="secondary" disabled={testPending}>
          {testPending ? "Testing…" : "Test connection"}
        </Button>
        <Result state={testState} />
      </form>
    </div>
  );
}

export function ScimTokenForm() {
  const [state, action, pending] = useActionState(createScimTokenAction, initial);
  return (
    <form action={action}>
      <Button disabled={pending}>
        {pending ? "Creating…" : "Create SCIM token"}
      </Button>
      <Result state={state} />
    </form>
  );
}

export function SsoPolicyForm({
  protocol,
  issuer,
  clientId,
  entryPoint,
  hasCertificate,
  scimGroupRolesJson,
  groupRolesJson,
}: {
  protocol?: "oidc" | "saml";
  issuer?: string;
  clientId?: string;
  entryPoint?: string;
  hasCertificate?: boolean;
  scimGroupRolesJson?: string;
  groupRolesJson?: string;
}) {
  const [state, action, pending] = useActionState(saveSsoPolicyAction, initial);
  return (
    <form action={action} className="space-y-3">
      <label className="block text-sm font-medium">
        Protocol
        <select
          className={`${field} mt-1`}
          name="protocol"
          defaultValue={protocol ?? "oidc"}
        >
          <option value="oidc">OIDC</option>
          <option value="saml">SAML</option>
        </select>
      </label>
      <label className="block text-sm font-medium">
        Issuer
        <input
          className={`${field} mt-1`}
          name="issuer"
          required
          defaultValue={issuer}
        />
      </label>
      <label className="block text-sm font-medium">
        Client ID
        <input
          className={`${field} mt-1`}
          name="clientId"
          required
          defaultValue={clientId}
        />
      </label>
      <label className="block text-sm font-medium">
        Client secret (OIDC)
        <input
          className={`${field} mt-1`}
          name="clientSecret"
          type="password"
          autoComplete="off"
        />
      </label>
      <label className="block text-sm font-medium">
        SAML entry point
        <input
          className={`${field} mt-1`}
          name="entryPoint"
          defaultValue={entryPoint}
        />
      </label>
      <label className="block text-sm font-medium">
        SAML IdP certificate {hasCertificate ? "(configured)" : ""}
        <textarea
          className="mt-1 min-h-24 w-full rounded-md border bg-paper p-2 font-mono text-xs"
          name="certificate"
          placeholder="-----BEGIN CERTIFICATE-----"
        />
      </label>
      <label className="block text-sm font-medium">
        SCIM group → role JSON
        <textarea
          className="mt-1 min-h-20 w-full rounded-md border bg-paper p-2 font-mono text-xs"
          name="scimGroupRoles"
          defaultValue={scimGroupRolesJson}
          placeholder='{"Engineers":"consultant"}'
        />
      </label>
      <label className="block text-sm font-medium">
        SSO group → role JSON
        <textarea
          className="mt-1 min-h-20 w-full rounded-md border bg-paper p-2 font-mono text-xs"
          name="groupRoles"
          defaultValue={groupRolesJson}
          placeholder='{"admins":"organisation_administrator"}'
        />
      </label>
      <Button disabled={pending}>{pending ? "Saving…" : "Save SSO policy"}</Button>
      <Result state={state} />
    </form>
  );
}
