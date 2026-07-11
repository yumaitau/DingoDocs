import { Cable, Plus, Webhook } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { requirePermission } from "@/lib/permissions/require";

const providers = [
  {
    name: "Webhooks",
    detail: "Signed event delivery with retries and delivery logs",
    icon: Webhook,
  },
  {
    name: "Scanner imports",
    detail: "Nmap, Nessus, OpenVAS, ZAP, Burp Suite, CSV, and JSON",
    icon: Cable,
  },
];
export default async function IntegrationsPage() {
  await requirePermission("integration:configure");
  return (
    <>
      <PageHeader
        title="Integrations"
        description="Connect delivery systems without exposing engagement data by default."
        actions={
          <Button>
            <Plus className="size-4" />
            Add integration
          </Button>
        }
      />
      <div className="grid gap-4 px-4 py-6 sm:grid-cols-2 sm:px-6 lg:px-8">
        {providers.map(({ name, detail, icon: Icon }) => (
          <section key={name} className="rounded-xl border bg-paper p-5">
            <Icon className="size-5 text-[var(--harbour-600)]" />
            <h2 className="mt-4 text-sm font-semibold">{name}</h2>
            <p className="mt-1 text-sm leading-6 text-slate-500">{detail}</p>
            <Button variant="secondary" size="sm" className="mt-5">
              Configure
            </Button>
          </section>
        ))}
      </div>
    </>
  );
}
