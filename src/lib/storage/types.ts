export type StoredObject = {
  key: string;
  size: number;
  sha256: string;
  mediaType: string;
  encryptionMetadata?: Record<string, string>;
};

export type PutObjectInput = {
  key: string;
  body: ReadableStream<Uint8Array> | Uint8Array;
  mediaType: string;
  expectedSize?: number;
};

export type DownloadUrlOptions = {
  /** Name offered to the browser; the download is always an attachment. */
  filename?: string;
  /** Stored media type; only passive image types are served as-is. */
  contentType?: string;
};

export interface StorageProvider {
  readonly name: string;
  put(input: PutObjectInput): Promise<StoredObject>;
  get(key: string): Promise<ReadableStream<Uint8Array>>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  createDownloadUrl?(
    key: string,
    expiresInSeconds: number,
    options?: DownloadUrlOptions,
  ): Promise<string>;
  healthCheck(): Promise<void>;
}
