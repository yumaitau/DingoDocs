import {
  CheckInLicenseCommand,
  CheckoutLicenseCommand,
  ExtendLicenseConsumptionCommand,
  LicenseManagerClient,
  type Entitlement,
} from "@aws-sdk/client-license-manager";

export type AwsContainerLicenseCheckout = {
  names: string[];
  licenseConsumptionToken?: string;
  expiration?: string;
};

export type AwsContainerLicenseClient = {
  checkoutLicense(input: {
    productSku: string;
    keyFingerprint: string;
    clientToken: string;
    region: string;
    entitlements: Array<{ Name: string; Unit: string; Value?: string }>;
  }): Promise<AwsContainerLicenseCheckout>;
  extendLicenseConsumption(input: {
    licenseConsumptionToken: string;
    region: string;
  }): Promise<{ licenseConsumptionToken?: string; expiration?: string }>;
  checkInLicense(input: {
    licenseConsumptionToken: string;
    region: string;
  }): Promise<void>;
};

export const awsContainerLicenseClient: AwsContainerLicenseClient = {
  async checkoutLicense(input) {
    const client = new LicenseManagerClient({ region: input.region });
    const result = await client.send(
      new CheckoutLicenseCommand({
        ProductSKU: input.productSku,
        CheckoutType: "PROVISIONAL",
        KeyFingerprint: input.keyFingerprint,
        ClientToken: input.clientToken,
        Entitlements: input.entitlements as Entitlement[],
      }),
    );
    return {
      names: (result.EntitlementsAllowed ?? [])
        .map((entry) => entry.Name)
        .filter((name): name is string => Boolean(name)),
      licenseConsumptionToken: result.LicenseConsumptionToken,
      expiration: result.Expiration,
    };
  },
  async extendLicenseConsumption(input) {
    const client = new LicenseManagerClient({ region: input.region });
    const result = await client.send(
      new ExtendLicenseConsumptionCommand({
        LicenseConsumptionToken: input.licenseConsumptionToken,
      }),
    );
    return {
      licenseConsumptionToken: result.LicenseConsumptionToken,
      expiration: result.Expiration,
    };
  },
  async checkInLicense(input) {
    const client = new LicenseManagerClient({ region: input.region });
    await client.send(
      new CheckInLicenseCommand({
        LicenseConsumptionToken: input.licenseConsumptionToken,
      }),
    );
  },
};
