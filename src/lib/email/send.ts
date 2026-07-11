import nodemailer from "nodemailer";
import { structuredLog } from "@/lib/observability/logger";

type AuthenticationEmail = {
  to: string;
  url: string;
  purpose?: "sign-in" | "verify-email" | "reset-password" | "invitation";
};

export async function sendAuthenticationEmail({
  to,
  url,
  purpose = "sign-in",
}: AuthenticationEmail) {
  const host = process.env.SMTP_HOST;
  if (!host) {
    if (process.env.NODE_ENV === "production")
      throw new Error(
        "SMTP_HOST is required for authentication email delivery",
      );
    structuredLog("info", "email.authentication.preview", {
      purpose,
      recipientDomain: to.split("@")[1] ?? "invalid",
    });
    return;
  }
  const transport = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === "true",
    auth:
      process.env.SMTP_USER && process.env.SMTP_PASSWORD
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
        : undefined,
  });
  const subject = {
    "sign-in": "Your DingoDocs sign-in link",
    "verify-email": "Verify your DingoDocs email",
    "reset-password": "Reset your DingoDocs password",
    invitation: "You have been invited to DingoDocs",
  }[purpose];
  await transport.sendMail({
    from: process.env.SMTP_FROM ?? "DingoDocs <noreply@localhost>",
    to,
    subject,
    text: `${subject}\n\nOpen this short-lived, single-use link:\n${url}\n\nIf you did not request this, ignore this message.`,
  });
  structuredLog("info", "email.authentication.sent", {
    purpose,
    recipientDomain: to.split("@")[1] ?? "invalid",
  });
}
