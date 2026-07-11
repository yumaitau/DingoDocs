import { ChevronRight } from "lucide-react";
import Link from "next/link";

export function PageHeader({
  title,
  description,
  actions,
  breadcrumbs,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  breadcrumbs?: Array<{ label: string; href?: string }>;
}) {
  return (
    <header className="border-b bg-paper px-4 py-5 sm:px-6 lg:px-8">
      {breadcrumbs?.length ? (
        <nav
          aria-label="Breadcrumb"
          className="mb-3 flex items-center gap-1 text-xs text-slate-500"
        >
          {breadcrumbs.map((crumb, index) => (
            <span
              className="flex items-center gap-1"
              key={`${crumb.label}-${index}`}
            >
              {index ? (
                <ChevronRight aria-hidden="true" className="size-3" />
              ) : null}
              {crumb.href ? (
                <Link href={crumb.href} className="hover:text-slate-800">
                  {crumb.label}
                </Link>
              ) : (
                <span aria-current="page">{crumb.label}</span>
              )}
            </span>
          ))}
        </nav>
      ) : null}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-[-0.02em] sm:text-2xl">
            {title}
          </h1>
          {description ? (
            <p className="mt-1 max-w-[70ch] text-sm leading-6 text-slate-600">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 items-center gap-2">{actions}</div>
        ) : null}
      </div>
    </header>
  );
}
