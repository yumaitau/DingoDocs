import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;

const globalForDatabase = globalThis as unknown as {
  sqlClient?: ReturnType<typeof postgres>;
};
const sqlClient =
  globalForDatabase.sqlClient ??
  postgres(
    connectionString ?? "postgres://invalid:invalid@127.0.0.1:5432/invalid",
    {
      max: process.env.NODE_ENV === "production" ? 20 : 5,
      idle_timeout: 30,
      connect_timeout: 10,
      prepare: false,
    },
  );

if (process.env.NODE_ENV !== "production")
  globalForDatabase.sqlClient = sqlClient;

export const db = drizzle(sqlClient, { schema });
export { schema, sqlClient };
export type Database = typeof db;
