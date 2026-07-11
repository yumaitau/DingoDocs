"use client";

import { LogOut, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOut } from "@/lib/auth/client";
import { cn } from "@/lib/utils";

export function ClientPortalShell({
  children,
  organisationName,
  userName,
}: {
  children: React.ReactNode;
  organisationName: string;
  userName: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-paper">
        <div className="mx-auto flex min-h-16 max-w-6xl flex-wrap items-center gap-4 px-4 py-3 sm:px-6">
          <Link href="/portal" className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-lg bg-primary text-sm font-bold text-white">
              D
            </span>
            <span>
              <span className="block text-sm font-semibold">
                DingoDocs portal
              </span>
              <span className="block text-xs text-slate-500">
                {organisationName}
              </span>
            </span>
          </Link>
          <nav
            className="ml-auto flex items-center gap-1"
            aria-label="Client portal"
          >
            <Link
              href="/portal"
              className={cn(
                "rounded-md px-3 py-2 text-sm font-medium",
                pathname === "/portal" ||
                  pathname.startsWith("/portal/engagements/")
                  ? "bg-primary-soft text-[var(--harbour-700)]"
                  : "text-slate-600 hover:bg-muted",
              )}
            >
              Engagements
            </Link>
            <Link
              href="/portal/security"
              className={cn(
                "rounded-md px-3 py-2 text-sm font-medium",
                pathname === "/portal/security"
                  ? "bg-primary-soft text-[var(--harbour-700)]"
                  : "text-slate-600 hover:bg-muted",
              )}
            >
              Security
            </Link>
            <button
              type="button"
              aria-label={`Sign out ${userName}`}
              className="ml-1 rounded-md p-2 text-slate-500 hover:bg-muted hover:text-slate-900"
              onClick={async () => {
                await signOut();
                router.push("/sign-in");
                router.refresh();
              }}
            >
              <LogOut className="size-4" />
            </button>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">{children}</main>
      <footer className="mx-auto flex max-w-6xl items-center gap-2 px-4 pb-8 text-xs text-slate-500 sm:px-6">
        <ShieldCheck className="size-4" /> Restricted to engagements explicitly
        shared with you.
      </footer>
    </div>
  );
}
