import { describe, expect, it } from "vitest";
import {
  getTrustTier,
  isStale,
  parseOkf,
  serializeOkf,
  validateOkf,
} from "../server/domain/okf";

describe("OKF v0.2 domain", () => {
  it("accepts the minimal concept document", () => {
    const result = validateOkf("---\ntype: Concept\n---\nBody");
    expect(result).toMatchObject({ valid: true, errors: [], warnings: [] });
    expect(result.document?.body).toBe("Body");
  });

  it("parses and serializes a complete document", () => {
    const markdown = `---
type: Metric
title: Revenue
status: stable
stale_after: 2026-12-31
generated: { by: agent/1, at: 2026-08-18T00:00:00Z }
verified: { by: human:reviewer, at: 2026-08-18T01:00:00Z }
sources:
  - { id: policy, resource: https://example.com/policy }
---
# Definition
Revenue definition.`;
    const parsed = parseOkf(markdown);
    expect(parsed.normalized).toMatchObject({
      status: "stable",
      staleAfter: "2026-12-31",
      verified: [{ by: "human:reviewer" }],
      sources: [{ id: "policy" }],
    });
    expect(validateOkf(serializeOkf(parsed)).valid).toBe(true);
  });

  it("preserves unknown frontmatter fields through a semantic round trip", () => {
    const parsed = parseOkf("---\ntype: Future Type\nextension:\n  nested: 42\n---\nUnknown");
    const reparsed = parseOkf(serializeOkf(parsed));
    expect(reparsed.frontmatter.extension).toEqual({ nested: 42 });
    expect(reparsed.frontmatter.type).toBe("Future Type");
  });

  it("normalizes verified mappings and derives trust tiers", () => {
    const mapping = parseOkf("---\ntype: Concept\nverified: { by: process:nightly, at: now }\n---\n");
    expect(mapping.normalized.verified).toHaveLength(1);
    expect(getTrustTier(mapping)).toBe("machine-confirmed");
    expect(getTrustTier({ type: "Concept", verified: [{ by: "human:alex" }] })).toBe(
      "human-reviewed",
    );
    expect(getTrustTier({ type: "Concept" })).toBe("unverified");
  });

  it("uses stale_after as an inclusive date boundary", () => {
    expect(isStale("2026-08-18", "2026-08-17")).toBe(false);
    expect(isStale("2026-08-18", "2026-08-18")).toBe(true);
    expect(isStale(undefined, "2026-08-18")).toBe(false);
  });

  it("rejects malformed YAML, non-mappings, and missing or empty type", () => {
    expect(validateOkf("---\ntype: [broken\n---\n").valid).toBe(false);
    expect(validateOkf("---\n- type\n- Concept\n---\n").valid).toBe(false);
    expect(validateOkf("---\ntitle: Missing\n---\n").errors[0]).toContain("type");
    expect(validateOkf("---\ntype: '   '\n---\n").valid).toBe(false);
  });

  it("does not enable custom YAML tags", () => {
    const parsed = parseOkf("---\ntype: Concept\nx: !custom value\n---\n");
    expect(parsed.frontmatter.x).toBe("value");
    expect(serializeOkf(parsed)).not.toContain("!custom");
  });

  it("validates reserved index and log entry points", () => {
    expect(
      validateOkf('---\nokf_version: "0.2"\n---\n# Bundle', {
        filename: "index.md",
        bundleRoot: true,
      }).valid,
    ).toBe(true);
    expect(
      validateOkf("---\nokf_version: '0.2'\n---\n# Nested", { filename: "index.md" }).valid,
    ).toBe(false);
    expect(validateOkf("# Log\n\n## 2026-08-18\n* **Update**: Done", { filename: "log.md" })).toMatchObject({
      valid: true,
      warnings: [],
    });
    expect(validateOkf("# Log\n\n## tomorrow\n* Update", { filename: "log.md" }).warnings).toHaveLength(1);
  });

  it("warns instead of rejecting soft guidance violations", () => {
    const result = validateOkf(`---
type: Attested Computation
status: experimental
generated: { by: unknown-actor }
---
# Computation`);
    expect(result.valid).toBe(true);
    expect(result.warnings.join(" ")).toContain("runtime");
    expect(result.warnings.join(" ")).toContain("status");
    expect(result.warnings.join(" ")).toContain("actor");
  });
});
