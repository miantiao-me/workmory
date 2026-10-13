import { describe, expect, it } from "vitest";
import { bypassToMarkdown, WorkersAiMarkdownConverter } from "../server/attachments/converter";
import { contentDispositionFilename } from "../server/attachments/content-disposition";
import { normalizeFilename, resolveAttachmentFormat, SUPPORTED_TO_MARKDOWN_FORMATS } from "../server/attachments/formats";
import { MAX_MARKDOWN_BYTES } from "../server/attachments/types";

const pdf = new TextEncoder().encode("%PDF-1.7\nfixture");

function conversionAi(toMarkdown: () => Promise<unknown>): Pick<Ai, "toMarkdown"> {
  return { toMarkdown } as unknown as Pick<Ai, "toMarkdown">;
}

describe("attachment formats and conversion", () => {
  it("parses Content-Disposition filenames", () => {
    expect(contentDispositionFilename("attachment; filename=note.txt")).toBe("note.txt");
    expect(contentDispositionFilename('attachment; filename="quoted note.txt"')).toBe("quoted note.txt");
    expect(contentDispositionFilename("attachment; filename=fallback.txt; filename*=UTF-8''caf%C3%A9.txt")).toBe("café.txt");
    expect(contentDispositionFilename("attachment; filename=fallback.txt; filename*=UTF-8''%ZZ")).toBe("fallback.txt");
    expect(contentDispositionFilename("attachment; xfilename=wrong.txt")).toBeUndefined();
    expect(contentDispositionFilename("attachment; notfilename*=UTF-8''wrong.txt")).toBeUndefined();
    expect(contentDispositionFilename(null)).toBeUndefined();
  });

  it("exports the frozen supported format contract", () => {
    const extensions = SUPPORTED_TO_MARKDOWN_FORMATS.flatMap((format) => [...format.extensions]);
    expect(extensions).toEqual(
      expect.arrayContaining([
        "pdf", "jpg", "jpeg", "png", "webp", "gif", "bmp", "svg", "html", "htm", "xml",
        "xlsx", "xlsm", "xlsb", "xls", "docx", "ods", "odt", "csv", "numbers",
      ]),
    );
  });

  it("normalizes safe filenames and rejects path/control names", () => {
    expect(normalizeFilename("cafe\u0301.txt")).toBe("café.txt");
    for (const filename of ["../secret.txt", "folder/file.txt", "bad\\file.txt", "bad\u0000.txt", `${"a".repeat(256)}.txt`]) {
      expect(() => normalizeFilename(filename)).toThrow();
    }
  });

  it("requires extension, MIME, and magic to remain in one family", () => {
    expect(resolveAttachmentFormat("report.pdf", "application/pdf", pdf)).toMatchObject({ detectedMime: "application/pdf", bypassAi: false });
    expect(() => resolveAttachmentFormat("report.png", "image/png", pdf)).toThrow();
    expect(() => resolveAttachmentFormat("report.pdf", "image/png", pdf)).toThrow();
  });

  it("bypasses AI only for safe UTF-8 Markdown and plain text", () => {
    const bytes = new TextEncoder().encode("# Durable note");
    expect(resolveAttachmentFormat("note.md", "text/markdown", bytes).bypassAi).toBe(true);
    expect(bypassToMarkdown(bytes)).toMatchObject({ markdown: "# Durable note", converter: "utf8-bypass", tokens: 0 });
    expect(() => bypassToMarkdown(new Uint8Array([0xff, 0xfe]))).toThrow();
  });

  it("handles AI success, error, throw, empty data, and oversize output", async () => {
    const success = new WorkersAiMarkdownConverter(conversionAi(
      async () => ({ id: "conversion-1", name: "report.pdf", mimetype: "application/pdf", format: "markdown", tokens: 12, data: "# Report" }),
    ));
    await expect(success.convert({ filename: "report.pdf", mimeType: "application/pdf", bytes: pdf })).resolves.toMatchObject({
      markdown: "# Report",
      id: "conversion-1",
      tokens: 12,
      mimeType: "application/pdf",
    });

    const cases = [
      async () => ({ format: "error", error: "bad" }),
      async () => {
        throw new Error("upstream");
      },
      async () => ({ format: "markdown", data: "" }),
      async () => ({ format: "markdown", data: "x".repeat(MAX_MARKDOWN_BYTES + 1) }),
    ];
    for (const toMarkdown of cases) {
      await expect(
        new WorkersAiMarkdownConverter(conversionAi(toMarkdown)).convert({ filename: "report.pdf", mimeType: "application/pdf", bytes: pdf }),
      ).rejects.toThrow();
    }

    await expect(
      new WorkersAiMarkdownConverter(
        conversionAi(() => new Promise(() => undefined)),
        1,
      ).convert({ filename: "report.pdf", mimeType: "application/pdf", bytes: pdf }),
    ).rejects.toMatchObject({ code: "CONVERSION_TIMEOUT", status: 504 });
    await expect(
      new WorkersAiMarkdownConverter(conversionAi(async () => { throw new Error("upstream"); })).convert({
        filename: "report.pdf",
        mimeType: "application/pdf",
        bytes: pdf,
      }),
    ).rejects.toMatchObject({ code: "CONVERSION_UNAVAILABLE", status: 503 });
  });
});
