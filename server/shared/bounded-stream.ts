export class StreamLimitError extends Error {
  constructor(public readonly reason: "invalid-content-length" | "too-large") {
    super(reason);
    this.name = "StreamLimitError";
  }
}

export class StreamReadAbortedError extends Error {
  constructor() {
    super("stream read aborted");
    this.name = "StreamReadAbortedError";
  }
}

async function readChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal?: AbortSignal,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (!signal) return reader.read();
  if (signal.aborted) throw new StreamReadAbortedError();
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new StreamReadAbortedError());
    signal.addEventListener("abort", onAbort, { once: true });
    reader.read().then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

export async function readBoundedStream(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
  options: { contentLength?: number; signal?: AbortSignal } = {},
): Promise<Uint8Array> {
  const { contentLength, signal } = options;
  if (contentLength !== undefined && (!Number.isFinite(contentLength) || contentLength < 0)) {
    throw new StreamLimitError("invalid-content-length");
  }
  if (contentLength !== undefined && contentLength > maxBytes) throw new StreamLimitError("too-large");

  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await readChunk(reader, signal);
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel("stream too large");
        throw new StreamLimitError("too-large");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof StreamReadAbortedError) await reader.cancel("stream read aborted").catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }

  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}
