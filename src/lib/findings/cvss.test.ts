import { describe, expect, it } from "vitest";
import { scoreCvss } from "./cvss";

describe("scoreCvss", () => {
  it("scores the known CVSS 3.1 critical vector as 9.8", () => {
    const result = scoreCvss("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H");
    expect(result).toEqual({
      version: "3.1",
      score: 9.8,
      vector: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H",
    });
  });

  it("returns a 0–10 approximation for a CVSS 4.0 vector", () => {
    const result = scoreCvss(
      "CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N",
    );
    expect(result.version).toBe("4.0");
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(10);
  });

  it("rejects unknown prefixes and metrics", () => {
    expect(() => scoreCvss("CVSS:2.0/AV:N")).toThrow(
      /CVSS:3.1\/ or CVSS:4.0\//,
    );
    expect(() =>
      scoreCvss("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:X"),
    ).toThrow(/Unknown CVSS metric value/);
    expect(() =>
      scoreCvss(
        "CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N/XX:Y",
      ),
    ).toThrow(/Unknown CVSS metric/);
  });
});
