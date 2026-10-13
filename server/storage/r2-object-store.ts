import { sha256Hex } from "../shared/crypto";

export interface ImmutableObjectStore {
  putOkf(key: string, markdown: string, expectedHash: string): Promise<void>;
  getOkf(key: string, expectedHash?: string): Promise<string | null>;
}

export class ObjectIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ObjectIntegrityError";
  }
}

export class R2ObjectStore implements ImmutableObjectStore {
  constructor(private readonly bucket: R2Bucket) {}

  async putOkf(key: string, markdown: string, expectedHash: string): Promise<void> {
    const actualHash = await sha256Hex(markdown);
    if (actualHash !== expectedHash) throw new ObjectIntegrityError("OKF hash does not match object key");

    const existing = await this.bucket.head(key);
    if (existing) {
      if (existing.customMetadata?.sha256 !== expectedHash) {
        throw new ObjectIntegrityError("Immutable object key already contains different content");
      }
      return;
    }

    await this.bucket.put(key, markdown, {
      httpMetadata: { contentType: "text/markdown; charset=utf-8" },
      customMetadata: { sha256: expectedHash },
    });
  }

  async getOkf(key: string, expectedHash?: string): Promise<string | null> {
    const object = await this.bucket.get(key);
    if (!object) return null;
    const markdown = await object.text();
    if (expectedHash && (await sha256Hex(markdown)) !== expectedHash) {
      throw new ObjectIntegrityError("Stored OKF object failed hash verification");
    }
    return markdown;
  }
}
