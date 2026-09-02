import {
  GENERATED_DISTRIBUTION,
  GENERATED_MARKETPLACE_IDENTITY,
} from "./identity.generated";

export type DingoDocsDistribution =
  "aws-marketplace" | "community" | "development";

export type AwsMarketplaceIdentity = {
  productCode: string;
  productSku: string;
  contractDimension: string;
  keyFingerprint: string;
};

/**
 * Compile-time distribution and product identity. Marketplace image builds
 * overwrite identity.generated.ts. Buyer-controlled runtime variables are
 * deliberately ignored.
 */
export const DINGODOCS_DISTRIBUTION =
  GENERATED_DISTRIBUTION as DingoDocsDistribution;
export const AWS_MARKETPLACE_IDENTITY: AwsMarketplaceIdentity =
  GENERATED_MARKETPLACE_IDENTITY;

export function isAwsMarketplaceDistribution(
  distribution: string = DINGODOCS_DISTRIBUTION,
) {
  return distribution === "aws-marketplace";
}
