# AWS Marketplace container distribution

DingoDocs publishes separate application and migration images for AWS Marketplace deployments. Both images validate the buyer's AWS Marketplace entitlement before serving traffic or applying database migrations. Community images skip this check.

## Build the release images

Marketplace product identity is compiled into each image. The listing pipeline must supply all five build arguments and must use the same values for both targets:

```bash
docker build \
  --target runner \
  --build-arg DINGODOCS_DISTRIBUTION=aws-marketplace \
  --build-arg AWS_MARKETPLACE_PRODUCT_CODE="$AWS_MARKETPLACE_PRODUCT_CODE" \
  --build-arg AWS_MARKETPLACE_PRODUCT_SKU="$AWS_MARKETPLACE_PRODUCT_SKU" \
  --build-arg AWS_MARKETPLACE_CONTRACT_DIMENSION="$AWS_MARKETPLACE_CONTRACT_DIMENSION" \
  --build-arg AWS_MARKETPLACE_LICENSE_FINGERPRINT="$AWS_MARKETPLACE_LICENSE_FINGERPRINT" \
  --tag "$APPLICATION_IMAGE" .

docker build \
  --target migrator \
  --build-arg DINGODOCS_DISTRIBUTION=aws-marketplace \
  --build-arg AWS_MARKETPLACE_PRODUCT_CODE="$AWS_MARKETPLACE_PRODUCT_CODE" \
  --build-arg AWS_MARKETPLACE_PRODUCT_SKU="$AWS_MARKETPLACE_PRODUCT_SKU" \
  --build-arg AWS_MARKETPLACE_CONTRACT_DIMENSION="$AWS_MARKETPLACE_CONTRACT_DIMENSION" \
  --build-arg AWS_MARKETPLACE_LICENSE_FINGERPRINT="$AWS_MARKETPLACE_LICENSE_FINGERPRINT" \
  --tag "$MIGRATOR_IMAGE" .
```

The build fails if a Marketplace identity value is blank. `DINGODOCS_DISTRIBUTION`, product identity, and fingerprint environment variables supplied when a container starts cannot replace the compiled values. Do not publish images built with test or placeholder listing values.

## Runtime contract

The application performs an AWS License Manager `CheckoutLicense` call before it accepts HTTP requests. It renews the returned consumption token with `ExtendLicenseConsumption` every 15 minutes and checks it in during an orderly shutdown. The migrator checks out a license before it opens the migration directory and checks it in after migration. An active contract entitlement matching the compiled dimension is required.

Transient credential or service failures are retried three times at five-second intervals. A Marketplace container exits non-zero when validation still cannot complete, the account is not entitled, the platform is unsupported, the compiled identity is invalid, or License Manager denies the call. The application revalidates every 15 minutes and exits after three consecutive transient failures or one permanent failure.

The workload needs:

- `AWS_REGION` or `AWS_DEFAULT_REGION`
- task or pod credentials; never static access keys in environment variables
- `license-manager:CheckoutLicense`, `license-manager:ExtendLicenseConsumption`, and `license-manager:CheckInLicense` permissions on `*`
- ECS, EKS, or Fargate runtime support for AWS Marketplace container licensing

Set `EMAIL_PROVIDER=ses`, `EMAIL_FROM` to a verified SES identity, and optionally `SES_REGION` to send authentication mail with the task or pod role. The role needs `ses:SendEmail`; no SMTP or static AWS credentials are required. For a temporary install without mail, set `EMAIL_PROVIDER=none` and `REQUIRE_EMAIL_VERIFICATION=false` together. Password-reset, invitation, verification, and magic-link messages are unavailable in that mode.

Neither `DISABLE_LICENSE` nor a runtime distribution setting bypasses validation. This is deliberate: entitlement identity belongs to the seller-built artifact, not the buyer's deployment configuration.

## Deployment order

1. Provision PostgreSQL, object storage, encryption, secrets, and workload IAM roles.
2. Run the Marketplace migrator as a one-shot ECS task or Kubernetes Job.
3. Require a successful migrator exit before replacing the application service.
4. Start the application image and route traffic only after `/api/ready` succeeds.
5. Keep the previous immutable image digest available for application rollback. Coordinate database and object-storage backups before every upgrade.

The migrator serializes concurrent starts with a PostgreSQL advisory lock, which makes rolling Kubernetes init containers safe. The application image runs as UID/GID `1001` and writes local storage below `/app/storage`. Production deployments should use S3-compatible storage and keep the container root filesystem read-only apart from an explicitly mounted storage path when local storage is required.

## Community builds

Omitting the distribution argument produces a development image. Public community releases should set `DINGODOCS_DISTRIBUTION=community`; no Marketplace identity is required and no License Manager API call is made.
