import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { en } from "../locales/en";
import { zhCN } from "../locales/zh-CN";
import { detectLocale, LOCALE_STORAGE_KEY, type Locale } from "./preferences";

export const defaultNS = "translation";
export const resources = {
  "zh-CN": { translation: zhCN },
  en: { translation: en },
} as const;

function initialLocale(): Locale {
  if (typeof window === "undefined") return "zh-CN";
  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
  } catch {
    // Browser preference remains available when storage is unavailable.
  }
  return detectLocale(stored, window.navigator.language);
}

void i18n.use(initReactI18next).init({
  resources,
  lng: initialLocale(),
  fallbackLng: "zh-CN",
  defaultNS,
  interpolation: { escapeValue: false },
  initAsync: false,
});

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: typeof defaultNS;
    resources: typeof resources["zh-CN"];
  }
}

export type { Locale } from "./preferences";
export default i18n;
