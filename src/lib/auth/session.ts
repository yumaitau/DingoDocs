import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { sessions, users } from "@/db/schema";
import { auth } from "./auth";
import { AuthenticationRequiredError } from "./errors";

export async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  if (await isPastAbsoluteExpiry(session.session.id)) return null;
  if (await isUserInactive(session.user.id)) return null;
  return session;
}

/**
 * Sliding refresh keeps extending expiresAt, so absoluteExpiresAt (a DB
 * default set once at insert) caps total session life. Better Auth does not
 * expose the custom column, so read it by id and delete an expired row.
 */
async function isPastAbsoluteExpiry(sessionId: string) {
  const [row] = await db
    .select({ absoluteExpiresAt: sessions.absoluteExpiresAt })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1);
  if (!row) return true;
  if (row.absoluteExpiresAt.getTime() > Date.now()) return false;
  await db.delete(sessions).where(eq(sessions.id, sessionId));
  return true;
}

export async function requireSession() {
  const session = await getSession();
  if (!session) throw new AuthenticationRequiredError();
  return session;
}

export async function requirePageSession() {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  return session;
}

export { AuthenticationRequiredError };

async function isUserInactive(userId: string) {
  const [user] = await db
    .select({
      banned: users.banned,
      banExpires: users.banExpires,
      disabledAt: users.disabledAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) return true;
  if (user.disabledAt) return true;
  if (!user.banned) return false;
  return !user.banExpires || user.banExpires.getTime() > Date.now();
}
