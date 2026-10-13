import { Monitor, Moon, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AppHeader, AppHeaderContent, AppHeaderDescription } from "../../components/app/app-header";
import { LanguageSwitcher } from "../../components/language-switcher";
import {
  Card,
  CardFrame,
  CardFrameDescription,
  CardFrameHeader,
  CardFrameTitle,
  CardPanel,
} from "../../components/ui/card";
import { Field, FieldLabel } from "../../components/ui/field";
import { useApp } from "../../context/app-context";
import {
  segmentedControlItemVariants,
  segmentedControlRootClassName,
} from "../../lib/segmented-control";
import { cn } from "../../lib/utils";

const themeOptions = [
  {
    icon: Sun,
    labelKey: "settings.appearance.light" as const,
    value: "light" as const,
  },
  {
    icon: Moon,
    labelKey: "settings.appearance.dark" as const,
    value: "dark" as const,
  },
  {
    icon: Monitor,
    labelKey: "settings.appearance.system" as const,
    value: "system" as const,
  },
];

export function AppearanceSettingsPage() {
  const { t } = useTranslation();
  const { theme, setTheme } = useApp();

  return (
    <>
      <AppHeader>
        <AppHeaderContent title={t("settings.tabs.appearance")} />
      </AppHeader>
      <section aria-label={t("settings.appearance.title")}>
        <CardFrame>
          <CardFrameHeader>
            <CardFrameTitle>{t("settings.appearance.title")}</CardFrameTitle>
            <CardFrameDescription>
              {t("settings.appearance.description")}
            </CardFrameDescription>
          </CardFrameHeader>
          <Card>
            <CardPanel>
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                <Field>
                  <FieldLabel>{t("settings.appearance.language")}</FieldLabel>
                  <LanguageSwitcher
                    className="w-full [&>button]:min-w-0 [&>button]:flex-1"
                    size="default"
                  />
                </Field>
                <Field>
                  <FieldLabel>{t("settings.appearance.theme")}</FieldLabel>
                  <div
                    aria-label={t("settings.appearance.theme")}
                    className={cn(segmentedControlRootClassName, "w-full")}
                    role="group"
                  >
                    {themeOptions.map(({ value, labelKey, icon: Icon }) => (
                      <button
                        aria-pressed={theme === value}
                        className={cn(
                          segmentedControlItemVariants({ state: "pressed" }),
                          "min-w-0 flex-1",
                        )}
                        data-pressed={theme === value ? "" : undefined}
                        key={value}
                        onClick={() => setTheme(value)}
                        type="button"
                      >
                        <Icon aria-hidden="true" />
                        {t(labelKey)}
                      </button>
                    ))}
                  </div>
                </Field>
              </div>
            </CardPanel>
          </Card>
        </CardFrame>
      </section>
    </>
  );
}
