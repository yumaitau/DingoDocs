import { describe, expect, it } from "vitest";
import { approvedE2EBaseURL } from "./e2e-origin";

describe("approvedE2EBaseURL", () => {
  it("accepts secure deployed origins", () => {
    expect(approvedE2EBaseURL("https://dingodocs.example.com/")).toBe(
      "https://dingodocs.example.com",
    );
  });

  it.each([
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://127.42.0.9:3000",
    "http://[::1]:3000",
  ])("accepts loopback HTTP origin %s", (origin) => {
    expect(approvedE2EBaseURL(origin)).toBe(origin);
  });

  it.each(["http://192.168.1.19:3000", "ftp://dingodocs.example.com"])(
    "rejects unsafe origin %s",
    (origin) => {
      expect(() => approvedE2EBaseURL(origin)).toThrow(
        "must use HTTPS unless it targets a loopback host",
      );
    },
  );
});
