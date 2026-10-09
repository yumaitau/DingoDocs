import postgres from "postgres";

type Sql = ReturnType<typeof postgres>;

export async function deleteAuditEventsForOrganisations(
  sql: Sql,
  organisationIds: readonly string[],
) {
  if (organisationIds.length === 0) return;
  await sql.begin(async (tx) => {
    await tx`alter table audit_events disable trigger audit_events_append_only`;
    await tx`delete from audit_events where organisation_id in ${tx([
      ...organisationIds,
    ])}`;
    await tx`alter table audit_events enable trigger audit_events_append_only`;
  });
}
