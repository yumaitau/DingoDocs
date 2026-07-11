import cron from "node-cron";

const globalJobs = globalThis as unknown as { dingoJobsStarted?: boolean };

export function startJobRunner() {
  if (globalJobs.dingoJobsStarted) return;
  globalJobs.dingoJobsStarted = true;

  cron.schedule(
    "*/30 * * * * *",
    async () => {
      const { processNextJobs } = await import("./service");
      await processNextJobs(5);
    },
    { timezone: process.env.CRON_TIMEZONE ?? "Australia/Sydney" },
  );
}
