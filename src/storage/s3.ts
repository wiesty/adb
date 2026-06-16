import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  type ServerSideEncryption,
  S3Client
} from "@aws-sdk/client-s3";
import type { AppConfig } from "../config/config.js";
import { sha256Hex } from "../utils/hash.js";
import type { StorageDriver, StoredObject } from "./storage.js";

export class S3StorageDriver implements StorageDriver {
  readonly name = "s3" as const;
  private readonly client: S3Client;

  constructor(private readonly config: AppConfig) {
    this.client = new S3Client({
      region: config.S3_REGION,
      endpoint: config.S3_ENDPOINT,
      forcePathStyle: config.S3_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: config.S3_ACCESS_KEY_ID ?? "",
        secretAccessKey: config.S3_SECRET_ACCESS_KEY ?? ""
      }
    });
  }

  async putObject(key: string, body: Buffer | string, contentType: string): Promise<StoredObject> {
    const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body, "utf8");
    const fullKey = this.fullKey(key);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.S3_BUCKET,
        Key: fullKey,
        Body: buffer,
        ContentType: contentType,
        ServerSideEncryption: this.config.S3_SERVER_SIDE_ENCRYPTION as
          | ServerSideEncryption
          | undefined,
        SSEKMSKeyId: this.config.S3_KMS_KEY_ID
      })
    );
    const head = await this.headObject(key);
    if (!head.exists || head.size !== buffer.length)
      throw new Error(`S3 HeadObject verification failed for ${key}`);
    return { key, size: buffer.length, sha256: sha256Hex(buffer) };
  }

  async headObject(key: string): Promise<{ exists: boolean; size?: number; sha256?: string }> {
    try {
      const response = await this.client.send(
        new HeadObjectCommand({ Bucket: this.config.S3_BUCKET, Key: this.fullKey(key) })
      );
      return { exists: true, size: response.ContentLength };
    } catch (error) {
      if ((error as { name?: string }).name === "NotFound") return { exists: false };
      throw error;
    }
  }

  async getObject(key: string): Promise<Buffer> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.config.S3_BUCKET, Key: this.fullKey(key) })
    );
    if (!response.Body) return Buffer.alloc(0);
    return Buffer.from(await response.Body.transformToByteArray());
  }

  private fullKey(key: string): string {
    const prefix = (this.config.S3_PREFIX || "").replace(/^\/+|\/+$/g, "");
    return prefix ? `${prefix}/${key}` : key;
  }
}
