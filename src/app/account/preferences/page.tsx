import { Clock3 } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { ClientPortalShell } from "@/components/client-portal-shell";
import { PageHeader } from "@/components/page-header";
import { requirePageSession } from "@/lib/auth/session";
import { requireOrganisationContext } from "@/lib/permissions/require";
import { formatDateTime, listSupportedTimeZones } from "@/lib/time-zone";
import { TimeZoneForm } from "./time-zone-form";

export default async function PreferencesPage() {
  const session = await requirePageSession();
  const context = await requireOrganisationContext();
  const content = (
    <>
      <PageHeader
        title="Personal preferences"
        description="Choose how dates and times appear throughout DingoDocs."
      />
      <div className="px-4 py-6 sm:px-6 lg:px-8">
        <section className="max-w-2xl rounded-xl border bg-paper p-5">
          <div className="flex items-start gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary-soft text-[var(--harbour-700)]">
              <Clock3 className="size-4" aria-hidden="true" />
            </span>
            <div>
              <h2 className="font-semibold">Time zone</h2>
              <p className="mt-1 text-sm text-slate-500">
                Date-time values are stored as UTC instants and displayed in
                your selected IANA time zone.
              </p>
            </div>
          </div>
          <TimeZoneForm
            timeZone={context.timeZone}
            timeZones={listSupportedTimeZones()}
            currentDisplay={formatDateTime(new Date(), context.timeZone)}
          />
        </section>
      </div>
    </>
  );
  const shellProps = {
    organisationName: context.name,
    userName: session.user.name ?? session.user.email,
  };
  const isClient =
    context.role === "client_user" || context.role === "client_administrator";

  return isClient ? (
    <ClientPortalShell {...shellProps}>{content}</ClientPortalShell>
  ) : (
    <AppShell {...shellProps}>{content}</AppShell>
  );
}
