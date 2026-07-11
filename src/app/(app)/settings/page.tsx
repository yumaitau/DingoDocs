import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { requirePermission } from "@/lib/permissions/require";

export default async function SettingsPage() {
  const context = await requirePermission("user:manage");
  return (
    <>
      <PageHeader
        title="Settings"
        description="Security, retention, authentication, storage, and organisation defaults."
      />
      <div className="grid gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[220px_minmax(0,720px)] lg:px-8">
        <nav aria-label="Settings sections" className="space-y-1">
          {[
            "General",
            "Authentication",
            "Security",
            "Risk matrices",
            "Data retention",
            "Storage",
            "Email",
            "API",
          ].map((item, index) => (
            <button
              key={item}
              className={`block w-full rounded-md px-3 py-2 text-left text-sm ${index === 0 ? "bg-[var(--harbour-50)] font-medium text-[var(--harbour-700)]" : "text-slate-600 hover:bg-muted"}`}
            >
              {item}
            </button>
          ))}
        </nav>
        <section className="rounded-xl border bg-paper">
          <div className="border-b p-5">
            <h2 className="text-base font-semibold">Organisation settings</h2>
            <p className="mt-1 text-sm text-slate-500">
              Defaults apply only within {context.name}.
            </p>
          </div>
          <form className="space-y-5 p-5">
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium">
                Organisation name
              </span>
              <input
                defaultValue={context.name}
                className="h-10 w-full rounded-md border px-3 text-sm"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium">
                Default security classification
              </span>
              <select className="h-10 w-full rounded-md border bg-paper px-3 text-sm">
                <option>Confidential</option>
                <option>Protected</option>
                <option>Official</option>
              </select>
            </label>
            <div className="flex justify-end border-t pt-5">
              <Button>Save changes</Button>
            </div>
          </form>
        </section>
      </div>
    </>
  );
}
