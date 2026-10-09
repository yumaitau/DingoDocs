import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

let warnedMissingIntegrationEncryptionKey = false;

export function integrationEncryptionKeyMaterial(
  env: NodeJS.ProcessEnv = process.env,
) {
  const configured = env.INTEGRATION_ENCRYPTION_KEY;
  if (configured) return configured;
  if (env.NODE_ENV === "production")
    throw new Error("INTEGRATION_ENCRYPTION_KEY is required in production");
  if (!warnedMissingIntegrationEncryptionKey) {
    warnedMissingIntegrationEncryptionKey = true;
    console.warn(
      "INTEGRATION_ENCRYPTION_KEY is missing; using a non-production fallback",
    );
  }
  return env.BETTER_AUTH_SECRET || "development-integration-key";
}

function encryptionKey() {
  return createHash("sha256")
    .update(integrationEncryptionKeyMaterial())
    .digest();
}

export function encryptIntegrationSecret(plaintext: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return ["v1", iv, tag, encrypted]
    .map((part) =>
      typeof part === "string" ? part : part.toString("base64url"),
    )
    .join(".");
}

export function decryptIntegrationSecret(value: string) {
  const [version, iv, tag, encrypted] = value.split(".");
  if (version !== "v1" || !iv || !tag || !encrypted)
    throw new Error("Encrypted integration value is invalid");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
