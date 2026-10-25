import { describe, expect, it } from "vitest";
import {
  formatTotpSecret,
  normaliseOtpCode,
  totpSecretFromUri,
  twoFactorChallengePath,
} from "./two-factor";

describe("totpSecretFromUri", () => {
  it("extracts the base32 secret from an otpauth URI", () => {
    expect(
      totpSecretFromUri(
        "otpauth://totp/DingoDocs:admin%40dingodocs.local?secret=JBSWY3DPEHPK3PXP&issuer=DingoDocs&algorithm=SHA1&digits=6&period=30",
      ),
    ).toBe("JBSWY3DPEHPK3PXP");
  });

  it.each([
    null,
    "",
    "not a uri",
    "https://example.com/?secret=JBSWY3DPEHPK3PXP",
    "otpauth://totp/DingoDocs?issuer=DingoDocs",
    "otpauth://totp/DingoDocs?secret=not-base32!",
  ])("returns null for %s", (value) => {
    expect(totpSecretFromUri(value)).toBeNull();
  });
});

describe("formatTotpSecret", () => {
  it("groups the secret into blocks of four", () => {
    expect(formatTotpSecret("JBSWY3DPEHPK3PXP")).toBe("JBSW Y3DP EHPK 3PXP");
  });
});

describe("normaliseOtpCode", () => {
  it("removes spaces and dashes", () => {
    expect(normaliseOtpCode(" 123 456 ")).toBe("123456");
    expect(normaliseOtpCode("abcde-12345")).toBe("abcde12345");
  });
});

describe("twoFactorChallengePath", () => {
  it("preserves a same-origin next path", () => {
    expect(twoFactorChallengePath("/engagements/abc?view=findings")).toBe(
      "/sign-in/two-factor?next=%2Fengagements%2Fabc%3Fview%3Dfindings",
    );
  });

  it.each([null, "https://evil.example", "//evil.example", "/\\evil.example"])(
    "falls back to the dashboard for %s",
    (value) => {
      expect(twoFactorChallengePath(value)).toBe(
        "/sign-in/two-factor?next=%2Fdashboard",
      );
    },
  );
});
