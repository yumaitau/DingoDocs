import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { getSession } from "@/lib/auth/session";
import { resolveActiveOrganisation } from "@/lib/auth/active-organisation";
import { createOrganisation } from "@/server/actions/organisations";

export default async function OnboardingPage() {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  if (await resolveActiveOrganisation(session.user.id)) redirect("/dashboard");

  return (
    <main className="grid min-h-screen place-items-center bg-background px-5 py-10">
      <div className="w-full max-w-lg rounded-xl border bg-paper p-6 shadow-[0_16px_50px_rgba(28,45,65,0.08)] sm:p-8">
        <span className="grid size-10 place-items-center rounded-lg bg-primary font-semibold text-white">
          D
        </span>
        <p className="mt-7 text-sm font-medium text-[var(--harbour-700)]">
          Set up your workspace
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-[-0.02em]">
          Create an organisation
        </h1>
        <p className="mt-2 max-w-[55ch] text-sm leading-6 text-slate-600">
          Organisation boundaries isolate clients, engagements, evidence,
          reports, and team access.
        </p>
        <form action={createOrganisation} className="mt-7">
          <label>
            <span className="mb-1.5 block text-sm font-medium">
              Organisation name
            </span>
            <input
              name="name"
              required
              minLength={2}
              maxLength={100}
              autoFocus
              className="h-11 w-full rounded-md border bg-paper px-3 text-sm shadow-sm outline-none focus:border-[var(--harbour-500)]"
              placeholder="Example Security Consulting"
            />
          </label>
          <Button size="lg" className="mt-5 w-full">
            Create organisation
          </Button>
        </form>
      </div>
    </main>
  );
}
