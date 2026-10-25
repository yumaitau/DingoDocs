"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export type RouteErrorProps = {
  error: Error & { digest?: string };
  retry: () => void;
};

/**
 * Shared fallback for route `error.tsx` boundaries. Never renders
 * `error.message` (it can carry sensitive detail); the digest lets operators
 * match the server-side log entry.
 */
export function RouteErrorFallback({
  error,
  retry,
  homeHref,
  homeLabel,
}: RouteErrorProps & { homeHref: string; homeLabel: string }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div
      role="alert"
      className="mx-auto my-12 max-w-lg rounded-xl border bg-paper p-6 text-center"
    >
      <h2 className="text-lg font-semibold tracking-[-0.01em]">
        Something went wrong
      </h2>
      <p className="mt-2 text-sm text-slate-600">
        This page could not be loaded. Try again, and contact your administrator
        if the problem continues.
      </p>
      {error.digest ? (
        <p className="mt-3 font-mono text-xs text-slate-500">
          Reference: {error.digest}
        </p>
      ) : null}
      <div className="mt-5 flex justify-center gap-2">
        <Button type="button" onClick={() => retry()}>
          Try again
        </Button>
        <Button asChild variant="secondary">
          <a href={homeHref}>{homeLabel}</a>
        </Button>
      </div>
    </div>
  );
}
