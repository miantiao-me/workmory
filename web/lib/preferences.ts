export const locales = ["zh-CN", "en"] as const;
export type Locale = (typeof locales)[number];

export const themes = ["light", "dark", "system"] as const;
export type Theme = (typeof themes)[number];
export type ResolvedTheme = Exclude<Theme, "system">;

export const LOCALE_STORAGE_KEY = "workmory.locale";
export const THEME_STORAGE_KEY = "workmory.theme";

function decodeStoredValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    const decoded: unknown = JSON.parse(value);
    return typeof decoded === "string" ? decoded : value;
  } catch {
    return value;
  }
}

export function normalizeLocale(value: unknown): Locale | undefined {
  const decoded = decodeStoredValue(value);
  return locales.find((locale) => locale === decoded);
}

export function localeFromBrowser(language: string): Locale {
  return /^zh(?:-|$)/i.test(language) ? "zh-CN" : "en";
}

export function detectLocale(storedValue: unknown, browserLanguage?: string | null): Locale {
  return normalizeLocale(storedValue)
    ?? (browserLanguage ? localeFromBrowser(browserLanguage) : "zh-CN");
}

export function normalizeTheme(value: unknown): Theme {
  const decoded = decodeStoredValue(value);
  return themes.find((theme) => theme === decoded) ?? "system";
}

export function deserializeLocalePreference(value: string, fallback: Locale): Locale {
  return normalizeLocale(value) ?? fallback;
}

export function deserializeThemePreference(value: string): Theme {
  return normalizeTheme(value);
}

export function resolveTheme(theme: Theme, prefersDark: boolean): ResolvedTheme {
  return theme === "system" ? (prefersDark ? "dark" : "light") : theme;
}
