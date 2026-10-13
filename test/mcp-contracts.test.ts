import { describe, expect, it } from "vitest";
import { listInputSchema, searchInputSchema, storeInputSchema } from "../server/mcp/memory-contracts";
import { profileGetInputSchema, profileUpdateInputSchema } from "../server/mcp/profile-contracts";

describe("MCP contracts", () => {
  it("enforces projection limits by UTF-8 bytes", () => {
    const base = { project: "workmory", namespace: "default", key: "utf8/boundary", content: "x" };
    expect(storeInputSchema.safeParse({ ...base, tags: ["界".repeat(21)] }).success).toBe(true);
    expect(storeInputSchema.safeParse({ ...base, tags: ["界".repeat(22)] }).success).toBe(false);
  });

  it("enforces one content source, shared remote URL policy, safe identifiers, and no project_root", () => {
    const base = { project: "workmory", namespace: "default", key: "docs/decision" };
    expect(storeInputSchema.safeParse({ ...base, content: "durable" }).success).toBe(true);
    expect(storeInputSchema.safeParse({ ...base, content: "x", attachment_id: "a" }).success).toBe(false);
    for (const source_url of ["http://example.com", "https://user@example.com/file", "https://example.com:8443/file"]) {
      expect(storeInputSchema.safeParse({ ...base, source_url, operation_id: "operation-123" }).success).toBe(false);
    }
    expect(storeInputSchema.safeParse({ ...base, source_url: "https://example.com/file.pdf" }).success).toBe(false);
    expect(storeInputSchema.safeParse({ ...base, source_url: "https://example.com/file.pdf", operation_id: "operation-123" }).success).toBe(true);
    expect(storeInputSchema.safeParse({ ...base, attachment_id: `att_${"a".repeat(32)}` }).success).toBe(true);
    expect(storeInputSchema.safeParse({ project_root: "/tmp", namespace: "default", key: "x", content: "x" }).success).toBe(false);
    expect(storeInputSchema.safeParse({ ...base, key: "../secret", content: "x" }).success).toBe(false);
  });

  it("applies search defaults and upper bounds", () => {
    expect(searchInputSchema.parse({ project: "workmory", query: "architecture" })).toMatchObject({
      namespace: "default", semantic_weight: 0.5, limit: 20,
    });
    expect(searchInputSchema.safeParse({ project: "workmory", query: "x", limit: 51 }).success).toBe(false);
    expect(searchInputSchema.safeParse({ project: "workmory", query: "x", semantic_weight: 1.1 }).success).toBe(false);
  });

  it("applies strict memory list defaults and cursor bounds", () => {
    expect(listInputSchema.parse({ project: "workmory" })).toEqual({
      project: "workmory", namespace: "default", limit: 20,
    });
    expect(listInputSchema.parse({ project: "workmory", filters: {} }).filters).toEqual({ tag_match: "any" });
    expect(listInputSchema.safeParse({ project: "workmory", extra: true }).success).toBe(false);
    expect(listInputSchema.safeParse({ project: "workmory", filters: { extra: true } }).success).toBe(false);
    expect(listInputSchema.safeParse({ project: "workmory", cursor: "not+padded=" }).success).toBe(false);
    expect(listInputSchema.safeParse({ project: "workmory", cursor: "a".repeat(513) }).success).toBe(false);
    expect(listInputSchema.safeParse({ project: "workmory", limit: 51 }).success).toBe(false);
    expect(listInputSchema.safeParse({ project: "workmory", filters: { tags: Array.from({ length: 33 }, (_, index) => `tag-${index}`) } }).success).toBe(false);
  });

  it("reuses profile domain validation with snake_case wire fields", () => {
    expect(profileGetInputSchema.parse({})).toEqual({ include_sensitive: false, include_raw: false });
    expect(profileGetInputSchema.safeParse({ include_raw: true }).success).toBe(false);
    const valid = { operations: [{
      op: "set", section: "preferences", field: "theme",
      field_value: { state: "set", value: "dark", provenance: { kind: "user_explicit", recorded_at: "2026-08-19T10:00:00Z" } },
    }] };
    expect(profileUpdateInputSchema.safeParse(valid).success).toBe(true);
    expect(profileUpdateInputSchema.safeParse({ operations: [{
      ...valid.operations[0],
      field_value: { ...valid.operations[0].field_value, provenance: { kind: "user_explicit", recorded_at: "2026-08-19T10:00Z" } },
    }] }).success).toBe(false);
    expect(profileUpdateInputSchema.safeParse({ operations: [] }).success).toBe(false);
    expect(profileUpdateInputSchema.safeParse({ operations: [{
      op: "suppress", section: "preferences", field: "theme",
      field_value: { state: "suppressed", provenance: { kind: "user_explicit", recorded_at: "2026-08-19T10:00:00Z" } },
    }] }).success).toBe(false);
  });
});
