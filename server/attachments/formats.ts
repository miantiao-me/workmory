import { utf8Length } from "../shared/crypto";
import { AttachmentServiceError } from "./types";

export const SUPPORTED_TO_MARKDOWN_FORMATS = Object.freeze([
  { extensions: ["pdf"], mimeTypes: ["application/pdf"], family: "pdf" },
  { extensions: ["jpg", "jpeg"], mimeTypes: ["image/jpeg"], family: "jpeg" },
  { extensions: ["png"], mimeTypes: ["image/png"], family: "png" },
  { extensions: ["webp"], mimeTypes: ["image/webp"], family: "webp" },
  { extensions: ["gif"], mimeTypes: ["image/gif"], family: "gif" },
  { extensions: ["bmp"], mimeTypes: ["image/bmp"], family: "bmp" },
  { extensions: ["svg"], mimeTypes: ["image/svg+xml"], family: "svg" },
  { extensions: ["html", "htm"], mimeTypes: ["text/html"], family: "html" },
  { extensions: ["xml"], mimeTypes: ["application/xml", "text/xml"], family: "xml" },
  { extensions: ["xlsx"], mimeTypes: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"], family: "zip" },
  { extensions: ["xlsm"], mimeTypes: ["application/vnd.ms-excel.sheet.macroenabled.12"], family: "zip" },
  { extensions: ["xlsb"], mimeTypes: ["application/vnd.ms-excel.sheet.binary.macroenabled.12"], family: "zip" },
  { extensions: ["xls"], mimeTypes: ["application/vnd.ms-excel"], family: "ole" },
  { extensions: ["docx"], mimeTypes: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"], family: "zip" },
  { extensions: ["ods"], mimeTypes: ["application/vnd.oasis.opendocument.spreadsheet"], family: "zip" },
  { extensions: ["odt"], mimeTypes: ["application/vnd.oasis.opendocument.text"], family: "zip" },
  { extensions: ["csv"], mimeTypes: ["text/csv", "application/csv"], family: "text" },
  { extensions: ["numbers"], mimeTypes: ["application/x-iwork-numbers-sffnumbers"], family: "zip" },
] as const);

const DIRECT_FORMATS = [
  { extensions: ["md", "markdown"], mimeTypes: ["text/markdown"], family: "text", detectedMime: "text/markdown" },
  { extensions: ["txt"], mimeTypes: ["text/plain"], family: "text", detectedMime: "text/plain" },
] as const;

function extension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot < 0 ? "" : filename.slice(dot + 1).toLowerCase();
}

function starts(bytes: Uint8Array, expected: number[]): boolean {
  return expected.every((value, index) => bytes[index] === value);
}

function detectedFamily(bytes: Uint8Array): string {
  if (starts(bytes, [0x25, 0x50, 0x44, 0x46])) return "pdf";
  if (starts(bytes, [0xff, 0xd8, 0xff])) return "jpeg";
  if (starts(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (new TextDecoder().decode(bytes.slice(0, 6)).startsWith("GIF8")) return "gif";
  if (starts(bytes, [0x42, 0x4d])) return "bmp";
  if (new TextDecoder().decode(bytes.slice(0, 12)).startsWith("RIFF") && new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP") return "webp";
  if (starts(bytes, [0x50, 0x4b, 0x03, 0x04])) return "zip";
  if (starts(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return "ole";
  if (bytes.includes(0)) return "binary";
  let sample = "";
  try {
    // stream: true only while sampling a prefix, so a multibyte character cut at the 2048 boundary is not fatal.
    sample = new TextDecoder("utf-8", { fatal: true })
      .decode(bytes.subarray(0, 2048), { stream: bytes.length > 2048 })
      .trimStart().toLowerCase();
  } catch {
    return "binary";
  }
  if (sample.startsWith("<svg") || sample.startsWith("<?xml") && sample.includes("<svg")) return "svg";
  if (sample.startsWith("<!doctype html") || sample.startsWith("<html")) return "html";
  if (sample.startsWith("<?xml") || /^<[a-z_:][^>]*>/.test(sample)) return "xml";
  return "text";
}

export interface ResolvedFormat {
  detectedMime: string;
  bypassAi: boolean;
}

export function resolveAttachmentFormat(filename: string, declaredMime: string | undefined, bytes: Uint8Array): ResolvedFormat {
  const declared = declaredMime?.split(";", 1)[0].trim().toLowerCase();
  const ext = extension(filename);
  const all = [...DIRECT_FORMATS, ...SUPPORTED_TO_MARKDOWN_FORMATS];
  const byExtension = all.find((format) => (format.extensions as readonly string[]).includes(ext));
  const byMime = declared && declared !== "application/octet-stream"
    ? all.find((format) => (format.mimeTypes as readonly string[]).includes(declared))
    : undefined;
  if (!byExtension && !byMime) throw new AttachmentServiceError("UNSUPPORTED_MEDIA", 415, "Unsupported attachment format");
  if (byExtension && byMime && byExtension.family !== byMime.family) {
    throw new AttachmentServiceError("UNSUPPORTED_MEDIA", 415, "Filename and declared MIME type disagree");
  }
  const format = byExtension ?? byMime!;
  const detected = detectedFamily(bytes);
  if (format.family !== detected) {
    throw new AttachmentServiceError("UNSUPPORTED_MEDIA", 415, "Attachment content does not match its format family");
  }
  const direct = DIRECT_FORMATS.includes(format as (typeof DIRECT_FORMATS)[number]);
  return {
    detectedMime: direct ? (format as (typeof DIRECT_FORMATS)[number]).detectedMime : format.mimeTypes[0],
    bypassAi: direct,
  };
}

export function normalizeFilename(value: string): string {
  const filename = value.normalize("NFC");
  if (
    filename.length === 0 ||
    utf8Length(filename) > 255 ||
    /[\\/\u0000-\u001f\u007f]/.test(filename)
  ) {
    throw new AttachmentServiceError("INVALID_FILENAME", 400, "Invalid attachment filename");
  }
  return filename;
}
