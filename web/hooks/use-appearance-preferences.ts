import { useCallback, useEffect, useState } from "react";
import { useLocalStorage } from "usehooks-ts";
import i18n from "../lib/i18n";
import {
  deserializeLocalePreference,
  deserializeThemePreference,
  LOCALE_STORAGE_KEY,
  normalizeLocale,
  resolveTheme,
  THEME_STORAGE_KEY,
  type Locale,
  type Theme,
} from "../lib/preferences";

export function useAppearancePreferences() {
  const initialLocale = normalizeLocale(i18n.language) ?? "zh-CN";
  const [storedTheme, setStoredTheme] = useLocalStorage<Theme>(THEME_STORAGE_KEY, "system", {
    deserializer: deserializeThemePreference,
  });
  const [storedLocale, setStoredLocale] = useLocalStorage<Locale>(LOCALE_STORAGE_KEY, initialLocale, {
    deserializer: (value) => deserializeLocalePreference(value, initialLocale),
  });
  const [theme, setThemeState] = useState(storedTheme);
  const [locale, setLocaleState] = useState(storedLocale);

  const setTheme = useCallback((value: Theme) => {
    setThemeState(value);
    setStoredTheme(value);
  }, [setStoredTheme]);
  const setLocale = useCallback((value: Locale) => {
    setLocaleState(value);
    setStoredLocale(value);
  }, [setStoredLocale]);

  useEffect(() => setThemeState(storedTheme), [storedTheme]);
  useEffect(() => setLocaleState(storedLocale), [storedLocale]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const value = resolveTheme(theme, media.matches);
      document.documentElement.classList.toggle("dark", value === "dark");
      document.documentElement.style.colorScheme = value;
      document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute("content", value === "dark" ? "#171717" : "#fafafa");
    };

    apply();
    if (theme !== "system") return;
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);

  useEffect(() => {
    void i18n.changeLanguage(locale);
    const t = i18n.getFixedT(locale);
    document.documentElement.lang = locale;
    document.title = t("metadata.title");
    document.querySelector<HTMLMetaElement>('meta[name="description"]')?.setAttribute("content", t("metadata.description"));
  }, [locale]);

  return { theme, setTheme, locale, setLocale };
}
