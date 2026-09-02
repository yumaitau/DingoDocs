import { describe, expect, it, vi } from "vitest";
import {
  assertAwsMarketplaceContainerLicense,
  AwsMarketplaceLicenseError,
  enforceAwsMarketplaceLicenseOrExit,
  runMarketplaceRevalidationTick,
} from "./container-license";
import type { AwsContainerLicenseClient } from "./container-client";
import {
  DINGODOCS_DISTRIBUTION,
  isAwsMarketplaceDistribution,
} from "./identity";

const identity = {
  productCode: "test-product-code",
  productSku: "prod-test",
  contractDimension: "standard_workspace",
  keyFingerprint: "aws:test:fingerprint",
};

function licenseClient(
  overrides: Partial<AwsContainerLicenseClient> = {},
): AwsContainerLicenseClient {
  return {
    async checkoutLicense(input) {
      return {
        names: [input.entitlements[0]?.Name ?? ""],
        licenseConsumptionToken: "consumption-token",
      };
    },
    async extendLicenseConsumption(input) {
      return { licenseConsumptionToken: input.licenseConsumptionToken };
    },
    async checkInLicense() {},
    ...overrides,
  };
}

describe("AWS Marketplace container licensing", () => {
  it("keeps community builds independent of buyer-controlled environment", async () => {
    expect(DINGODOCS_DISTRIBUTION).toBe("development");
    expect(isAwsMarketplaceDistribution()).toBe(false);
    await expect(
      assertAwsMarketplaceContainerLicense({
        env: {
          DINGODOCS_DISTRIBUTION: "aws-marketplace",
          DISABLE_LICENSE: "true",
        },
      }),
    ).resolves.toEqual({ skipped: true });
  });

  it("checks the baked contract dimension in Marketplace builds", async () => {
    const checkoutLicense = vi.fn(async (input) => ({
      names: [input.entitlements[0]?.Name ?? ""],
      licenseConsumptionToken: "consumption-token",
    }));
    await expect(
      assertAwsMarketplaceContainerLicense({
        distribution: "aws-marketplace",
        identity,
        env: { AWS_REGION: "ap-southeast-2" },
        client: licenseClient({ checkoutLicense }),
      }),
    ).resolves.toEqual({
      mode: "contract",
      licenseConsumptionToken: "consumption-token",
      expiration: undefined,
    });
    expect(checkoutLicense).toHaveBeenCalledWith(
      expect.objectContaining({
        productSku: "prod-test",
        keyFingerprint: "aws:test:fingerprint",
        region: "ap-southeast-2",
        entitlements: [
          { Name: "standard_workspace", Unit: "Count", Value: "1" },
        ],
      }),
    );
    expect(checkoutLicense.mock.calls[0]?.[0].clientToken).toMatch(
      /^[0-9a-f-]{36}$/,
    );
  });

  it("uses a fresh idempotency token for every checkout", async () => {
    const clientTokens: string[] = [];
    const client = licenseClient({
      async checkoutLicense(input) {
        clientTokens.push(input.clientToken);
        return {
          names: [identity.contractDimension],
          licenseConsumptionToken: `token-${clientTokens.length}`,
        };
      },
    });

    await assertAwsMarketplaceContainerLicense({
      distribution: "aws-marketplace",
      identity,
      env: { AWS_REGION: "ap-southeast-2" },
      client,
    });
    await assertAwsMarketplaceContainerLicense({
      distribution: "aws-marketplace",
      identity,
      env: { AWS_REGION: "ap-southeast-2" },
      client,
    });

    expect(clientTokens).toHaveLength(2);
    expect(clientTokens[0]).not.toBe(clientTokens[1]);
  });

  it("fails closed when identity or entitlement is unavailable", async () => {
    await expect(
      assertAwsMarketplaceContainerLicense({
        distribution: "aws-marketplace",
        identity: { ...identity, productSku: "" },
        env: { AWS_REGION: "ap-southeast-2" },
      }),
    ).rejects.toMatchObject({ code: "not_configured" });

    const exit = vi.fn((code: number) => {
      throw new Error(`exit:${code}`);
    }) as (code: number) => never;
    await expect(
      enforceAwsMarketplaceLicenseOrExit({
        distribution: "aws-marketplace",
        identity,
        env: { AWS_REGION: "ap-southeast-2" },
        client: licenseClient({
          async checkoutLicense() {
            throw Object.assign(new Error("not entitled"), {
              name: "CustomerNotEntitledException",
            });
          },
        }),
        exit,
      }),
    ).rejects.toThrow("exit:1");
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("does not accept a usage entitlement when the contract is unavailable", async () => {
    const checkoutLicense = vi.fn(async () => {
      throw Object.assign(new Error("no contract entitlement"), {
        name: "NoEntitlementsAllowedException",
      });
    });

    await expect(
      assertAwsMarketplaceContainerLicense({
        distribution: "aws-marketplace",
        identity,
        env: { AWS_REGION: "ap-southeast-2" },
        client: licenseClient({ checkoutLicense }),
      }),
    ).rejects.toMatchObject({ code: "not_entitled" });
    expect(checkoutLicense).toHaveBeenCalledTimes(1);
  });

  it("extends and checks in the returned consumption token", async () => {
    const extendLicenseConsumption = vi.fn(async () => ({
      licenseConsumptionToken: "renewed-token",
      expiration: "2026-09-03T00:00:00Z",
    }));
    const checkInLicense = vi.fn(async () => undefined);
    const state = {
      consecutiveTransient: 0,
      licenseConsumptionToken: "consumption-token",
    };
    const deps = {
      distribution: "aws-marketplace" as const,
      identity,
      env: { AWS_REGION: "ap-southeast-2" },
      client: licenseClient({
        extendLicenseConsumption,
        checkInLicense,
      }),
      revalidationState: state,
    };

    const lease = await enforceAwsMarketplaceLicenseOrExit(deps);
    await expect(runMarketplaceRevalidationTick(deps, state)).resolves.toBe(
      "ok",
    );
    expect(extendLicenseConsumption).toHaveBeenCalledWith({
      licenseConsumptionToken: "consumption-token",
      region: "ap-southeast-2",
    });
    await lease?.checkIn();
    await lease?.checkIn();
    expect(checkInLicense).toHaveBeenCalledOnce();
    expect(checkInLicense).toHaveBeenCalledWith({
      licenseConsumptionToken: "renewed-token",
      region: "ap-southeast-2",
    });
  });

  it("tolerates two transient heartbeats, then fails closed", async () => {
    const state = {
      consecutiveTransient: 0,
      licenseConsumptionToken: "consumption-token",
    };
    const deps = {
      distribution: "aws-marketplace" as const,
      identity,
      env: { AWS_REGION: "ap-southeast-2" },
      client: licenseClient({
        async extendLicenseConsumption() {
          throw new AwsMarketplaceLicenseError("timeout", "checkout_failed");
        },
      }),
    };
    await expect(runMarketplaceRevalidationTick(deps, state)).resolves.toBe(
      "retry",
    );
    await expect(runMarketplaceRevalidationTick(deps, state)).resolves.toBe(
      "retry",
    );
    await expect(runMarketplaceRevalidationTick(deps, state)).resolves.toBe(
      "fatal",
    );
  });
});
