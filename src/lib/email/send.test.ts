import { afterEach, describe, expect, it, vi } from "vitest";
import { sendAuthenticationEmail, smtpTransportOptions } from "./send";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("authentication email delivery", () => {
  it("uses the native SES provider without SMTP credentials", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("EMAIL_PROVIDER", "ses");
    vi.stubEnv("EMAIL_FROM", "DingoDocs <security@example.com>");
    const sendSes = vi.fn(async () => undefined);

    await sendAuthenticationEmail(
      {
        to: "person@example.net",
        url: "https://dingodocs.example.com/verify/token",
        purpose: "verify-email",
      },
      { sendSes },
    );

    expect(sendSes).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "DingoDocs <security@example.com>",
        to: "person@example.net",
        subject: "Verify your DingoDocs email",
      }),
    );
  });

  it("rejects disabled delivery while verification is required", async () => {
    vi.stubEnv("EMAIL_PROVIDER", "none");
    vi.stubEnv("REQUIRE_EMAIL_VERIFICATION", "true");

    await expect(
      sendAuthenticationEmail({
        to: "person@example.net",
        url: "https://dingodocs.example.com/verify/token",
      }),
    ).rejects.toThrow(
      "EMAIL_PROVIDER=none requires REQUIRE_EMAIL_VERIFICATION=false",
    );
  });

  it("preserves SMTP delivery for existing deployments", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("EMAIL_PROVIDER", "smtp");
    const sendSmtp = vi.fn(async () => undefined);

    await sendAuthenticationEmail(
      {
        to: "person@example.net",
        url: "https://dingodocs.example.com/reset/token",
        purpose: "reset-password",
      },
      { sendSmtp },
    );

    expect(sendSmtp).toHaveBeenCalledWith(
      expect.objectContaining({ subject: "Reset your DingoDocs password" }),
    );
  });

  it("requires STARTTLS when SMTP does not use implicit TLS", () => {
    expect(
      smtpTransportOptions({
        SMTP_HOST: "smtp.example.com",
        SMTP_PORT: "587",
        SMTP_SECURE: "false",
      }),
    ).toMatchObject({ secure: false, requireTLS: true });

    expect(
      smtpTransportOptions({
        SMTP_HOST: "smtp.example.com",
        SMTP_PORT: "465",
        SMTP_SECURE: "true",
      }),
    ).toMatchObject({ secure: true, requireTLS: false });
  });
});
