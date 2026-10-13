import { readBoundedStream, StreamLimitError } from "../shared/bounded-stream";
import { HttpError } from "./errors";

// Reads a JSON request body with a byte cap, mapping stream/parse failures to handler-specific HttpErrors.
export async function readBoundedJson(request: Request, options: {
  maxBytes: number;
  tooLarge: { status: number; code: string; message: string };
  parseError: { status: number; code: string; message: string };
}): Promise<unknown> {
  const length = request.headers.get("content-length");
  let bytes: Uint8Array;
  try {
    bytes = await readBoundedStream(request.body ?? new ReadableStream({ start: (c) => c.close() }), options.maxBytes, {
      contentLength: length === null ? undefined : Number(length),
    });
  } catch (error) {
    if (error instanceof StreamLimitError) {
      throw new HttpError(options.tooLarge.status, options.tooLarge.code, options.tooLarge.message);
    }
    throw error;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new HttpError(options.parseError.status, options.parseError.code, options.parseError.message);
  }
}
