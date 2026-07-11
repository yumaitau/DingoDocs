import { redirect } from "next/navigation";
import { ClientPortalShell } from "@/components/client-portal-shell";
import { getSession } from "@/lib/auth/session";
import { resolveActiveOrganisation } from "@/lib/auth/active-organisation";

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  const organisation = await resolveActiveOrganisation(session.user.id);
  if (!organisation) redirect("/onboarding");
  if (
    organisation.role !== "client_user" &&
    organisation.role !== "client_administrator"
  )
    redirect("/dashboard");
  return (
    <ClientPortalShell
      organisationName={organisation.name}
      userName={session.user.name ?? session.user.email}
    >
      {children}
    </ClientPortalShell>
  );
}
