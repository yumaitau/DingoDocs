import type { MarketplaceLicenseLease } from "./lib/marketplace/aws/container-license";

let marketplaceLicenseLease: MarketplaceLicenseLease | undefined;

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { enforceAwsMarketplaceLicenseOrExit } =
      await import("./lib/marketplace/aws/container-license");
    marketplaceLicenseLease = await enforceAwsMarketplaceLicenseOrExit({
      startRevalidation: true,
    });
    const { startJobRunner } = await import("./lib/jobs/runner");
    startJobRunner();
  }
}

void marketplaceLicenseLease;
