import { randomUUID } from "node:crypto";
import {
  AWS_MARKETPLACE_IDENTITY,
  DINGODOCS_DISTRIBUTION,
  isAwsMarketplaceDistribution,
  type AwsMarketplaceIdentity,
  type DingoDocsDistribution,
} from "./identity";
import {
  awsContainerLicenseClient,
  type AwsContainerLicenseClient,
} from "./container-client";

export const AWS_MARKETPLACE_LICENSE_REVALIDATE_MS = 15 * 60 * 1000;
export const AWS_MARKETPLACE_STARTUP_RETRY_ATTEMPTS = 3;
export const AWS_MARKETPLACE_STARTUP_RETRY_MS = 5_000;
export const AWS_MARKETPLACE_TRANSIENT_FAILURE_LIMIT = 3;

export class AwsMarketplaceLicenseError extends Error {
  constructor(
    message: string,
    readonly code:
      | "not_entitled"
      | "not_configured"
      | "unsupported_platform"
      | "credentials_missing"
      | "access_denied"
      | "checkout_failed",
  ) {
    super(message);
    this.name = "AwsMarketplaceLicenseError";
  }
}

export type RevalidationState = {
  consecutiveTransient: number;
  licenseConsumptionToken?: string;
  expiration?: string;
};
export type MarketplaceLicenseLease = {
  checkIn: () => Promise<void>;
};
type LicenseDeps = {
  distribution?: DingoDocsDistribution;
  identity?: AwsMarketplaceIdentity;
  client?: AwsContainerLicenseClient;
  env?: Record<string, string | undefined>;
  startRevalidation?: boolean;
  exit?: (code: number) => never;
  sleep?: (ms: number) => Promise<void>;
  startupAttempts?: number;
  startupRetryMs?: number;
  revalidationState?: RevalidationState;
};

export function resolveAwsRuntimeRegion(
  env: Record<string, string | undefined> = process.env,
) {
  const region = env.AWS_REGION?.trim() || env.AWS_DEFAULT_REGION?.trim();
  if (!region)
    throw new AwsMarketplaceLicenseError(
      "AWS_REGION is required for Marketplace license validation",
      "not_configured",
    );
  return region;
}

export async function assertAwsMarketplaceContainerLicense(
  deps: LicenseDeps = {},
): Promise<
  | { skipped: true }
  | {
      mode: "contract";
      licenseConsumptionToken: string;
      expiration?: string;
    }
> {
  const distribution = deps.distribution ?? DINGODOCS_DISTRIBUTION;
  if (!isAwsMarketplaceDistribution(distribution)) return { skipped: true };

  const identity = deps.identity ?? AWS_MARKETPLACE_IDENTITY;
  if (
    !identity.productCode ||
    !identity.productSku ||
    !identity.contractDimension ||
    !identity.keyFingerprint
  )
    throw new AwsMarketplaceLicenseError(
      "DingoDocs Marketplace identity is missing from this image",
      "not_configured",
    );

  const client = deps.client ?? awsContainerLicenseClient;
  const region = resolveAwsRuntimeRegion(deps.env);
  try {
    const result = await client.checkoutLicense({
      productSku: identity.productSku,
      keyFingerprint: identity.keyFingerprint,
      clientToken: randomUUID(),
      region,
      entitlements: [
        { Name: identity.contractDimension, Unit: "Count", Value: "1" },
      ],
    });
    if (!result.names.includes(identity.contractDimension))
      throw new AwsMarketplaceLicenseError(
        "This AWS account is not subscribed to DingoDocs on AWS Marketplace",
        "not_entitled",
      );
    if (!result.licenseConsumptionToken)
      throw new AwsMarketplaceLicenseError(
        "AWS License Manager did not return a consumption token",
        "checkout_failed",
      );
    return {
      mode: "contract",
      licenseConsumptionToken: result.licenseConsumptionToken,
      expiration: result.expiration,
    };
  } catch (error) {
    throw mapLicenseError(error);
  }
}

export async function enforceAwsMarketplaceLicenseOrExit(
  deps: LicenseDeps = {},
): Promise<MarketplaceLicenseLease | undefined> {
  const distribution = deps.distribution ?? DINGODOCS_DISTRIBUTION;
  if (!isAwsMarketplaceDistribution(distribution)) return;

  const exit = deps.exit ?? ((code: number) => process.exit(code) as never);
  const sleep = deps.sleep ?? defaultSleep;
  const attempts =
    deps.startupAttempts ?? AWS_MARKETPLACE_STARTUP_RETRY_ATTEMPTS;
  const retryMs = deps.startupRetryMs ?? AWS_MARKETPLACE_STARTUP_RETRY_MS;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      console.info("Validating AWS Marketplace entitlement");
      const validation = await assertAwsMarketplaceContainerLicense(deps);
      if ("skipped" in validation) return;
      console.info("AWS Marketplace entitlement validated");
      const state = deps.revalidationState ?? { consecutiveTransient: 0 };
      state.consecutiveTransient = 0;
      state.licenseConsumptionToken = validation.licenseConsumptionToken;
      state.expiration = validation.expiration;
      const lease = createMarketplaceLicenseLease(deps, state);
      if (deps.startRevalidation)
        startMarketplaceRevalidation(deps, state, lease);
      return lease;
    } catch (error) {
      const mapped = mapLicenseError(error);
      if (!isTransient(mapped) || attempt === attempts) {
        console.error(
          "DingoDocs could not validate its AWS Marketplace entitlement",
        );
        console.error(`reason=${mapped.code}`);
        exit(1);
      }
      console.warn("Marketplace validation unavailable; retrying");
      await sleep(retryMs);
    }
  }
}

export async function runMarketplaceRevalidationTick(
  deps: LicenseDeps = {},
  state: RevalidationState = { consecutiveTransient: 0 },
): Promise<"ok" | "retry" | "fatal"> {
  try {
    if (!state.licenseConsumptionToken)
      throw new AwsMarketplaceLicenseError(
        "AWS Marketplace consumption token is unavailable",
        "checkout_failed",
      );
    const client = deps.client ?? awsContainerLicenseClient;
    const result = await client.extendLicenseConsumption({
      licenseConsumptionToken: state.licenseConsumptionToken,
      region: resolveAwsRuntimeRegion(deps.env),
    });
    state.licenseConsumptionToken =
      result.licenseConsumptionToken ?? state.licenseConsumptionToken;
    state.expiration = result.expiration ?? state.expiration;
    state.consecutiveTransient = 0;
    return "ok";
  } catch (error) {
    const mapped = mapLicenseError(error);
    if (!isTransient(mapped)) return "fatal";
    state.consecutiveTransient += 1;
    return state.consecutiveTransient >= AWS_MARKETPLACE_TRANSIENT_FAILURE_LIMIT
      ? "fatal"
      : "retry";
  }
}

function createMarketplaceLicenseLease(
  deps: LicenseDeps,
  state: RevalidationState,
): MarketplaceLicenseLease {
  let checkedIn = false;
  return {
    async checkIn() {
      if (checkedIn || !state.licenseConsumptionToken) return;
      checkedIn = true;
      const client = deps.client ?? awsContainerLicenseClient;
      await client.checkInLicense({
        licenseConsumptionToken: state.licenseConsumptionToken,
        region: resolveAwsRuntimeRegion(deps.env),
      });
    },
  };
}

function startMarketplaceRevalidation(
  deps: LicenseDeps,
  state: RevalidationState,
  lease: MarketplaceLicenseLease,
) {
  const exit = deps.exit ?? ((code: number) => process.exit(code) as never);
  const timer = setInterval(() => {
    void runMarketplaceRevalidationTick(deps, state).then((outcome) => {
      if (outcome === "fatal") {
        console.error("AWS Marketplace entitlement is no longer valid");
        void lease.checkIn().finally(() => exit(1));
      }
    });
  }, AWS_MARKETPLACE_LICENSE_REVALIDATE_MS);
  timer.unref?.();

  if (!deps.exit) {
    const shutdown = (code: number) => {
      clearInterval(timer);
      void lease
        .checkIn()
        .catch(() =>
          console.warn(
            "AWS Marketplace license check-in failed during shutdown",
          ),
        )
        .finally(() => process.exit(code));
    };
    process.once("SIGTERM", () => shutdown(0));
    process.once("SIGINT", () => shutdown(130));
  }
}

function isTransient(error: AwsMarketplaceLicenseError) {
  return ["checkout_failed", "credentials_missing"].includes(error.code);
}

function mapLicenseError(error: unknown) {
  if (error instanceof AwsMarketplaceLicenseError) return error;
  const name =
    error && typeof error === "object" && "name" in error
      ? String(error.name)
      : "";
  const message = error instanceof Error ? error.message : "";
  if (
    [
      "CredentialsProviderError",
      "ExpiredTokenException",
      "TokenProviderError",
      "UnrecognizedClientException",
    ].includes(name) ||
    /credential/i.test(message)
  )
    return new AwsMarketplaceLicenseError(
      "AWS credentials are unavailable",
      "credentials_missing",
    );
  if (/AccessDenied/i.test(name) || /access denied/i.test(message))
    return new AwsMarketplaceLicenseError(
      "AWS License Manager denied access",
      "access_denied",
    );
  if (
    ["CustomerNotEntitledException", "NoEntitlementsAllowedException"].includes(
      name,
    ) ||
    /not entitled|NoEntitlementsAllowed/i.test(message)
  )
    return new AwsMarketplaceLicenseError(
      "No active DingoDocs entitlement was found",
      "not_entitled",
    );
  if (name === "PlatformNotSupportedException")
    return new AwsMarketplaceLicenseError(
      "Marketplace licensing requires ECS, EKS, or Fargate",
      "unsupported_platform",
    );
  return new AwsMarketplaceLicenseError(
    "AWS Marketplace license checkout failed",
    "checkout_failed",
  );
}

function defaultSleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
