"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import {
  updateTimeZoneAction,
  type TimeZoneState,
} from "@/server/actions/preferences";

const initial: TimeZoneState = {};

export function TimeZoneForm({
  timeZone,
  timeZones,
  currentDisplay,
}: {
  timeZone: string;
  timeZones: readonly string[];
  currentDisplay: string;
}) {
  const [state, action, pending] = useActionState(
    updateTimeZoneAction,
    initial,
  );
  return (
    <form action={action} className="mt-5 space-y-4">
      <label className="block text-sm font-medium" htmlFor="timeZone">
        Display time zone
      </label>
      <select
        id="timeZone"
        name="timeZone"
        defaultValue={timeZone}
        className="min-h-11 w-full rounded-md border bg-paper px-3 text-sm"
      >
        {timeZones.map((zone) => (
          <option key={zone} value={zone}>
            {zone}
          </option>
        ))}
      </select>
      <p className="text-sm text-slate-500">
        Current local display: {currentDisplay}
      </p>
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save time zone"}
      </Button>
      {state.error || state.message ? (
        <p
          role={state.error ? "alert" : "status"}
          className={`text-sm ${state.error ? "text-red-700" : "text-slate-600"}`}
        >
          {state.error ?? state.message}
        </p>
      ) : null}
    </form>
  );
}
