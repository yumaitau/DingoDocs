import { DrizzleQueryError } from "drizzle-orm/errors";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { userFacingError } from "./errors";

describe("userFacingError", () => {
  it("returns the first Zod issue instead of the JSON issue dump", () => {
    const result = z
      .object({ name: z.string().min(2, "Name is too short") })
      .safeParse({ name: "a" });
    expect(userFacingError(result.error, "Failed")).toBe("Name is too short");
  });

  it("hides Drizzle query errors that embed SQL and params", () => {
    const error = new DrizzleQueryError(
      'select * from "users" where "email" = $1',
      ["secret@example.com"],
      new Error("boom"),
    );
    expect(userFacingError(error, "Could not save")).toBe("Could not save");
    expect(
      userFacingError(new Error("Failed query: insert ..."), "Could not save"),
    ).toBe("Could not save");
  });

  it("hides raw Postgres errors identified by SQLSTATE code", () => {
    const pgError = Object.assign(
      new Error('duplicate key value violates unique constraint "x"'),
      { code: "23505" },
    );
    expect(userFacingError(pgError, "Could not save")).toBe("Could not save");
    const wrapped = new Error("wrapped", { cause: pgError });
    expect(userFacingError(wrapped, "Could not save")).toBe("Could not save");
  });

  it("keeps domain error messages and falls back for non-errors", () => {
    expect(userFacingError(new Error("Jira is not connected"), "x")).toBe(
      "Jira is not connected",
    );
    expect(userFacingError("nope", "Fallback")).toBe("Fallback");
    expect(userFacingError(new Error(""), "Fallback")).toBe("Fallback");
  });
});
