import { enforceAwsMarketplaceLicenseOrExit } from "../src/lib/marketplace/aws/container-license";

void (async () => {
  await enforceAwsMarketplaceLicenseOrExit({ startRevalidation: false });
})();
