"use client"; // Error boundaries must be Client Components

import { useEffect } from "react";
import "./globals.css";

// Replaces the root layout when it fails, so it renders its own <html>/<body>
// and cannot rely on layout providers. Never shows error.message.
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <title>Something went wrong · DingoDocs</title>
        <main className="grid min-h-[100dvh] place-items-center bg-[var(--paper)] px-5">
          <div
            role="alert"
            className="w-full max-w-lg rounded-xl border bg-paper p-6 text-center"
          >
            <h1 className="text-lg font-semibold tracking-[-0.01em]">
              Something went wrong
            </h1>
            <p className="mt-2 text-sm text-slate-600">
              DingoDocs could not load. Try again, and contact your
              administrator if the problem continues.
            </p>
            {error.digest ? (
              <p className="mt-3 font-mono text-xs text-slate-500">
                Reference: {error.digest}
              </p>
            ) : null}
            <div className="mt-5 flex justify-center gap-2">
              <button
                type="button"
                onClick={() => retry()}
                className="inline-flex min-h-9 items-center rounded-md bg-primary px-3 text-sm font-medium text-white hover:bg-primary-hover"
              >
                Try again
              </button>
              {/* Full reload: the root layout itself failed. */}
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a
                href="/"
                className="inline-flex min-h-9 items-center rounded-md border bg-paper px-3 text-sm font-medium text-slate-700 hover:bg-muted"
              >
                Home
              </a>
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}
