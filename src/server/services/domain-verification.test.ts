import { describe, expect, it } from "vitest";
import {
  emailDomain,
  isVerifiedScimDomain,
  normaliseScimDomain,
  scimDomainTxtName,
  scimDomainTxtValue,
  txtRecordMatches,
} from "./domain-verification";

describe("normaliseScimDomain", () => {
  it("lowercases, trims and strips a trailing dot", () => {
    expect(normaliseScimDomain("  Corp.Example.COM. ")).toBe(
      "corp.example.com",
    );
    expect(normaliseScimDomain("xn--bcher-kva.example")).toBe(
      "xn--bcher-kva.example",
    );
  });

  it.each([
    "",
    "localhost",
    "com",
    "-bad.com",
    "bad-.com",
    "exa mple.com",
    "user@example.com",
    "example.c0m",
    "bücher.de",
    `${"a".repeat(64)}.com`,
  ])("rejects invalid domain %j", (input) => {
    expect(() => normaliseScimDomain(input)).toThrow(/valid domain/);
  });

  it.each(["com.au", "co.uk", "gov.au"])(
    "rejects public suffix %s",
    (input) => {
      expect(() => normaliseScimDomain(input)).toThrow(/public suffix/);
    },
  );

  it.each([
    "gmail.com",
    "Outlook.com",
    "hotmail.com",
    "proton.me",
    "mail.yahoo.com",
  ])("rejects shared provider %s", (input) => {
    expect(() => normaliseScimDomain(input)).toThrow(/shared email provider/);
  });
});

describe("domain helpers", () => {
  it("derives the TXT record name and value", () => {
    expect(scimDomainTxtName("example.com")).toBe(
      "_dingodocs-verification.example.com",
    );
    expect(scimDomainTxtValue("abc")).toBe("dingodocs-domain-verification=abc");
  });

  it("extracts email domains", () => {
    expect(emailDomain("A.Person@Example.COM")).toBe("example.com");
    expect(emailDomain("no-at-sign")).toBeUndefined();
    expect(emailDomain("trailing@")).toBeUndefined();
  });

  it("only treats exact, verified domains as verified", () => {
    const policy = {
      scimDomains: [
        { domain: "example.com", token: "t", verifiedAt: "2026-01-01" },
        { domain: "pending.com", token: "t" },
      ],
    };
    expect(isVerifiedScimDomain(policy, "example.com")).toBe(true);
    expect(isVerifiedScimDomain(policy, "sub.example.com")).toBe(false);
    expect(isVerifiedScimDomain(policy, "pending.com")).toBe(false);
    expect(isVerifiedScimDomain({}, "example.com")).toBe(false);
    expect(isVerifiedScimDomain(policy, undefined)).toBe(false);
  });
});

describe("txtRecordMatches", () => {
  it("queries the verification name and joins chunked records", async () => {
    const queried: string[] = [];
    const resolver = async (name: string) => {
      queried.push(name);
      return [["v=spf1 -all"], ["dingodocs-domain-", "verification=tok"]];
    };
    await expect(
      txtRecordMatches("example.com", "tok", resolver),
    ).resolves.toBe(true);
    expect(queried).toEqual(["_dingodocs-verification.example.com"]);
  });

  it("fails on a mismatched token or a DNS error", async () => {
    await expect(
      txtRecordMatches("example.com", "tok", async () => [
        ["dingodocs-domain-verification=other"],
      ]),
    ).resolves.toBe(false);
    await expect(
      txtRecordMatches("example.com", "tok", async () => {
        throw Object.assign(new Error("queryTxt ENOTFOUND"), {
          code: "ENOTFOUND",
        });
      }),
    ).resolves.toBe(false);
  });
});
