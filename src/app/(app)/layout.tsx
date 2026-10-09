import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { isAccountSecurityPath } from "@/lib/auth/mfa-policy";
import { getSession } from "@/lib/auth/session";
import { resolveActiveOrganisation } from "@/lib/auth/active-organisation";
import { guardOrganisationMfa } from "@/lib/permissions/require";

export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  const organisation = await resolveActiveOrganisation(session.user.id);
  if (!organisation) redirect("/onboarding");
  const mfa = await guardOrganisationMfa({
    userId: session.user.id,
    organisationId: organisation.organisationId,
    role: organisation.role,
  });
  const pathname = (await headers()).get("x-pathname");
  const client =
    organisation.role === "client_user" ||
    organisation.role === "client_administrator";
  if (client && !(mfa.blocked && isAccountSecurityPath(pathname)))
    redirect("/portal");
  return (
    <AppShell
      organisationName={organisation.name}
      userName={session.user.name ?? session.user.email}
    >
      {children}
    </AppShell>
  );
}
