import { SendEmailCommand, SESv2Client } from "@aws-sdk/client-sesv2";
import nodemailer from "nodemailer";
import { structuredLog } from "@/lib/observability/logger";

type AuthenticationEmail = {
  to: string;
  url: string;
  purpose?: "sign-in" | "verify-email" | "reset-password" | "invitation";
};

type EmailDependencies = {
  sendSes?: (message: EmailMessage) => Promise<void>;
  sendSmtp?: (message: EmailMessage) => Promise<void>;
};

type EmailMessage = {
  from: string;
  to: string;
  subject: string;
  text: string;
};

export function smtpTransportOptions(
  env: Record<string, string | undefined> = process.env,
) {
  const host = env.SMTP_HOST;
  if (!host) throw new Error("SMTP_HOST is required for SMTP email delivery");
  const secure = env.SMTP_SECURE === "true";
  return {
    host,
    port: Number(env.SMTP_PORT ?? 587),
    secure,
    requireTLS: !secure,
    auth:
      env.SMTP_USER && env.SMTP_PASSWORD
        ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD }
        : undefined,
  };
}

export async function sendAuthenticationEmail(
  { to, url, purpose = "sign-in" }: AuthenticationEmail,
  dependencies: EmailDependencies = {},
) {
  const subject = {
    "sign-in": "Your DingoDocs sign-in link",
    "verify-email": "Verify your DingoDocs email",
    "reset-password": "Reset your DingoDocs password",
    invitation: "You have been invited to DingoDocs",
  }[purpose];
  const message = {
    from:
      process.env.EMAIL_FROM ??
      process.env.SMTP_FROM ??
      "DingoDocs <noreply@localhost>",
    to,
    subject,
    text: `${subject}\n\nOpen this short-lived, single-use link:\n${url}\n\nIf you did not request this, ignore this message.`,
  };
  const provider =
    process.env.EMAIL_PROVIDER ??
    (process.env.SMTP_HOST
      ? "smtp"
      : process.env.NODE_ENV === "production"
        ? "smtp"
        : "preview");

  if (provider === "none") {
    if (process.env.REQUIRE_EMAIL_VERIFICATION !== "false")
      throw new Error(
        "EMAIL_PROVIDER=none requires REQUIRE_EMAIL_VERIFICATION=false",
      );
    structuredLog("warn", "email.authentication.disabled", {
      purpose,
      recipientDomain: to.split("@")[1] ?? "invalid",
    });
    return;
  }
  if (provider === "preview") {
    if (process.env.NODE_ENV === "production")
      throw new Error("Preview email delivery is disabled in production");
    structuredLog("info", "email.authentication.preview", {
      purpose,
      recipientDomain: to.split("@")[1] ?? "invalid",
    });
    return;
  }
  if (provider === "ses") await (dependencies.sendSes ?? sendWithSes)(message);
  else if (provider === "smtp")
    await (dependencies.sendSmtp ?? sendWithSmtp)(message);
  else throw new Error(`Unsupported EMAIL_PROVIDER: ${provider}`);

  structuredLog("info", "email.authentication.sent", {
    purpose,
    recipientDomain: to.split("@")[1] ?? "invalid",
  });
}

async function sendWithSes(message: EmailMessage) {
  const client = new SESv2Client({
    region: process.env.SES_REGION ?? process.env.AWS_REGION,
  });
  await client.send(
    new SendEmailCommand({
      FromEmailAddress: message.from,
      Destination: { ToAddresses: [message.to] },
      Content: {
        Simple: {
          Subject: { Data: message.subject, Charset: "UTF-8" },
          Body: { Text: { Data: message.text, Charset: "UTF-8" } },
        },
      },
    }),
  );
}

async function sendWithSmtp(message: EmailMessage) {
  const transport = nodemailer.createTransport(smtpTransportOptions());
  await transport.sendMail(message);
}
