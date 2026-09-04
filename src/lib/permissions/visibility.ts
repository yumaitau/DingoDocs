import { eq, ne, or } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

export function visibleToAuthor(
  visibility: AnyPgColumn,
  authorId: AnyPgColumn,
  userId?: string,
) {
  return or(
    ne(visibility, "private"),
    userId ? eq(authorId, userId) : undefined,
  );
}
