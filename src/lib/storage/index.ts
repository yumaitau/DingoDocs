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

export * from "./types";
