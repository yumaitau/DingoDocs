import { redirect } from "next/navigation";
import { ClientPortalShell } from "@/components/client-portal-shell";
import { getSession } from "@/lib/auth/session";
import { resolvePageOrganisation } from "@/lib/auth/active-organisation";
import { guardOrganisationMfa } from "@/lib/permissions/require";

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  const organisation = await resolvePageOrganisation(
    session.user.id,
    session.session.createdAt,
  );
  if (!organisation) redirect("/onboarding");
  if (
    organisation.role !== "client_user" &&
    organisation.role !== "client_administrator"
  )
    redirect("/dashboard");
  await guardOrganisationMfa({
    userId: session.user.id,
    organisationId: organisation.organisationId,
    role: organisation.role,
  });
  return (
    <ClientPortalShell
      organisationName={organisation.name}
      userName={session.user.name ?? session.user.email}
    >
      {children}
    </ClientPortalShell>
  );
}
