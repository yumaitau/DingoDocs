import { and, count, eq, isNull } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { clientContacts, engagements } from "@/db/schema";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import { requireOrganisationContext } from "@/lib/permissions/require";
import { getClient } from "@/server/repositories/tenant";

export default async function ClientPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const context = await requireOrganisationContext();
  const client = await getClient(context, id);
  if (!client) notFound();
  const [contacts, engagementCount] = await Promise.all([
    db
      .select()
      .from(clientContacts)
      .where(
        and(
          eq(clientContacts.organisationId, context.organisationId),
          eq(clientContacts.clientId, id),
          isNull(clientContacts.deletedAt),
        ),
      )
      .limit(20),
    db
      .select({ value: count() })
      .from(engagements)
      .where(
        and(
          eq(engagements.organisationId, context.organisationId),
          eq(engagements.clientId, id),
          isNull(engagements.deletedAt),
        ),
      ),
  ]);
  return (
    <>
      <PageHeader
        title={client.name}
        description={client.legalName ?? "Client workspace"}
        breadcrumbs={[
          { label: "Clients", href: "/clients" },
          { label: client.name },
        ]}
        actions={<StatusPill tone="success">Active client</StatusPill>}
      />
      <div className="grid gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:px-8">
        <section className="rounded-xl border bg-paper">
          <div className="border-b p-5">
            <h2 className="text-base font-semibold">Client profile</h2>
          </div>
          <dl className="grid gap-x-8 gap-y-5 p-5 sm:grid-cols-2">
            <Item label="Industry" value={client.industry ?? "Not set"} />
            <Item
              label="Classification"
              value={client.securityClassification}
            />
            <Item label="Address" value={client.address ?? "Not set"} />
            <Item
              label="Active and historical engagements"
              value={String(engagementCount[0]?.value ?? 0)}
            />
          </dl>
        </section>
        <section className="rounded-xl border bg-paper">
          <div className="border-b p-5">
            <h2 className="text-base font-semibold">Contacts</h2>
            <p className="mt-1 text-xs text-slate-500">
              Portal access is granted per engagement.
            </p>
          </div>
          {contacts.length ? (
            <ul className="divide-y">
              {contacts.map((contact) => (
                <li key={contact.id} className="p-4">
                  <p className="text-sm font-medium">{contact.name}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {contact.email} · {contact.contactType}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="p-5 text-sm text-slate-500">
              No contacts have been added.
            </p>
          )}
        </section>
      </div>
    </>
  );
}
function Item({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium text-slate-500">{label}</dt>
      <dd className="mt-1 text-sm">{value}</dd>
    </div>
  );
}
