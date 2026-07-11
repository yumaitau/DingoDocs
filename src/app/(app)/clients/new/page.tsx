import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { requirePermission } from "@/lib/permissions/require";
import { createClient } from "@/server/actions/clients";

export default async function NewClientPage() {
  await requirePermission("client:manage");
  return (
    <>
      <PageHeader
        title="New client"
        description="Create the client boundary for contacts, engagements, evidence, and reporting preferences."
        breadcrumbs={[
          { label: "Clients", href: "/clients" },
          { label: "New client" },
        ]}
      />
      <div className="px-4 py-6 sm:px-6 lg:px-8">
        <form
          action={createClient}
          className="max-w-2xl space-y-5 rounded-xl border bg-paper p-5 sm:p-7"
        >
          <Field label="Client name" name="name" />
          <Field label="Legal name" name="legalName" required={false} />
          <Field label="Industry" name="industry" required={false} />
          <div className="flex justify-end border-t pt-5">
            <Button>Create client</Button>
          </div>
        </form>
      </div>
    </>
  );
}
function Field({
  label,
  required = true,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      <input
        required={required}
        className="h-11 w-full rounded-md border bg-paper px-3 text-sm"
        {...props}
      />
    </label>
  );
}
