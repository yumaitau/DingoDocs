import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { access, mkdir, rm, stat } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { PutObjectInput, StorageProvider, StoredObject } from "./types";

export class LocalStorageProvider implements StorageProvider {
  readonly name = "local";
  private readonly root: string;

  constructor(root = process.env.LOCAL_STORAGE_ROOT ?? "./storage/data") {
    this.root = resolve(root);
  }

  private pathFor(key: string) {
    if (!/^[a-zA-Z0-9/_-]+(?:\.[a-zA-Z0-9_-]+)?$/.test(key))
      throw new Error("Invalid storage key");
    const path = resolve(this.root, key);
    if (path !== this.root && !path.startsWith(`${this.root}${sep}`))
      throw new Error("Storage key escapes configured root");
    return path;
  }

  async put(input: PutObjectInput): Promise<StoredObject> {
    const path = this.pathFor(input.key);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const hash = createHash("sha256");
    let size = 0;
    const source =
      input.body instanceof Uint8Array
        ? Readable.from(input.body)
        : Readable.from(input.body as unknown as AsyncIterable<Uint8Array>);
    source.on("data", (chunk: Buffer) => {
      size += chunk.length;
      hash.update(chunk);
    });
    await pipeline(
      source,
      createWriteStream(path, { mode: 0o600, flags: "wx" }),
    );
    if (input.expectedSize !== undefined && input.expectedSize !== size) {
      await rm(path, { force: true });
      throw new Error("Uploaded size does not match declared size");
    }
    return {
      key: input.key,
      size,
      sha256: hash.digest("hex"),
      mediaType: input.mediaType,
    };
  }

  async get(key: string) {
    return Readable.toWeb(
      createReadStream(this.pathFor(key)),
    ) as ReadableStream<Uint8Array>;
  }

  async delete(key: string) {
    await rm(this.pathFor(key), { force: true });
  }
  async exists(key: string) {
    try {
      await access(this.pathFor(key));
      return true;
    } catch {
      return false;
    }
  }
  async healthCheck() {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    await stat(this.root);
  }
}
