import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { getSession } from "@/lib/auth/session";
import { acceptInvitationAction } from "@/server/actions/security";

export default async function InvitationPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const session = await getSession();
  if (!session)
    redirect(`/sign-in?next=${encodeURIComponent(`/invite/${token}`)}`);
  const accept = acceptInvitationAction.bind(null, token);
  return (
    <main className="mx-auto grid min-h-screen max-w-lg place-items-center p-6">
      <section className="w-full rounded-xl border bg-paper p-8 text-center shadow-sm">
        <h1 className="text-2xl font-semibold">Organisation invitation</h1>
        <p className="mt-3 text-sm text-slate-600">
          Accept this invitation as {session.user.email}. Invitations expire
          after 72 hours and can only be used once.
        </p>
        <form action={accept} className="mt-6">
          <Button size="lg">Accept invitation</Button>
        </form>
      </section>
    </main>
  );
}
