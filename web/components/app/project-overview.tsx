"use client";

import { useTranslation } from "react-i18next";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useApp } from "@/context/app-context";

export function ProjectOverview(): React.ReactElement {
  const { t } = useTranslation();
  const {
    projectDirectory,
    projectDirectoryLoading,
    projectDirectoryError,
    refreshProjectDirectory,
    defaultProject,
    setDefaultProject,
    setDefaultNamespace,
  } = useApp();

  return (
    <div className="flex flex-col gap-1 px-2 py-1">
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground text-xs">{t("shell.projectOverview.title")}</span>
        <Button
          aria-label={t("shell.projectOverview.refresh")}
          className="size-6"
          loading={projectDirectoryLoading}
          onClick={() => void refreshProjectDirectory()}
          size="icon-xs"
          title={t("shell.projectOverview.refresh")}
          variant="ghost"
        >
          <RefreshCw aria-hidden="true" className="size-3.5" />
        </Button>
      </div>

      {projectDirectoryLoading && projectDirectory.length === 0 ? (
        <Skeleton className="h-7 w-full" />
      ) : projectDirectoryError ? (
        <p className="truncate text-destructive-foreground text-xs" role="alert">
          {t("shell.projectOverview.error")}
        </p>
      ) : (
        <Select
          disabled={projectDirectory.length === 0}
          onValueChange={(value) => {
            if (!value) return;
            setDefaultProject(value);
            setDefaultNamespace("default");
          }}
          value={projectDirectory.length === 0 ? "" : defaultProject}
        >
          <SelectTrigger
            aria-label={t("shell.projectOverview.listLabel")}
            className="h-7 w-full min-w-0 border-0 bg-transparent px-2 text-xs shadow-none hover:bg-muted focus-visible:ring-1"
            size="sm"
          >
            <SelectValue>
              {() => (projectDirectory.length === 0 ? t("shell.projectOverview.empty") : defaultProject)}
            </SelectValue>
          </SelectTrigger>
          <SelectPopup>
            {projectDirectory.map((entry) => (
              <SelectItem key={entry.project} value={entry.project}>
                {entry.project}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      )}
    </div>
  );
}
