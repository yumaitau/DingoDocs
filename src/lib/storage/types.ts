export type StoredObject = {
  key: string;
  size: number;
  sha256: string;
  mediaType: string;
};

export type PutObjectInput = {
  key: string;
  body: ReadableStream<Uint8Array> | Uint8Array;
  mediaType: string;
  expectedSize?: number;
};

export interface StorageProvider {
  readonly name: string;
  put(input: PutObjectInput): Promise<StoredObject>;
  get(key: string): Promise<ReadableStream<Uint8Array>>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  createDownloadUrl?(key: string, expiresInSeconds: number): Promise<string>;
  healthCheck(): Promise<void>;
}
