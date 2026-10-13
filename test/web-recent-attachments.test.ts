import { describe, expect, it } from "vitest";
import {
  loadRecentAttachments,
  parseRecentAttachments,
  recentAttachmentKey,
  saveRecentAttachments,
  type AttachmentStorage,
  type StoredAttachment,
} from "../web/lib/recent-attachments";

function createStorage(): AttachmentStorage & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
  };
}

const entry = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  project: "project-a",
  filename: "notes.pdf",
  status: "ready",
  createdAt: "2026-08-21T12:34:00.000Z",
  ...overrides,
});

describe("recent attachment persistence", () => {
  it("round-trips the five newest records per project and isolates projects", () => {
    const storage = createStorage();
    const a = Array.from({ length: 6 }, (_, index) => entry(`att_${index.toString(16).repeat(8).padEnd(32, "0")}`, { filename: `f${index}.txt` }));
    saveRecentAttachments(storage, "project-a", a);
    saveRecentAttachments(storage, "project-b", [entry("att_b".padEnd(36, "0"), { project: "project-b" })]);

    const restored = loadRecentAttachments(storage, "project-a");
    expect(restored).toHaveLength(5);
    expect(restored.map((item) => item.filename)).toEqual(a.slice(0, 5).map((item) => item.filename));
    expect(restored.every((item) => item.filename !== "f5.txt")).toBe(true);
    expect(loadRecentAttachments(storage, "project-b")).toHaveLength(1);
  });

  it("ignores corrupted or non-array data without throwing", () => {
    expect(parseRecentAttachments("not-json", "project-a")).toEqual([]);
    expect(parseRecentAttachments('{"id":1}', "project-a")).toEqual([]);
    expect(parseRecentAttachments(JSON.stringify({ id: "att_x" }), "project-a")).toEqual([]);
  });

  it("drops malformed or mismatched entries and keeps valid ones", () => {
    const valid = entry("att_a".padEnd(36, "0"));
    const raw = JSON.stringify([
      valid,
      entry("att_b".padEnd(36, "0"), { project: "project-b" }),
      entry("not-an-id", {}),
      entry("att_c".padEnd(36, "0"), { filename: "" }),
      entry("att_d".padEnd(36, "0"), { status: 42 }),
      "string",
      null,
      entry("att_e".padEnd(36, "0"), { project: "project-a", filename: "ok.md" }),
    ]);
    expect(parseRecentAttachments(raw, "project-a").map((item) => item.id)).toEqual([
      "att_a".padEnd(36, "0"),
      "att_e".padEnd(36, "0"),
    ]);
  });

  it("never stores more than the minimal entry fields", () => {
    const storage = createStorage();
    const withExtraFields = {
      ...entry("att_a".padEnd(36, "0")),
      sourceUrl: "https://example.com/private",
      originalSha256: "abc",
      converter: "mammoth",
    } as unknown as StoredAttachment;
    saveRecentAttachments(storage, "project-a", [withExtraFields]);
    const stored = JSON.parse(storage.values.get(recentAttachmentKey("project-a")) ?? "[]");
    expect(Object.keys(stored[0]).sort()).toEqual(["createdAt", "filename", "id", "project", "status"]);
  });

  it("returns empty when storage access fails and does not throw on failed writes", () => {
    const failingRead = {
      getItem: () => { throw new Error("blocked"); },
    } as unknown as Pick<AttachmentStorage, "getItem">;
    expect(loadRecentAttachments(failingRead, "project-a")).toEqual([]);

    const failingWrite = {
      getItem: () => null,
      setItem: () => { throw new Error("quota"); },
      removeItem: () => { throw new Error("quota"); },
    } as AttachmentStorage;
    expect(() => saveRecentAttachments(failingWrite, "project-a", [entry("att_a".padEnd(36, "0"))])).not.toThrow();
    expect(() => saveRecentAttachments(failingWrite, "project-a", [])).not.toThrow();
  });
});
