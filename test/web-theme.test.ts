import { describe, expect, it } from "vitest";
import { deserializeThemePreference, normalizeTheme, resolveTheme } from "../web/lib/preferences";

describe("web theme preferences", () => {
  it("accepts every supported theme", () => {
    expect(normalizeTheme("light")).toBe("light");
    expect(normalizeTheme('"dark"')).toBe("dark");
    expect(normalizeTheme("system")).toBe("system");
  });

  it("normalizes invalid values to system", () => {
    expect(normalizeTheme("sepia")).toBe("system");
    expect(normalizeTheme(null)).toBe("system");
  });

  it("deserializes persisted themes", () => {
    expect(deserializeThemePreference("dark")).toBe("dark");
    expect(deserializeThemePreference('"light"')).toBe("light");
    expect(deserializeThemePreference('"sepia"')).toBe("system");
  });

  it("resolves system against the color preference", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
  });
});
