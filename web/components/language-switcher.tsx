import { useTranslation } from "react-i18next";
import { useApp } from "../context/app-context";
import { segmentedControlItemVariants, segmentedControlRootClassName } from "../lib/segmented-control";
import { cn } from "../lib/utils";

export function LanguageSwitcher({ size = "compact", className }: { size?: "compact" | "default"; className?: string }) {
  const { t } = useTranslation();
  const { locale, setLocale } = useApp();
  const controlSize = size === "default" ? "default" : "sm";
  const buttonClassName = size === "default" ? "min-w-14" : "min-w-11";

  return (
    <div aria-label={t("common.language.label")} className={cn(segmentedControlRootClassName, "shrink-0", className)} role="group">
      <button
        aria-label={t("common.language.zhLabel")}
        aria-pressed={locale === "zh-CN"}
        className={cn(segmentedControlItemVariants({ size: controlSize, state: "pressed" }), buttonClassName)}
        data-pressed={locale === "zh-CN" ? "" : undefined}
        onClick={() => setLocale("zh-CN")}
        type="button"
      >
        {t("common.language.zhShort")}
      </button>
      <button
        aria-label={t("common.language.enLabel")}
        aria-pressed={locale === "en"}
        className={cn(segmentedControlItemVariants({ size: controlSize, state: "pressed" }), buttonClassName)}
        data-pressed={locale === "en" ? "" : undefined}
        onClick={() => setLocale("en")}
        type="button"
      >
        {t("common.language.enShort")}
      </button>
    </div>
  );
}
