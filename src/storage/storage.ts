export interface StoredObject {
  key: string;
  size: number;
  sha256: string;
}

export interface StorageDriver {
  readonly name: "local" | "s3";
  putObject(key: string, body: Buffer | string, contentType: string): Promise<StoredObject>;
  headObject(key: string): Promise<{ exists: boolean; size?: number; sha256?: string }>;
  getObject(key: string): Promise<Buffer>;
  cleanupTemp?(): Promise<void>;
}
