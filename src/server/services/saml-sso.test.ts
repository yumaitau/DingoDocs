import { describe, expect, it } from "vitest";
import { roleForGroups, samlProviderId } from "./saml-sso";

describe("SAML group role mapping", () => {
  const mapping = {
    Engineers: "consultant",
    Leads: "lead_consultant",
    Owners: "organisation_owner",
    Platform: "platform_administrator",
    Typo: "superuser",
  };

  it("defaults to read_only", () => {
    expect(roleForGroups(mapping, [])).toBe("read_only");
    expect(roleForGroups(undefined, ["Engineers"])).toBe("read_only");
    expect(roleForGroups(mapping, ["Unmapped"])).toBe("read_only");
  });

  it("picks the most privileged mapped role", () => {
    expect(roleForGroups(mapping, ["Engineers", "Leads"])).toBe(
      "lead_consultant",
    );
  });

  it("never grants owner, platform administrator or unknown roles", () => {
    expect(roleForGroups(mapping, ["Owners", "Platform", "Typo"])).toBe(
      "read_only",
    );
    expect(roleForGroups(mapping, ["Owners", "Engineers"])).toBe("consultant");
  });

  it("scopes the linked account provider to the organisation", () => {
    expect(samlProviderId("org-1")).toBe("saml:org-1");
  });
});
