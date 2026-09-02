import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db, sqlClient } from "../src/db";
import { enforceAwsMarketplaceLicenseOrExit } from "../src/lib/marketplace/aws/container-license";

const migrationLockId = 1_376_323_284;

async function main() {
  let lockConnection: Awaited<ReturnType<typeof sqlClient.reserve>> | undefined;
  let license: Awaited<ReturnType<typeof enforceAwsMarketplaceLicenseOrExit>>;
  try {
    license = await enforceAwsMarketplaceLicenseOrExit({
      startRevalidation: false,
    });
    lockConnection = await sqlClient.reserve();
    await lockConnection`select pg_advisory_lock(${migrationLockId})`;
    await migrate(db, { migrationsFolder: "src/db/migrations" });
    console.info("Database migrations applied");
  } finally {
    try {
      await license?.checkIn();
    } finally {
      try {
        if (lockConnection) {
          try {
            await lockConnection`select pg_advisory_unlock(${migrationLockId})`;
          } finally {
            lockConnection.release();
          }
        }
      } finally {
        await sqlClient.end();
      }
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
