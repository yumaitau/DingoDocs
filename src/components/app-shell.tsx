"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Command } from "cmdk";
import {
  Activity,
  ArrowLeftRight,
  BookOpen,
  Building2,
  Cable,
  ChartNoAxesCombined,
  CheckSquare,
  ClipboardList,
  ChevronRight,
  Clock3,
  FileText,
  Gauge,
  History,
  Library,
  Menu,
  Search,
  Settings,
  ShieldCheck,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";

type NavItem = { label: string; href: string; icon: LucideIcon };
const primary: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: Gauge },
  { label: "Analytics", href: "/analytics", icon: ChartNoAxesCombined },
  { label: "Clients", href: "/clients", icon: Building2 },
  { label: "Engagements", href: "/engagements", icon: ShieldCheck },
  { label: "Findings Library", href: "/findings-library", icon: Library },
  { label: "Reports", href: "/reports", icon: FileText },
  { label: "Tasks", href: "/tasks", icon: CheckSquare },
  { label: "Runbooks", href: "/runbooks", icon: ClipboardList },
  { label: "Templates", href: "/templates", icon: BookOpen },
  { label: "Imports & Exports", href: "/imports", icon: ArrowLeftRight },
];
const secondary: NavItem[] = [
  { label: "Preferences", href: "/account/preferences", icon: Clock3 },
  { label: "Team", href: "/team", icon: Users },
  { label: "Audit Log", href: "/audit", icon: History },
  { label: "Integrations", href: "/integrations", icon: Cable },
  { label: "Settings", href: "/settings", icon: Settings },
];

export function AppShell({
  children,
  organisationName,
  userName,
}: {
  children: React.ReactNode;
  organisationName: string;
  userName: string;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const appShellRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    const appShell = appShellRef.current;
    appShell?.setAttribute("data-command-palette-ready", "true");
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      appShell?.setAttribute("data-command-palette-ready", "false");
    };
  }, []);

  const nav = (
    <Navigation
      pathname={pathname}
      organisationName={organisationName}
      userName={userName}
      onNavigate={() => setMobileOpen(false)}
      onSearch={() => {
        setMobileOpen(false);
        setPaletteOpen(true);
      }}
    />
  );

  return (
    <div
      ref={appShellRef}
      className="min-h-screen bg-background lg:grid lg:grid-cols-[248px_minmax(0,1fr)]"
      data-command-palette-ready="false"
    >
      <aside className="sticky top-0 hidden h-screen border-r bg-[var(--paper)] lg:block">
        {nav}
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b bg-[color:var(--paper)]/95 px-4 lg:hidden">
          <button
            type="button"
            aria-label="Open navigation"
            className="rounded-md p-2 hover:bg-muted"
            onClick={() => setMobileOpen(true)}
          >
            <Menu className="size-5" />
          </button>
          <span className="text-sm font-semibold">DingoDocs</span>
          <button
            type="button"
            aria-label="Open command palette"
            className="rounded-md p-2 hover:bg-muted"
            onClick={() => setPaletteOpen(true)}
          >
            <Search className="size-5" />
          </button>
        </header>
        <main className="min-w-0">{children}</main>
      </div>

      <Dialog.Root open={mobileOpen} onOpenChange={setMobileOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-slate-950/30" />
          <Dialog.Content className="fixed inset-y-0 left-0 z-50 w-[min(88vw,300px)] border-r bg-paper shadow-xl">
            <Dialog.Title className="sr-only">Navigation</Dialog.Title>
            <Dialog.Close
              aria-label="Close navigation"
              className="absolute right-3 top-3 z-10 rounded-md p-2 hover:bg-muted"
            >
              <X className="size-4" />
            </Dialog.Close>
            {nav}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}

function Navigation({
  pathname,
  organisationName,
  userName,
  onNavigate,
  onSearch,
}: {
  pathname: string;
  organisationName: string;
  userName: string;
  onNavigate: () => void;
  onSearch: () => void;
}) {
  return (
    <div className="flex h-full flex-col px-3 py-3">
      <div className="flex h-10 items-center gap-2 px-2">
        <span className="grid size-7 place-items-center rounded-lg bg-primary text-xs font-bold text-white">
          D
        </span>
        <div className="min-w-0">
          <div className="text-sm font-semibold leading-tight">DingoDocs</div>
          <div className="truncate text-[11px] text-slate-500">
            {organisationName}
          </div>
        </div>
      </div>
      <button
        type="button"
        onClick={onSearch}
        className="state-transition mt-4 flex h-9 w-full items-center gap-2 rounded-md border bg-[var(--mist)] px-2.5 text-left text-sm text-slate-500 hover:border-slate-300 hover:text-slate-700"
      >
        <Search className="size-4" aria-hidden="true" />
        <span className="flex-1">Search or jump to</span>
        <kbd className="rounded border bg-paper px-1.5 py-0.5 font-sans text-[10px]">
          ⌘K
        </kbd>
      </button>
      <nav aria-label="Primary" className="mt-4 space-y-1">
        {primary.map((item) => (
          <NavLink
            key={item.href}
            item={item}
            active={
              pathname === item.href || pathname.startsWith(`${item.href}/`)
            }
            onClick={onNavigate}
          />
        ))}
      </nav>
      <div className="my-3 border-t" />
      <nav aria-label="Administration" className="space-y-1">
        {secondary.map((item) => (
          <NavLink
            key={item.href}
            item={item}
            active={
              pathname === item.href || pathname.startsWith(`${item.href}/`)
            }
            onClick={onNavigate}
          />
        ))}
      </nav>
      <div className="mt-auto border-t pt-3">
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-muted"
        >
          <span className="grid size-7 place-items-center rounded-full bg-[var(--harbour-100)] text-xs font-semibold text-[var(--harbour-700)]">
            {userName.slice(0, 2).toUpperCase()}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm font-medium">
            {userName}
          </span>
          <ChevronRight className="size-4 text-slate-400" />
        </button>
      </div>
    </div>
  );
}

function NavLink({
  item,
  active,
  onClick,
}: {
  item: NavItem;
  active: boolean;
  onClick: () => void;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "state-transition flex h-9 items-center gap-2.5 rounded-md px-2.5 text-sm font-medium",
        active
          ? "bg-[var(--harbour-50)] text-[var(--harbour-700)]"
          : "text-slate-600 hover:bg-muted hover:text-slate-950",
      )}
    >
      <Icon aria-hidden="true" className="size-4" />
      {item.label}
    </Link>
  );
}

function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const items = useMemo(() => [...primary, ...secondary], []);
  const [results, setResults] = useState<
    Array<{
      type: string;
      id: string;
      title: string;
      subtitle: string;
      href: string;
    }>
  >([]);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-950/35" />
        <Dialog.Content className="fixed left-1/2 top-[12vh] z-50 w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-xl border bg-paper shadow-[0_24px_80px_rgba(28,45,65,0.22)]">
          <Dialog.Title className="sr-only">Command palette</Dialog.Title>
          <Command label="Global command palette" className="w-full">
            <div className="flex items-center gap-2 border-b px-4">
              <Search aria-hidden="true" className="size-4 text-slate-400" />
              <Command.Input
                autoFocus
                placeholder="Search pages, clients, engagements, or actions"
                onValueChange={(query) => {
                  if (query.trim().length < 2) return setResults([]);
                  fetch(`/api/search?q=${encodeURIComponent(query)}`)
                    .then((response) =>
                      response.ok ? response.json() : { results: [] },
                    )
                    .then((value: { results?: typeof results }) =>
                      setResults(value.results ?? []),
                    )
                    .catch(() => setResults([]));
                }}
                className="h-13 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400"
              />
              <kbd className="rounded border bg-muted px-1.5 py-0.5 text-[10px] text-slate-500">
                esc
              </kbd>
            </div>
            <Command.List className="scrollbar-subtle max-h-[min(420px,60vh)] overflow-y-auto p-2">
              <Command.Empty className="px-3 py-10 text-center text-sm text-slate-500">
                No matching commands
              </Command.Empty>
              <Command.Group
                heading="Search results"
                className="text-xs text-slate-500 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-2"
              >
                {results.map((result) => (
                  <Command.Item
                    key={`${result.type}-${result.id}`}
                    value={`${result.title} ${result.subtitle}`}
                    onSelect={() => {
                      router.push(result.href);
                      onOpenChange(false);
                    }}
                    className="flex cursor-default items-center justify-between gap-3 rounded-md px-2 py-2.5 text-sm text-slate-700 data-[selected=true]:bg-[var(--harbour-50)]"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">
                        {result.title}
                      </span>
                      <span className="block truncate text-xs text-slate-500">
                        {result.subtitle}
                      </span>
                    </span>
                    <span className="text-[10px] uppercase text-slate-400">
                      {result.type}
                    </span>
                  </Command.Item>
                ))}
              </Command.Group>
              <Command.Group
                heading="Navigate"
                className="text-xs text-slate-500 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-2"
              >
                {items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <Command.Item
                      key={item.href}
                      value={item.label}
                      onSelect={() => {
                        router.push(item.href);
                        onOpenChange(false);
                      }}
                      className="flex cursor-default items-center gap-2.5 rounded-md px-2 py-2.5 text-sm text-slate-700 data-[selected=true]:bg-[var(--harbour-50)] data-[selected=true]:text-[var(--harbour-700)]"
                    >
                      <Icon className="size-4" />
                      {item.label}
                    </Command.Item>
                  );
                })}
              </Command.Group>
              <Command.Separator className="my-1 border-t" />
              <Command.Group
                heading="Quick actions"
                className="text-xs text-slate-500 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-2"
              >
                <Command.Item
                  onSelect={() => {
                    router.push("/engagements/new");
                    onOpenChange(false);
                  }}
                  className="flex cursor-default items-center gap-2.5 rounded-md px-2 py-2.5 text-sm text-slate-700 data-[selected=true]:bg-[var(--harbour-50)]"
                >
                  <Activity className="size-4" />
                  Create engagement
                </Command.Item>
              </Command.Group>
            </Command.List>
          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
