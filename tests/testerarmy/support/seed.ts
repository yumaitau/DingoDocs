import { hashPassword } from "better-auth/crypto";
import { db, sqlClient } from "../../../src/db";
import {
  accounts,
  clientContacts,
  engagementContacts,
  findings,
  notifications,
  organisationMembers,
  users,
} from "../../../src/db/schema";

const database = new URL(process.env.DATABASE_URL!);
if (
  !database.pathname.endsWith("_e2e") ||
  !["127.0.0.1", "localhost", "[::1]"].includes(database.hostname)
)
  throw new Error("Disposable local database required");
const password = process.env.TESTERARMY_PASSWORD;
if (!password)
  throw new Error("Use pnpm test:e2e:army to seed test identities");
const organisationId = "0197f30f-122c-7000-8000-000000000002";
const clientId = "0197f30f-122c-7000-8000-000000000003";
const engagementId = "0197f30f-122c-7000-8000-000000000004";
async function main() {
  if (!password) throw new Error("Test password required");
  try {
    for (const [id, title, actionUrl] of [
      [
        "0197f30f-122c-7000-8000-000000000106",
        "Army navigation notification",
        "/clients",
      ],
      ["0197f30f-122c-7000-8000-000000000107", "Army bulk notification", null],
    ] as const) {
      // Keep fixtures on the inbox's first page while other workflows emit events.
      const createdAt = new Date(Date.now() + 3_600_000);
      await db
        .insert(notifications)
        .values({
          id,
          organisationId,
          userId: "0197f30f-122c-7000-8000-000000000001",
          eventType: "testerarmy.shell",
          title,
          actionUrl,
          createdAt,
        })
        .onConflictDoUpdate({
          target: notifications.id,
          set: { readAt: null, createdAt },
        });
    }
    for (const [name, id] of [
      ["portal", "0197f30f-122c-7000-8000-000000000101"],
      ["newcomer", "0197f30f-122c-7000-8000-000000000102"],
      ["reviewer", "0197f30f-122c-7000-8000-000000000105"],
      ["qa", "0197f30f-122c-7000-8000-000000000108"],
    ]) {
      await db
        .insert(users)
        .values({
          id,
          name: `Tester Army ${name}`,
          email: `${name}@testerarmy.invalid`,
          emailVerified: true,
        })
        .onConflictDoNothing();
      await db
        .insert(accounts)
        .values({
          userId: id,
          providerId: "credential",
          accountId: id,
          password: await hashPassword(password),
        })
        .onConflictDoUpdate({
          target: [accounts.providerId, accounts.accountId],
          set: { password: await hashPassword(password) },
        });
    }
    const portalId = "0197f30f-122c-7000-8000-000000000101";
    // Reviewer and QA are distinct from the admin author: findings need
    // separate peer review, QA approval and publication identities.
    await db
      .insert(organisationMembers)
      .values(
        [
          "0197f30f-122c-7000-8000-000000000105",
          "0197f30f-122c-7000-8000-000000000108",
        ].map((userId) => ({
          organisationId,
          userId,
          role: "organisation_administrator" as const,
          joinedAt: new Date(),
        })),
      )
      .onConflictDoNothing();
    await db
      .insert(findings)
      .values({
        id: "0197f30f-122c-7000-8000-000000000104",
        organisationId,
        engagementId,
        identifier: "ARMY-PORTAL-001",
        title: "Synthetic published portal finding",
        severity: "medium",
        status: "published",
        clientVisible: true,
        approvedVersion: 1,
        publishedAt: new Date(),
        executiveSummary: "Synthetic finding for client portal tests.",
        remediation: "Apply synthetic fix and request verification.",
      })
      .onConflictDoNothing();
    await db
      .insert(organisationMembers)
      .values({
        organisationId,
        userId: portalId,
        role: "client_user",
        joinedAt: new Date(),
      })
      .onConflictDoNothing();
    const contactId = "0197f30f-122c-7000-8000-000000000103";
    await db
      .insert(clientContacts)
      .values({
        id: contactId,
        organisationId,
        clientId,
        userId: portalId,
        name: "Tester Army portal",
        email: "portal@testerarmy.invalid",
      })
      .onConflictDoNothing();
    await db
      .insert(engagementContacts)
      .values({
        organisationId,
        engagementId,
        contactId,
        accessLevel: "standard",
      })
      .onConflictDoNothing();
  } finally {
    await sqlClient.end();
  }
}
void main();
