import Link from "next/link";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="grid min-h-screen bg-paper lg:grid-cols-[minmax(0,1.1fr)_minmax(420px,0.9fr)]">
      <section className="hidden border-r bg-[var(--mist)] px-12 py-10 lg:flex lg:flex-col">
        <Link
          href="/"
          className="flex items-center gap-2 text-sm font-semibold"
        >
          <span className="grid size-8 place-items-center rounded-lg bg-primary text-white">
            D
          </span>
          DingoDocs
        </Link>
        <div className="my-auto max-w-xl">
          <p className="mb-4 text-sm font-medium text-[var(--harbour-700)]">
            Security assessment operations
          </p>
          <h1 className="text-4xl font-semibold leading-[1.12] tracking-[-0.03em] text-slate-950">
            Keep every engagement defensible, from scope to final delivery.
          </h1>
          <p className="mt-5 max-w-[58ch] text-base leading-7 text-slate-600">
            Plan work, preserve evidence, review findings, publish reports, and
            track remediation in one self-hosted workspace.
          </p>
        </div>
        <p className="text-xs text-slate-500">
          Open source · Self-hosted · Telemetry off by default
        </p>
      </section>
      <section className="flex min-h-screen items-center justify-center px-5 py-10 sm:px-10">
        {children}
      </section>
    </main>
  );
}
