const encoder = new TextEncoder();

function bytes(value: string | Uint8Array): Uint8Array {
  return typeof value === "string" ? encoder.encode(value) : Uint8Array.from(value);
}

async function sha256Digest(value: string | Uint8Array): Promise<Uint8Array> {
  const input = bytes(value);
  const buffer = input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength) as ArrayBuffer;
  return new Uint8Array(await crypto.subtle.digest("SHA-256", buffer));
}

export async function sha256Hex(value: string | Uint8Array): Promise<string> {
  const digest = await sha256Digest(value);
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function constantTimeDigestEqual(left: string, right: string): Promise<boolean> {
  const [leftDigest, rightDigest] = await Promise.all([sha256Digest(left), sha256Digest(right)]);
  const subtle = crypto.subtle as SubtleCrypto & {
    timingSafeEqual?: (left: ArrayBufferView, right: ArrayBufferView) => boolean;
  };
  if (typeof subtle.timingSafeEqual === "function") return subtle.timingSafeEqual(leftDigest, rightDigest);
  let difference = 0;
  for (let index = 0; index < leftDigest.length; index += 1) difference |= leftDigest[index] ^ rightDigest[index];
  return difference === 0;
}

export function utf8Length(value: string): number {
  return encoder.encode(value).byteLength;
}
