import Image from "next/image";
import Link from "next/link";
import dingoArtwork from "../../../docs/assets/dingodocs-banner.png";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="grid min-h-[100dvh] bg-paper lg:grid-cols-[minmax(0,1.1fr)_minmax(420px,0.9fr)]">
      <section className="relative isolate hidden overflow-hidden border-r bg-[var(--slate-950)] px-12 py-10 text-white lg:flex lg:flex-col">
        <Image
          src={dingoArtwork}
          alt=""
          fill
          sizes="58vw"
          loading="eager"
          className="-z-20 object-cover opacity-55"
        />
        <div
          className="absolute inset-0 -z-10 bg-[linear-gradient(90deg,rgba(34,18,12,0.94)_0%,rgba(34,18,12,0.72)_58%,rgba(34,18,12,0.36)_100%)]"
          aria-hidden="true"
        />
        <Link
          href="/"
          className="flex items-center gap-2 text-sm font-semibold text-[#fff3e5]"
        >
          <span className="grid size-8 place-items-center rounded-lg bg-[#a94727] text-white shadow-[0_12px_32px_rgba(45,17,8,0.35)]">
            D
          </span>
          DingoDocs
        </Link>
        <div className="my-auto max-w-xl">
          <p className="mb-4 text-sm font-semibold text-[#f0aa74]">
            Security assessment operations
          </p>
          <h1 className="max-w-[13ch] text-5xl font-semibold leading-[1.02] tracking-[-0.045em] text-[#fff3e5]">
            Keep every engagement defensible, from scope to final delivery.
          </h1>
          <p className="mt-5 max-w-[52ch] text-base leading-7 text-[#dfc5b0]">
            Plan work, preserve evidence, review findings, publish reports, and
            track remediation in one self-hosted workspace.
          </p>
        </div>
        <p className="text-xs text-[#c7aa92]">
          Open source. Self-hosted. Telemetry off by default.
        </p>
      </section>
      <section className="flex min-h-[100dvh] items-center justify-center bg-[var(--paper)] px-5 py-10 sm:px-10">
        {children}
      </section>
    </main>
  );
}
