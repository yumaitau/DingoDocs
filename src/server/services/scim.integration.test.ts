import { randomUUID } from "node:crypto";
import { deleteAuditEventsForOrganisations } from "@/server/testing/delete-audit-events";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const testUrl = process.env.TEST_DATABASE_URL;
const run = testUrl ? describe : describe.skip;

run("SCIM provisioning with PostgreSQL", () => {
  const ids = {
    orgA: randomUUID(),
    orgB: randomUUID(),
    owner: randomUUID(),
    shared: randomUUID(),
    outsider: randomUUID(),
    squatter: randomUUID(),
  };
  // Unique per run so concurrent suites never share a verified domain.
  const domain = `scim-${ids.orgA}.test.invalid`;
  const newEmail = `scim-new-${ids.orgA}@${domain}`;
  const unverifiedDomainEmail = `scim-nope-${ids.orgA}@other-${ids.orgA}.test.invalid`;
  const claimDomain = `claim-${ids.orgA}.test.invalid`;
  let modules: Awaited<ReturnType<typeof load>>;

  const membership = async (organisationId: string, userId: string) => {
    const [row] = await modules.db
      .select()
      .from(modules.organisationMembers)
      .where(
        modules.and(
          modules.eq(
            modules.organisationMembers.organisationId,
            organisationId,
          ),
          modules.eq(modules.organisationMembers.userId, userId),
        ),
      );
    return row;
  };

  const user = async (userId: string) => {
    const [row] = await modules.db
      .select()
      .from(modules.users)
      .where(modules.eq(modules.users.id, userId));
    return row;
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = testUrl;
    modules = await load();
    await modules.db.insert(modules.users).values(
      (["owner", "shared", "outsider", "squatter"] as const).map((key) => ({
        id: ids[key],
        name: `SCIM ${key}`,
        email: `scim-${key}-${ids[key]}@${domain}`,
        emailVerified: key !== "squatter",
      })),
    );
    await modules.db.insert(modules.organisations).values([
      {
        id: ids.orgA,
        slug: `scim-a-${ids.orgA}`,
        name: "SCIM A",
        securityPolicy: {
          scimDomains: [
            { domain, token: "fixture", verifiedAt: new Date().toISOString() },
            { domain: `other-${ids.orgA}.test.invalid`, token: "pending" },
          ],
        },
      },
      { id: ids.orgB, slug: `scim-b-${ids.orgB}`, name: "SCIM B" },
    ]);
    await modules.db.insert(modules.organisationMembers).values([
      {
        organisationId: ids.orgA,
        userId: ids.owner,
        role: "organisation_owner",
      },
      { organisationId: ids.orgA, userId: ids.shared, role: "read_only" },
      { organisationId: ids.orgB, userId: ids.shared, role: "consultant" },
      { organisationId: ids.orgB, userId: ids.outsider, role: "consultant" },
    ]);
  });

  afterAll(async () => {
    if (!modules) return;
    await deleteAuditEventsForOrganisations(modules.sqlClient, [
      ids.orgA,
      ids.orgB,
    ]);
    await modules.db
      .delete(modules.organisations)
      .where(modules.inArray(modules.organisations.id, [ids.orgA, ids.orgB]));
    await modules.db
      .delete(modules.users)
      .where(
        modules.or(
          modules.inArray(modules.users.id, [
            ids.owner,
            ids.shared,
            ids.outsider,
            ids.squatter,
          ]),
          modules.inArray(modules.users.email, [
            newEmail,
            unverifiedDomainEmail,
          ]),
        ),
      );
    await modules.sqlClient.end();
  });

  it("rejects creates whose email domain is not verified for the organisation", async () => {
    const subdomainEmail = `someone-${ids.orgA}@x.${domain}`;
    for (const userName of [unverifiedDomainEmail, subdomainEmail])
      await expect(
        modules.createScimUser(ids.orgA, { userName }),
      ).rejects.toMatchObject({ status: 403, scimType: "invalidValue" });
    // orgB has verified nothing, so it can't claim orgA's users either.
    await expect(
      modules.createScimUser(ids.orgB, { userName: newEmail }),
    ).rejects.toMatchObject({ status: 403 });
    const rows = await modules.db
      .select({ id: modules.users.id })
      .from(modules.users)
      .where(
        modules.inArray(modules.users.email, [
          unverifiedDomainEmail,
          subdomainEmail,
          newEmail,
        ]),
      );
    expect(rows).toEqual([]);
  });

  it("refuses to adopt an existing unverified account", async () => {
    const before = await user(ids.squatter);
    await expect(
      modules.createScimUser(ids.orgA, { userName: before.email }),
    ).rejects.toMatchObject({ status: 409, scimType: "uniqueness" });
    expect(await membership(ids.orgA, ids.squatter)).toBeUndefined();
  });

  it("attaches a verified-domain user from another organisation without mutating them", async () => {
    const before = await user(ids.outsider);
    const resource = await modules.createScimUser(ids.orgA, {
      userName: before.email.toUpperCase(),
      name: "Hijacked Name",
      active: false,
    });
    expect(resource).toMatchObject({ id: ids.outsider, active: false });
    const after = await user(ids.outsider);
    expect(after.name).toBe(before.name);
    expect(after.disabledAt).toBeNull();
    expect((await membership(ids.orgA, ids.outsider)).role).toBe("read_only");
    expect((await membership(ids.orgB, ids.outsider)).deletedAt).toBeNull();
  });

  it("creates new users without touching global disabled state", async () => {
    const resource = await modules.createScimUser(ids.orgA, {
      userName: newEmail,
      name: "New Person",
    });
    expect(resource).toMatchObject({ userName: newEmail, active: true });
    expect((await user(resource.id)).disabledAt).toBeNull();
  });

  it("deactivates tenant-locally via a string 'False' and reactivates the same row", async () => {
    const original = await membership(ids.orgA, ids.shared);
    const deactivated = await modules.patchScimUser(ids.orgA, ids.shared, [
      { op: "Replace", path: "active", value: "False" },
    ]);
    expect(deactivated?.active).toBe(false);
    expect((await membership(ids.orgA, ids.shared)).deletedAt).not.toBeNull();
    expect((await membership(ids.orgB, ids.shared)).deletedAt).toBeNull();
    expect((await user(ids.shared)).disabledAt).toBeNull();
    expect((await modules.getScimUser(ids.orgB, ids.shared))?.active).toBe(
      true,
    );

    // Non-boolean values and pathless replaces without `active` are ignored.
    await modules.patchScimUser(ids.orgA, ids.shared, [
      { op: "replace", path: "active", value: "yes" },
      { op: "replace", value: { displayName: "x" } },
      { op: "replace", path: "name.formatted", value: "Renamed" },
    ]);
    expect((await modules.getScimUser(ids.orgA, ids.shared))?.active).toBe(
      false,
    );
    expect((await user(ids.shared)).name).toBe("SCIM shared");

    const reactivated = await modules.patchScimUser(ids.orgA, ids.shared, [
      { op: "replace", value: { active: true } },
    ]);
    expect(reactivated?.active).toBe(true);
    const restored = await membership(ids.orgA, ids.shared);
    expect(restored.id).toBe(original.id);
    expect(restored.deletedAt).toBeNull();

    const actions = await modules.db
      .select({ action: modules.auditEvents.action })
      .from(modules.auditEvents)
      .where(
        modules.and(
          modules.eq(modules.auditEvents.organisationId, ids.orgA),
          modules.eq(modules.auditEvents.targetId, ids.shared),
        ),
      );
    expect(actions.map((row) => row.action)).toEqual(
      expect.arrayContaining([
        "scim.user.deactivated",
        "scim.user.reactivated",
      ]),
    );
  });

  it("re-POST of a deactivated member restores the existing membership", async () => {
    const original = await membership(ids.orgA, ids.shared);
    await modules.disableScimUser(ids.orgA, ids.shared);
    const sharedEmail = (await user(ids.shared)).email;
    const resource = await modules.createScimUser(ids.orgA, {
      userName: sharedEmail,
    });
    expect(resource.active).toBe(true);
    expect((await membership(ids.orgA, ids.shared)).id).toBe(original.id);
  });

  it("never deactivates the last organisation owner", async () => {
    await expect(
      modules.disableScimUser(ids.orgA, ids.owner),
    ).rejects.toMatchObject({ status: 409 });
    expect((await membership(ids.orgA, ids.owner)).deletedAt).toBeNull();
  });

  it("clears a legacy global disable only for single-organisation users", async () => {
    const [created] = await modules.db
      .select({ id: modules.users.id })
      .from(modules.users)
      .where(modules.eq(modules.users.email, newEmail));
    await modules.db
      .update(modules.users)
      .set({ disabledAt: new Date() })
      .where(modules.inArray(modules.users.id, [created.id, ids.shared]));
    const reactivate = [{ op: "replace", path: "active", value: true }];
    const sole = await modules.patchScimUser(ids.orgA, created.id, reactivate);
    expect(sole?.active).toBe(true);
    expect((await user(created.id)).disabledAt).toBeNull();
    await modules.patchScimUser(ids.orgA, ids.shared, reactivate);
    expect((await user(ids.shared)).disabledAt).not.toBeNull();
    await modules.db
      .update(modules.users)
      .set({ disabledAt: null })
      .where(modules.eq(modules.users.id, ids.shared));
  });

  it("filters by userName case-insensitively and pages results", async () => {
    const sharedEmail = (await user(ids.shared)).email;
    const filtered = await modules.listScimUsers(ids.orgA, {
      filter: `UserName EQ "${sharedEmail.toUpperCase()}"`,
    });
    expect(filtered.totalResults).toBe(1);
    expect(filtered.Resources.map((resource) => resource.id)).toEqual([
      ids.shared,
    ]);
    const byEmail = await modules.listScimUsers(ids.orgA, {
      filter: `emails.value eq "${sharedEmail}"`,
    });
    expect(byEmail.totalResults).toBe(1);

    const all = await modules.listScimUsers(ids.orgA);
    expect(all.totalResults).toBe(4);
    const page = await modules.listScimUsers(ids.orgA, {
      startIndex: 2,
      count: 1,
    });
    expect(page).toMatchObject({
      totalResults: 4,
      startIndex: 2,
      itemsPerPage: 1,
    });
    expect(page.Resources[0].id).toBe(all.Resources[1].id);

    await expect(
      modules.listScimUsers(ids.orgA, { filter: 'name co "x"' }),
    ).rejects.toMatchObject({ status: 400, scimType: "invalidFilter" });
  });

  it("ignores group mappings to protected roles and never changes an owner", async () => {
    const context = {
      organisationId: ids.orgA,
      securityPolicy: {
        scimGroupRoles: { Owners: "organisation_owner", Leads: "consultant" },
      },
    };
    const ignored = await modules.patchScimGroup(context, "x", {
      displayName: "Owners",
      Operations: [
        { op: "add", path: "members", value: [{ value: ids.shared }] },
      ],
    });
    expect(ignored.ignored).toBe(true);
    expect((await membership(ids.orgA, ids.shared)).role).toBe("read_only");

    await modules.patchScimGroup(context, "x", {
      displayName: "Leads",
      Operations: [
        {
          op: "add",
          path: "members",
          value: [{ value: ids.shared }, { value: ids.owner }],
        },
      ],
    });
    expect((await membership(ids.orgA, ids.shared)).role).toBe("consultant");
    expect((await membership(ids.orgA, ids.owner)).role).toBe(
      "organisation_owner",
    );
  });

  describe("domain verification", () => {
    const actorA = () => ({ organisationId: ids.orgA, userId: ids.owner });
    const actorB = () => ({ organisationId: ids.orgB, userId: ids.outsider });
    const txt = (value: string) => async () => [[value]];
    const entry = async (organisationId: string, name: string) =>
      (await modules.listScimDomains(organisationId)).find(
        (item) => item.domain === name,
      );

    it("rejects shared providers and duplicates on add", async () => {
      await expect(
        modules.addScimDomain(actorA(), "Gmail.com"),
      ).rejects.toThrow(/shared email provider/);
      await expect(modules.addScimDomain(actorA(), domain)).rejects.toThrow(
        /already been added/,
      );
    });

    it("does not verify on a DNS mismatch", async () => {
      const added = await modules.addScimDomain(actorA(), `${claimDomain}.`);
      expect(added).toMatchObject({ domain: claimDomain });
      expect(added.verifiedAt).toBeUndefined();
      await expect(
        modules.verifyScimDomain(
          actorA(),
          claimDomain,
          txt("dingodocs-domain-verification=wrong"),
        ),
      ).rejects.toThrow(/was not found/);
      expect((await entry(ids.orgA, claimDomain))?.verifiedAt).toBeUndefined();
    });

    it("verifies via TXT and blocks a second organisation from claiming it", async () => {
      const pendingA = await entry(ids.orgA, claimDomain);
      const queried: string[] = [];
      const verified = await modules.verifyScimDomain(
        actorA(),
        claimDomain,
        async (name) => {
          queried.push(name);
          return [[`dingodocs-domain-verification=${pendingA!.token}`]];
        },
      );
      expect(queried).toEqual([`_dingodocs-verification.${claimDomain}`]);
      expect(verified.verifiedAt).toBeTruthy();

      const pendingB = await modules.addScimDomain(actorB(), claimDomain);
      await expect(
        modules.verifyScimDomain(
          actorB(),
          claimDomain,
          txt(`dingodocs-domain-verification=${pendingB.token}`),
        ),
      ).rejects.toThrow(/already verified by another organisation/);
      expect((await entry(ids.orgB, claimDomain))?.verifiedAt).toBeUndefined();

      const created = await modules.createScimUser(ids.orgA, {
        userName: `claimed-${ids.orgA}@${claimDomain}`,
      });
      expect(created.active).toBe(true);
      await modules.db
        .delete(modules.users)
        .where(modules.eq(modules.users.id, created.id));
    });

    it("removes domains, releasing the claim and auditing each step", async () => {
      await modules.removeScimDomain(actorA(), claimDomain);
      expect(await entry(ids.orgA, claimDomain)).toBeUndefined();
      expect((await entry(ids.orgA, domain))?.verifiedAt).toBeTruthy();
      const pendingB = await entry(ids.orgB, claimDomain);
      const verifiedB = await modules.verifyScimDomain(
        actorB(),
        claimDomain,
        txt(`dingodocs-domain-verification=${pendingB!.token}`),
      );
      expect(verifiedB.verifiedAt).toBeTruthy();
      await expect(
        modules.createScimUser(ids.orgA, {
          userName: `again-${ids.orgA}@${claimDomain}`,
        }),
      ).rejects.toMatchObject({ status: 403 });

      const actions = await modules.db
        .select({ action: modules.auditEvents.action })
        .from(modules.auditEvents)
        .where(
          modules.and(
            modules.eq(modules.auditEvents.organisationId, ids.orgA),
            modules.eq(modules.auditEvents.targetType, "scim_domain"),
          ),
        );
      expect(actions.map((row) => row.action)).toEqual(
        expect.arrayContaining([
          "scim.domain.added",
          "scim.domain.verified",
          "scim.domain.removed",
        ]),
      );
    });
  });
});

describe("parseScimGroupRoles", () => {
  it("validates shape, role names, and the actor's grant ceiling", async () => {
    const { parseScimGroupRoles } = await import("./scim");
    expect(
      parseScimGroupRoles(
        '{"Leads":"consultant"}',
        "organisation_administrator",
      ),
    ).toEqual({ Leads: "consultant" });
    const shapeError =
      "SCIM group roles must be a JSON object mapping group names to roles";
    expect(() => parseScimGroupRoles("{nope", "organisation_owner")).toThrow(
      shapeError,
    );
    expect(() => parseScimGroupRoles('["a"]', "organisation_owner")).toThrow(
      shapeError,
    );
    expect(() =>
      parseScimGroupRoles('{"Leads":1}', "organisation_owner"),
    ).toThrow(shapeError);
    expect(() =>
      parseScimGroupRoles('{"Leads":"wizard"}', "organisation_owner"),
    ).toThrow(/cannot be mapped/);
    expect(() =>
      parseScimGroupRoles(
        '{"Owners":"organisation_owner"}',
        "organisation_administrator",
      ),
    ).toThrow(/cannot be mapped/);
    expect(() =>
      parseScimGroupRoles(
        '{"Owners":"organisation_owner"}',
        "organisation_owner",
      ),
    ).toThrow(/cannot be mapped/);
  });
});

async function load() {
  const schema = await import("@/db/schema");
  const database = await import("@/db");
  const drizzle = await import("drizzle-orm");
  const scim = await import("./scim");
  const domains = await import("./domain-verification");
  return { ...schema, ...database, ...drizzle, ...scim, ...domains };
}
