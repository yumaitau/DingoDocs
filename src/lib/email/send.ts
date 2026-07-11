type AuthenticationEmail = { to: string; url: string };

export async function sendAuthenticationEmail({
  to,
  url,
}: AuthenticationEmail) {
  if (process.env.NODE_ENV !== "production") {
    console.info(JSON.stringify({ event: "email.authentication", to, url }));
    return;
  }

  throw new Error(
    "SMTP transport is not configured. Configure a notification provider before production use.",
  );
}
