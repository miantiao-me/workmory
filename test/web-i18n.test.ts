import { describe, expect, it } from "vitest";
import i18n, { resources } from "../web/lib/i18n";
import { deserializeLocalePreference, detectLocale, localeFromBrowser, normalizeLocale } from "../web/lib/preferences";

function keys(value: object, prefix = ""): string[] {
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof child === "object" && child !== null ? keys(child, path) : path;
  }).sort();
}

describe("web locale preferences", () => {
  it("prefers a valid stored locale", () => {
    expect(detectLocale("en", "zh-CN")).toBe("en");
    expect(detectLocale('"zh-CN"', "en-US")).toBe("zh-CN");
  });

  it("deserializes legacy and JSON persisted locales", () => {
    expect(deserializeLocalePreference("en", "zh-CN")).toBe("en");
    expect(deserializeLocalePreference('"zh-CN"', "en")).toBe("zh-CN");
    expect(deserializeLocalePreference("fr", "en")).toBe("en");
  });

  it("ignores invalid stored locales and detects browser language", () => {
    expect(normalizeLocale("fr")).toBeUndefined();
    expect(detectLocale("fr", "zh-TW")).toBe("zh-CN");
    expect(detectLocale("fr", "en-US")).toBe("en");
    expect(detectLocale("fr")).toBe("zh-CN");
    expect(localeFromBrowser("zh")).toBe("zh-CN");
  });

  it("keeps translation key sets aligned", () => {
    expect(keys(resources.en.translation)).toEqual(keys(resources["zh-CN"].translation));
  });

  it("selects singular and plural English copy", () => {
    const t = i18n.getFixedT("en");
    expect(t("profile.fieldCount", { count: 1 })).toBe("1 effective field");
    expect(t("profile.fieldCount", { count: 2 })).toBe("2 effective fields");
    expect(t("maintenance.reindexDescription", { count: 1 })).toContain("1 candidate memory");
    expect(t("maintenance.reindexDescription", { count: 2 })).toContain("2 candidate memories");
  });
});
