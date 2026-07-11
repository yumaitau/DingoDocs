import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { requirePermission } from "@/lib/permissions/require";
import { createEngagement } from "@/server/actions/engagements";

const types = [
  "External Penetration Test",
  "Internal Penetration Test",
  "Web Application Assessment",
  "API Assessment",
  "Mobile Application Assessment",
  "Cloud Security Review",
  "Red Team Exercise",
  "Purple Team Exercise",
  "Vulnerability Assessment",
];

export default async function NewEngagementPage() {
  const context = await requirePermission("engagement:create");
  const clientRows = await db
    .select({ id: clients.id, name: clients.name })
    .from(clients)
    .where(eq(clients.organisationId, context.organisationId))
    .orderBy(clients.name);
  return (
    <>
      <PageHeader
        title="New engagement"
        description="Create the assessment record now; scope, rules, team, and reporting can be completed in the workspace."
        breadcrumbs={[
          { label: "Engagements", href: "/engagements" },
          { label: "New engagement" },
        ]}
      />
      <div className="px-4 py-6 sm:px-6 lg:px-8">
        <form
          action={createEngagement}
          className="max-w-2xl space-y-7 rounded-xl border bg-paper p-5 sm:p-7"
        >
          <fieldset className="space-y-4">
            <legend className="text-base font-semibold">
              Engagement details
            </legend>
            <Field
              label="Engagement name"
              name="name"
              placeholder="Northstar external penetration test"
            />
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium">Client</span>
              <select
                required
                name="clientId"
                className="h-11 w-full rounded-md border bg-paper px-3 text-sm"
              >
                <option value="">Select a client</option>
                {clientRows.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                  </option>
                ))}
              </select>
              {!clientRows.length ? (
                <span className="mt-1.5 block text-xs text-amber-700">
                  Create a client before creating an engagement.
                </span>
              ) : null}
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium">
                Assessment type
              </span>
              <select
                required
                name="type"
                className="h-11 w-full rounded-md border bg-paper px-3 text-sm"
              >
                <option value="">Select assessment type</option>
                {types.map((type) => (
                  <option key={type}>{type}</option>
                ))}
              </select>
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Start date" name="startDate" type="date" />
              <Field label="End date" name="endDate" type="date" />
            </div>
          </fieldset>
          <div className="flex justify-end border-t pt-5">
            <Button disabled={!clientRows.length}>Create engagement</Button>
          </div>
        </form>
      </div>
    </>
  );
}

function Field({
  label,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      <input
        required
        className="h-11 w-full rounded-md border bg-paper px-3 text-sm"
        {...props}
      />
    </label>
  );
}
