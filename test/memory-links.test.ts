import { describe, expect, it } from "vitest";
import { extractMemoryLinks, MAX_MEMORY_LINKS, normalizeMemoryLinkTarget } from "../server/domain/memory-links";

describe("memory link extraction", () => {
  it("normalizes bundle-local root and relative Markdown targets", () => {
    expect(normalizeMemoryLinkTarget("guides/current/page", "../shared/note.md?view=1#part")).toBe("guides/shared/note");
    expect(normalizeMemoryLinkTarget("guides/current/page", "/root/note.md#part")).toBe("root/note");
    expect(normalizeMemoryLinkTarget("page", "./note.MD")).toBe("note");
    expect(normalizeMemoryLinkTarget("guides/page", "note%2Done%5Fv1.md")).toBe("guides/note-one_v1");
    expect(normalizeMemoryLinkTarget("guides/page", "note%20one.md")).toBeNull();
    expect(normalizeMemoryLinkTarget("guides/page", "%E8%B5%84%E6%96%99.md")).toBeNull();
  });

  it("rejects encoded path separators and NUL before percent-decoding", () => {
    expect(normalizeMemoryLinkTarget("guides/page", "nested%2Ftarget.md")).toBeNull();
    expect(normalizeMemoryLinkTarget("guides/page", "nested%2ftarget.md")).toBeNull();
    expect(normalizeMemoryLinkTarget("guides/page", "nested%5Ctarget.md")).toBeNull();
    expect(normalizeMemoryLinkTarget("guides/page", "target%00.md")).toBeNull();
  });

  it("extracts standard links, references, and sources while preserving duplicates", () => {
    const result = extractMemoryLinks(
      "guides/start",
      "[one](./target.md) [two][target] ![image](image.md) <external.md>\n\n[target]: ./target.md",
      [{ resource: "/source.md?download=1" }, { resource: "https://example.com/no.md" }],
    );
    expect(result).toEqual({
      status: "complete",
      truncated: false,
      links: [
        { origin: "link", rawTarget: "./target.md", targetKey: "guides/target", ordinal: 0 },
        { origin: "link", rawTarget: "./target.md", targetKey: "guides/target", ordinal: 1 },
        { origin: "source", rawTarget: "/source.md?download=1", targetKey: "source", ordinal: 2 },
      ],
    });
  });

  it("rejects external, fragment-only, HTML, non-Markdown, escaping, and oversized targets", () => {
    const oversized = `${"a".repeat(2_049)}.md`;
    const result = extractMemoryLinks(
      "root/page",
      `[external](https://example.com/a.md) [fragment](#x) [text](a.txt) [escape](../../a.md) [large](${oversized}) <a href="html.md">x</a>`,
      undefined,
    );
    expect(result.links).toEqual([]);
    expect(result.truncated).toBe(true);
  });

  it("caps accepted links and marks the extraction truncated", () => {
    const body = Array.from({ length: MAX_MEMORY_LINKS + 1 }, (_, index) => `[${index}](target-${index}.md)`).join(" ");
    const result = extractMemoryLinks("root/page", body, undefined);
    expect(result.links).toHaveLength(MAX_MEMORY_LINKS);
    expect(result.truncated).toBe(true);
  });
});
