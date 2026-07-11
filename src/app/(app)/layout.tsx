import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { getSession } from "@/lib/auth/session";
import { resolveActiveOrganisation } from "@/lib/auth/active-organisation";

export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  const organisation = await resolveActiveOrganisation(session.user.id);
  if (!organisation) redirect("/onboarding");
  return (
    <AppShell
      organisationName={organisation.name}
      userName={session.user.name ?? session.user.email}
    >
      {children}
    </AppShell>
  );
}
