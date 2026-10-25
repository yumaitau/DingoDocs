import { describe, expect, it, vi } from "vitest";

const getScimUser = vi.fn();
const patchScimUser = vi.fn();
const disableScimUser = vi.fn();

vi.mock("@/server/services/scim", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/services/scim")>()),
  authenticateScimRequest: vi.fn(async () => ({
    organisationId: "00000000-0000-4000-8000-000000000001",
  })),
  getScimUser: (...args: unknown[]) => getScimUser(...args),
  patchScimUser: (...args: unknown[]) => patchScimUser(...args),
  disableScimUser: (...args: unknown[]) => disableScimUser(...args),
}));

const { DELETE, GET, PATCH } = await import("./route");

const params = { params: Promise.resolve({ id: "not-a-uuid" }) };

describe("SCIM Users/[id] with a non-UUID id", () => {
  it("returns SCIM 404 without querying", async () => {
    const request = () =>
      new Request("http://localhost/api/scim/v2/Users/not-a-uuid", {
        method: "PATCH",
        body: JSON.stringify({ Operations: [] }),
      });
    for (const handler of [GET, PATCH, DELETE]) {
      const response = await handler(request(), params);
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ status: "404" });
    }
    expect(getScimUser).not.toHaveBeenCalled();
    expect(patchScimUser).not.toHaveBeenCalled();
    expect(disableScimUser).not.toHaveBeenCalled();
  });
});
