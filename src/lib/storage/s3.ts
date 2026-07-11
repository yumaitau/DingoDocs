import { createHash } from "node:crypto";
import { Readable, Transform } from "node:stream";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { PutObjectInput, StorageProvider } from "./types";

export class S3StorageProvider implements StorageProvider {
  readonly name: string;
  private readonly bucket: string;
  private readonly client: S3Client;

  constructor(name: "s3" | "minio" | "r2" = "s3") {
    this.name = name;
    this.bucket = required("S3_BUCKET");
    this.client = new S3Client({
      region: process.env.S3_REGION ?? "us-east-1",
      endpoint: process.env.S3_ENDPOINT || undefined,
      forcePathStyle:
        name === "minio" || Boolean(process.env.S3_FORCE_PATH_STYLE),
      credentials: process.env.S3_ACCESS_KEY_ID
        ? {
            accessKeyId: required("S3_ACCESS_KEY_ID"),
            secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
          }
        : undefined,
    });
  }

  async put(input: PutObjectInput) {
    const hash = createHash("sha256");
    let size = 0;
    const source =
      input.body instanceof Uint8Array
        ? Readable.from([Buffer.from(input.body)])
        : Readable.from(input.body as unknown as AsyncIterable<Uint8Array>);
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        size += chunk.length;
        hash.update(chunk);
        callback(null, chunk);
      },
    });
    const body = source.pipe(meter);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: input.key,
        Body: body,
        ContentType: input.mediaType,
        ContentLength: input.expectedSize,
      }),
    );
    if (input.expectedSize !== undefined && size !== input.expectedSize) {
      await this.delete(input.key);
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
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    if (!response.Body) throw new Error("Object body is unavailable");
    return response.Body.transformToWebStream() as ReadableStream<Uint8Array>;
  }

  async delete(key: string) {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }
  async exists(key: string) {
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return true;
    } catch {
      return false;
    }
  }
  async createDownloadUrl(key: string, expiresInSeconds: number) {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: Math.min(900, Math.max(30, expiresInSeconds)) },
    );
  }
  async healthCheck() {
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
  }
}

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
