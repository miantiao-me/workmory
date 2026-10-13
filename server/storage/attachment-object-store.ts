import { ObjectIntegrityError } from "./r2-object-store";
import { sha256Hex } from "../shared/crypto";

export interface AttachmentObjectStore {
  put(key: string, bytes: Uint8Array, sha256: string, contentType: string): Promise<void>;
  get(key: string, expectedSha256: string): Promise<{ bytes: Uint8Array } | null>;
  delete(keys: string[]): Promise<void>;
}

export class R2AttachmentObjectStore implements AttachmentObjectStore {
  constructor(private readonly bucket: R2Bucket) {}

  async put(key: string, bytes: Uint8Array, sha256: string, contentType: string): Promise<void> {
    if ((await sha256Hex(bytes)) !== sha256) throw new ObjectIntegrityError("Attachment hash mismatch before R2 write");
    const existing = await this.bucket.head(key);
    if (existing) {
      if (existing.customMetadata?.sha256 !== sha256) throw new ObjectIntegrityError("Immutable attachment object conflict");
      return;
    }
    await this.bucket.put(key, bytes, {
      httpMetadata: { contentType },
      customMetadata: { sha256 },
    });
  }

  async get(key: string, expectedSha256: string): Promise<{ bytes: Uint8Array } | null> {
    const object = await this.bucket.get(key);
    if (!object) return null;
    const bytes = new Uint8Array(await object.arrayBuffer());
    const sha256 = await sha256Hex(bytes);
    if (sha256 !== expectedSha256 || object.customMetadata?.sha256 !== expectedSha256) {
      throw new ObjectIntegrityError("Stored attachment failed integrity validation");
    }
    return { bytes };
  }

  async delete(keys: string[]): Promise<void> {
    if (keys.length > 0) await this.bucket.delete(keys);
  }
}
