import { LocalStorageProvider } from "./local";
import { S3StorageProvider } from "./s3";
import type { StorageProvider } from "./types";

let provider: StorageProvider | undefined;

export function storage(): StorageProvider {
  if (provider) return provider;
  const name = process.env.STORAGE_PROVIDER ?? "local";
  if (name === "local") provider = new LocalStorageProvider();
  else if (name === "s3" || name === "minio" || name === "r2")
    provider = new S3StorageProvider(name);
  else throw new Error(`Unknown storage provider ${name}`);
  return provider;
}

/** Build an S3 client for a caller-supplied org dataRegion label. Does not move buckets. */
export function storageForRegion(region?: string): StorageProvider {
  if (!region) return storage();
  const name = process.env.STORAGE_PROVIDER ?? "local";
  if (name === "local") return new LocalStorageProvider();
  if (name === "s3" || name === "minio" || name === "r2")
    return new S3StorageProvider(name, { region });
  throw new Error(`Unknown storage provider ${name}`);
}

export * from "./types";
