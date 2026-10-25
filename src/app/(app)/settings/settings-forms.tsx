"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import {
  addScimDomainAction,
  createScimTokenAction,
  removeScimDomainAction,
  saveJiraConnectionAction,
  saveSsoPolicyAction,
  testJiraConnectionAction,
  verifyScimDomainAction,
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
  configured = false,
  defaultBaseUrl,
  defaultEmail,
  defaultProjectKey,
  defaultIssueType,
  defaultEnabled = true,
}: {
  configured?: boolean;
  defaultBaseUrl?: string;
  defaultEmail?: string;
  defaultProjectKey?: string;
  defaultIssueType?: string;
  defaultEnabled?: boolean;
}) {
  const [state, action, pending] = useActionState(
    saveJiraConnectionAction,
    initial,
  );
  const [testState, testAction, testPending] = useActionState(
    async () => testJiraConnectionAction(),
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
            placeholder={
              configured ? "Re-enter the API token to save changes" : undefined
            }
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
          <input
            className={`${field} mt-1`}
            name="issueType"
            defaultValue={defaultIssueType}
            placeholder="Task"
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            name="enabled"
            type="checkbox"
            defaultChecked={defaultEnabled}
          />{" "}
          Enabled
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
  const [state, action, pending] = useActionState(
    createScimTokenAction,
    initial,
  );
  return (
    <form action={action}>
      <Button disabled={pending}>
        {pending ? "Creating…" : "Create SCIM token"}
      </Button>
      <Result state={state} />
    </form>
  );
}

export type ScimDomainView = {
  domain: string;
  verified: boolean;
  txtName: string;
  txtValue: string;
};

function ScimDomainRow({ entry }: { entry: ScimDomainView }) {
  const [verifyState, verifyAction, verifying] = useActionState(
    verifyScimDomainAction,
    initial,
  );
  const [removeState, removeAction, removing] = useActionState(
    removeScimDomainAction,
    initial,
  );
  return (
    <li className="rounded-md border p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">{entry.domain}</span>
        <span
          className={`rounded px-2 py-0.5 text-xs ${entry.verified ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}
        >
          {entry.verified ? "Verified" : "Pending verification"}
        </span>
      </div>
      {entry.verified ? null : (
        <dl className="mt-2 grid gap-1 text-xs">
          <dt className="text-slate-500">TXT record name</dt>
          <dd className="break-all font-mono">{entry.txtName}</dd>
          <dt className="text-slate-500">TXT record value</dt>
          <dd className="break-all font-mono">{entry.txtValue}</dd>
        </dl>
      )}
      <div className="mt-3 flex gap-2">
        {entry.verified ? null : (
          <form action={verifyAction}>
            <input type="hidden" name="domain" value={entry.domain} />
            <Button size="sm" disabled={verifying}>
              {verifying ? "Verifying…" : "Verify"}
            </Button>
          </form>
        )}
        <form action={removeAction}>
          <input type="hidden" name="domain" value={entry.domain} />
          <Button size="sm" variant="secondary" disabled={removing}>
            {removing ? "Removing…" : "Remove"}
          </Button>
        </form>
      </div>
      <Result state={verifyState} />
      <Result state={removeState} />
    </li>
  );
}

export function ScimDomainsForm({ domains }: { domains: ScimDomainView[] }) {
  const [state, action, pending] = useActionState(addScimDomainAction, initial);
  return (
    <div className="space-y-3">
      {domains.length ? (
        <ul className="space-y-2">
          {domains.map((entry) => (
            <ScimDomainRow key={entry.domain} entry={entry} />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-slate-500">
          No domains yet. SCIM can&apos;t create users until a domain is
          verified.
        </p>
      )}
      <form action={action} className="flex gap-2">
        <input
          className={`${field} min-w-0 flex-1`}
          name="domain"
          required
          placeholder="example.com"
          aria-label="Email domain"
        />
        <Button disabled={pending}>{pending ? "Adding…" : "Add domain"}</Button>
      </form>
      <Result state={state} />
    </div>
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
      <Button disabled={pending}>
        {pending ? "Saving…" : "Save SSO policy"}
      </Button>
      <Result state={state} />
    </form>
  );
}
