export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { enforceAwsMarketplaceLicenseOrExit } =
      await import("./src/lib/marketplace/aws/container-license");
    await enforceAwsMarketplaceLicenseOrExit({ startRevalidation: true });
    const { startJobRunner } = await import("./src/lib/jobs/runner");
    startJobRunner();
  }
}
