import { beforeEach, describe, expect, it, vi } from "vitest";

type KeyRow = {
  id: string;
  organisationId: string;
  scopes: string[];
  userId: string | null;
  createdBy: string | null;
  serviceAccountId: string | null;
  serviceDisabledAt: Date | null;
};

const state: { key?: KeyRow; membership?: Record<string, unknown> } = {};
const requireActorPermission = vi.fn(async () => ["organisation_owner"]);
const requirePermission = vi.fn(async () => ({
  organisationId: "org",
  userId: "session-user",
  role: "organisation_owner",
  roles: ["organisation_owner"],
}));
const requireInternalOrganisationContext = vi.fn(async () => ({
  organisationId: "org",
  userId: "session-user",
  role: "organisation_owner",
}));
const insertedKeys: Array<Record<string, unknown>> = [];

function chain(rows: () => unknown[]) {
  const query: Record<string, unknown> = {};
  for (const method of ["from", "leftJoin", "innerJoin", "where"])
    query[method] = () => query;
  query.limit = async () => rows();
  return query;
}

vi.mock("@/db", () => {
  let selects = 0;
  const db = {
    select: () => {
      selects += 1;
      // First select loads the key; later ones load the owner membership.
      const first = selects % 2 === 1;
      return chain(() =>
        first
          ? state.key
            ? [state.key]
            : []
          : state.membership
            ? [state.membership]
            : [],
      );
    },
    update: () => ({ set: () => ({ where: async () => undefined }) }),
    transaction: async (run: (tx: unknown) => unknown) =>
      run({
        insert: () => ({
          values: (values: Record<string, unknown>) => {
            insertedKeys.push(values);
            return {
              returning: async () => [{ id: "new-key", keyPrefix: "dd_pat_x" }],
            };
          },
        }),
      }),
    resetSelects: () => {
      selects = 0;
    },
  };
  return { db };
});
vi.mock("@/lib/permissions/require", () => ({
  requireActorPermission: (...args: unknown[]) =>
    requireActorPermission(...(args as [])),
  requirePermission: (...args: unknown[]) => requirePermission(...(args as [])),
  requireInternalOrganisationContext: () =>
    requireInternalOrganisationContext(),
}));

const { db } = (await import("@/db")) as unknown as {
  db: { resetSelects: () => void };
};
const {
  apiReadContextWithPermission,
  apiWriteContext,
  createApiCredential,
  serviceAccountDeniedPermissions,
} = await import("./authentication");

const token = "dd_svc_abcdefghijklmnopqrstuvwxyz0123456789";
const request = () =>
  new Request("http://localhost/api/v1/findings", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });

beforeEach(() => {
  db.resetSelects();
  requireActorPermission.mockClear();
  requirePermission.mockClear();
  insertedKeys.length = 0;
  state.key = {
    id: "key",
    organisationId: "org",
    scopes: ["findings:write", "webhooks:manage", "tasks:write"],
    userId: null,
    createdBy: "creator",
    serviceAccountId: "svc",
    serviceDisabledAt: null,
  };
  state.membership = undefined;
});

describe("apiWriteContext for service-account keys", () => {
  it("allows authoring permissions on the allow-list", async () => {
    await expect(
      apiWriteContext(request(), "findings:write", "finding:create"),
    ).resolves.toMatchObject({ serviceAccountId: "svc" });
    expect(requireActorPermission).not.toHaveBeenCalled();
  });

  it.each([
    "finding:approve",
    "report:publish",
    "scope:manage",
    "data:export",
    "engagement:create",
    "engagement:edit",
    "template:manage",
    "integration:configure",
  ] as const)(
    "denies %s whatever scopes the key carries",
    async (permission) => {
      await expect(
        apiWriteContext(request(), "findings:write", permission),
      ).rejects.toMatchObject({
        status: 403,
        code: "service_account_forbidden",
      });
    },
  );

  it("keeps the deny-list export consistent with the allow-list", () => {
    expect(serviceAccountDeniedPermissions).toContain("finding:approve");
    expect(serviceAccountDeniedPermissions).toContain("scope:manage");
    expect(serviceAccountDeniedPermissions).not.toContain("finding:create");
  });
});

describe("apiReadContextWithPermission", () => {
  it("denies service-account keys administrative reads", async () => {
    await expect(
      apiReadContextWithPermission(
        request(),
        "webhooks:manage",
        "integration:configure",
      ),
    ).rejects.toMatchObject({ status: 403, code: "service_account_forbidden" });
  });

  it("role-checks personal keys against the owner", async () => {
    state.key = {
      ...state.key!,
      userId: "owner",
      serviceAccountId: null,
    };
    state.membership = {
      id: "m",
      role: "consultant",
      banned: false,
      banExpires: null,
      disabledAt: null,
    };
    requireActorPermission.mockRejectedValueOnce(
      new Error("Permission denied"),
    );
    await expect(
      apiReadContextWithPermission(
        request(),
        "webhooks:manage",
        "integration:configure",
      ),
    ).rejects.toThrow("Permission denied");
    expect(requireActorPermission).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "owner" }),
      "integration:configure",
      undefined,
    );
  });

  it("requires the permission for session callers", async () => {
    await apiReadContextWithPermission(
      new Request("http://localhost/api/v1/webhooks"),
      "webhooks:manage",
      "integration:configure",
    );
    expect(requirePermission).toHaveBeenCalledWith(
      "integration:configure",
      undefined,
    );
  });
});

describe("createApiCredential expiry", () => {
  const actor = { organisationId: "org", userId: "owner" };
  const base = {
    name: "CI",
    kind: "personal" as const,
    scopes: ["findings:read" as const],
  };

  it("rejects expiries in the past or beyond 365 days", async () => {
    await expect(
      createApiCredential(actor, {
        ...base,
        expiresAt: new Date(Date.now() - 1_000),
      }),
    ).rejects.toThrow("in the future");
    await expect(
      createApiCredential(actor, {
        ...base,
        expiresAt: new Date(Date.now() + 366 * 86_400_000),
      }),
    ).rejects.toThrow("within 365 days");
    expect(insertedKeys).toHaveLength(0);
  });

  it("stores an expiry within the limit", async () => {
    const expiresAt = new Date(Date.now() + 30 * 86_400_000);
    await createApiCredential(actor, { ...base, expiresAt });
    expect(insertedKeys[0]).toMatchObject({ expiresAt });
  });
});
