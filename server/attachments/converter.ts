import { utf8Length } from "../shared/crypto";
import { MAX_MARKDOWN_BYTES, AttachmentServiceError } from "./types";

export interface MarkdownConversion {
  markdown: string;
  id?: string;
  tokens?: number;
  converter: string;
  mimeType?: string;
}

export interface MarkdownConverter {
  convert(input: {
    filename: string;
    mimeType: string;
    bytes: Uint8Array;
    deadlineAt?: number;
    now?: () => number;
  }): Promise<MarkdownConversion>;
}

type ToMarkdownAi = Pick<Ai, "toMarkdown">;

const CONVERSION_DEADLINE_MS = 45_000;

function validateMarkdownSize(markdown: string): void {
  if (utf8Length(markdown) > MAX_MARKDOWN_BYTES) {
    throw new AttachmentServiceError("PAYLOAD_TOO_LARGE", 413, "Converted Markdown exceeds 900 KiB");
  }
}

export class WorkersAiMarkdownConverter implements MarkdownConverter {
  constructor(
    private readonly ai: ToMarkdownAi,
    private readonly deadlineMs = CONVERSION_DEADLINE_MS,
  ) {}

  async convert(input: {
    filename: string;
    mimeType: string;
    bytes: Uint8Array;
    deadlineAt?: number;
    now?: () => number;
  }): Promise<MarkdownConversion> {
    let response: unknown;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const remaining = input.deadlineAt === undefined ? this.deadlineMs : input.deadlineAt - (input.now ?? Date.now)();
    if (remaining <= 0) throw new AttachmentServiceError("REMOTE_TIMEOUT", 504, "Remote attachment import timed out");
    const timeoutMs = Math.min(this.deadlineMs, remaining);
    const timeoutError = remaining < this.deadlineMs
      ? new AttachmentServiceError("REMOTE_TIMEOUT", 504, "Remote attachment import timed out")
      : new AttachmentServiceError("CONVERSION_TIMEOUT", 504, "Attachment conversion timed out");
    try {
      response = await Promise.race([
        this.ai.toMarkdown({
          name: input.filename,
          blob: new Blob([Uint8Array.from(input.bytes)], { type: input.mimeType }),
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(timeoutError),
            timeoutMs,
          );
        }),
      ]);
    } catch (error) {
      if (error instanceof AttachmentServiceError) throw error;
      throw new AttachmentServiceError("CONVERSION_UNAVAILABLE", 503, "Attachment conversion service is unavailable");
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
    const value = Array.isArray(response) ? response[0] : response;
    if (!value || typeof value !== "object") throw new AttachmentServiceError("CONVERSION_FAILED", 422, "Attachment conversion returned no result");
    const record = value as Record<string, unknown>;
    if (record.format === "error") throw new AttachmentServiceError("CONVERSION_FAILED", 422, "Attachment conversion reported an error");
    if (typeof record.data !== "string" || record.data.length === 0) {
      throw new AttachmentServiceError("CONVERSION_FAILED", 422, "Attachment conversion returned empty Markdown");
    }
    validateMarkdownSize(record.data);
    return {
      markdown: record.data,
      id: typeof record.id === "string" ? record.id : undefined,
      tokens: typeof record.tokens === "number" ? record.tokens : undefined,
      converter: "workers-ai-to-markdown",
      mimeType:
        typeof record.mimeType === "string"
          ? record.mimeType
          : typeof record.mimetype === "string"
            ? record.mimetype
            : undefined,
    };
  }
}

export function bypassToMarkdown(bytes: Uint8Array): MarkdownConversion {
  let markdown: string;
  try {
    markdown = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new AttachmentServiceError("UNSUPPORTED_MEDIA", 415, "Text attachment is not valid UTF-8");
  }
  if (markdown.length === 0) throw new AttachmentServiceError("EMPTY_BODY", 400, "Attachment body is empty");
  validateMarkdownSize(markdown);
  return { markdown, converter: "utf8-bypass", tokens: 0 };
}
