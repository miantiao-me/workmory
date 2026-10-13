import { useTranslation } from "react-i18next";

export function GraphLegend() {
  const { t } = useTranslation();
  return (
    <div aria-label={t("graph.legend.title")} className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-muted-foreground" />{t("graph.legend.resolved")}</span>
      <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-destructive" />? {t("graph.legend.broken")}</span>
      <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-5 bg-foreground" />{t("graph.legend.link")}</span>
      <span className="inline-flex items-center gap-1.5"><span className="h-px w-5 bg-muted-foreground" />{t("graph.legend.source")}</span>
    </div>
  );
}
