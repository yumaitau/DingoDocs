export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startJobRunner } = await import("./src/lib/jobs/runner");
    startJobRunner();
  }
}
