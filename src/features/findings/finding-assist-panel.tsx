"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { aiConfirmation } from "@/lib/integrations/constants";
import {
  acceptFindingAssistAction,
  requestFindingAssistAction,
  type FindingAssistState,
} from "@/server/actions/finding-assist";
import { enrichFindingIntelAction } from "@/server/actions/findings";

const initial: FindingAssistState = {};

const actions = [
  { value: "remediation", label: "Draft remediation" },
  { value: "executive", label: "Executive rewrite" },
  { value: "reproduction", label: "Expand reproduction" },
  { value: "scanner_summary", label: "Scanner summary" },
  { value: "executive_summary", label: "Engagement executive summary" },
  { value: "grammar", label: "Grammar pass" },
  { value: "translate", label: "Translate executive" },
  { value: "vision_caption", label: "Vision caption" },
] as const;

export function FindingAssistPanel({
  engagementId,
  findingId,
}: {
  engagementId: string;
  findingId: string;
}) {
  const [state, action, pending] = useActionState(
    requestFindingAssistAction,
    initial,
  );
  const [intelError, setIntelError] = useState<string | null>(null);
  const [intelPending, setIntelPending] = useState(false);

  async function enrich() {
    setIntelPending(true);
    setIntelError(null);
    const result = await enrichFindingIntelAction(engagementId, findingId);
    setIntelPending(false);
    if (result.error) setIntelError(result.error);
  }

  return (
    <details className="rounded-lg border p-4">
      <summary className="cursor-pointer font-medium">AI assist and intel</summary>
      <div className="mt-3 space-y-3">
        <form action={action} className="space-y-2">
          <input type="hidden" name="engagementId" value={engagementId} />
          <input type="hidden" name="findingId" value={findingId} />
          <label className="block text-sm font-medium">
            Action
            <select className={field} name="action" defaultValue="remediation">
              {actions.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-medium">
            Confirmation
            <input
              className={field}
              name="confirmation"
              required
              placeholder={aiConfirmation}
            />
          </label>
          <p className="text-xs text-slate-500">
            Type exactly: {aiConfirmation}
          </p>
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Generating…" : "Generate untrusted draft"}
          </Button>
        </form>
        {state.error ? (
          <p className="text-sm text-red-700">{state.error}</p>
        ) : null}
        {state.draft ? (
          <div className="space-y-2 rounded border bg-muted p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Untrusted draft
              {state.field ? ` → ${state.field}` : ""}
            </p>
            <pre className="whitespace-pre-wrap text-sm">{state.draft}</pre>
            {state.field && state.field !== "caption" ? (
              <form action={acceptFindingAssistAction}>
                <input type="hidden" name="engagementId" value={engagementId} />
                <input type="hidden" name="findingId" value={findingId} />
                <input type="hidden" name="field" value={state.field} />
                <input type="hidden" name="draft" value={state.draft} />
                <Button type="submit" size="sm">
                  Accept into {state.field}
                </Button>
              </form>
            ) : (
              <p className="text-xs text-slate-500">
                Copy this caption into an evidence note manually.
              </p>
            )}
          </div>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={intelPending}
          onClick={() => void enrich()}
        >
          {intelPending ? "Enriching…" : "Enrich EPSS / KEV / Exploit-DB"}
        </Button>
        {intelError ? (
          <p className="text-sm text-red-700">{intelError}</p>
        ) : null}
      </div>
    </details>
  );
}

const field =
  "mt-1 min-h-11 w-full rounded-md border bg-paper px-3 text-sm outline-none focus:border-[var(--harbour-500)]";
