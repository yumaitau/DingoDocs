"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import {
  importOrganisationBundleAction,
  type OrganisationImportState,
} from "@/server/actions/data-exchange";

const initial: OrganisationImportState = {};

export function OrganisationImportForm() {
  const [state, action, pending] = useActionState(
    importOrganisationBundleAction,
    initial,
  );
  return (
    <form action={action} className="space-y-4">
      <label className="block text-sm font-medium">
        Organisation export JSON
        <input
          type="file"
          name="file"
          required
          accept=".json,application/json"
          className="mt-1 block w-full text-sm"
        />
      </label>
      <Button type="submit" disabled={pending}>
        {pending ? "Importing…" : "Import organisation bundle"}
      </Button>
      {state.error || state.message ? (
        <p
          role={state.error ? "alert" : "status"}
          className={`rounded-md border p-3 text-sm ${state.error ? "border-red-200 bg-red-50 text-red-800" : "border-emerald-200 bg-emerald-50 text-slate-800"}`}
        >
          {state.error ?? state.message}
        </p>
      ) : null}
    </form>
  );
}
