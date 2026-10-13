import { RouteIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { EmptyState } from "../components/common";
import { Button } from "../components/ui/button";

export function NotFoundPage() {
  const { t } = useTranslation();

  return (
    <EmptyState
      action={
        <div className="flex gap-2">
          <Button render={<Link to="/" />} size="sm">
            {t("notFound.back")}
          </Button>
        </div>
      }
      description={t("notFound.description")}
      icon={<RouteIcon aria-hidden="true" />}
      title={t("notFound.title")}
    />
  );
}
