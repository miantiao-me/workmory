import { useMemo, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { AppHeader, AppHeaderContent } from "../../components/app/app-header";
import { ContextSelect, ErrorAlert } from "../../components/common";
import { Button } from "../../components/ui/button";
import {
  Card,
  CardFrame,
  CardFrameDescription,
  CardFrameFooter,
  CardFrameHeader,
  CardFrameTitle,
  CardPanel,
} from "../../components/ui/card";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "../../components/ui/field";
import { useApp } from "../../context/app-context";
import { stableIdentifier } from "../../lib/presentation";

export function DefaultsSettingsPage() {
  const { t } = useTranslation();
  const {
    defaultProject,
    setDefaultProject,
    defaultNamespace,
    setDefaultNamespace,
    projectDirectory,
    projectDirectoryLoading,
    projectDirectoryError,
    refreshProjectDirectory,
  } = useApp();
  const [projectDraft, setProjectDraft] = useState(defaultProject);
  const [namespaceDraft, setNamespaceDraft] = useState(defaultNamespace);
  const [projectInvalid, setProjectInvalid] = useState(false);
  const [namespaceInvalid, setNamespaceInvalid] = useState(false);
  const projectOptions = useMemo(
    () => projectDirectory.map((entry) => entry.project),
    [projectDirectory],
  );
  const namespaceOptions = useMemo(
    () => projectDirectory.find((entry) => entry.project === projectDraft)?.namespaces ?? [],
    [projectDirectory, projectDraft],
  );

  function saveContext(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    let project: string;
    let namespace: string;
    try {
      project = stableIdentifier(
        projectDraft,
        t("common.fields.project"),
        128,
      );
    } catch {
      setProjectInvalid(true);
      return;
    }
    try {
      namespace = stableIdentifier(
        namespaceDraft,
        t("common.fields.namespace"),
        64,
      );
    } catch {
      setNamespaceInvalid(true);
      return;
    }

    setProjectDraft(project);
    setNamespaceDraft(namespace);
    setDefaultProject(project);
    setDefaultNamespace(namespace);
  }

  return (
    <>
      <AppHeader>
        <AppHeaderContent title={t("settings.tabs.defaults")} />
      </AppHeader>
      <section aria-label={t("settings.context.title")} className="flex flex-col gap-6">
        {projectDirectoryError && (
          <ErrorAlert
            message={projectDirectoryError}
            onRetry={() => void refreshProjectDirectory()}
          />
        )}
        <CardFrame render={<form onSubmit={saveContext} />}>
            <CardFrameHeader>
              <CardFrameTitle>{t("settings.context.title")}</CardFrameTitle>
              <CardFrameDescription>
                {t("settings.context.description")}
              </CardFrameDescription>
            </CardFrameHeader>
            <Card className="rounded-b-none!">
              <CardPanel>
                <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <Field invalid={projectInvalid}>
              <FieldLabel htmlFor="settings-project">
                {t("settings.context.defaultProject")}
              </FieldLabel>
              <ContextSelect
                ariaDescribedBy={projectInvalid ? "settings-project-error" : "settings-project-hint"}
                ariaInvalid={projectInvalid}
                disabled={projectDirectoryLoading}
                id="settings-project"
                kind="project"
                onValueChange={(next) => {
                  setProjectInvalid(false);
                  setProjectDraft(next);
                }}
                options={projectOptions}
                value={projectDraft}
              />
              <FieldDescription id="settings-project-hint">
                {t("settings.context.identifierHint")}
              </FieldDescription>
              {projectInvalid && (
                <FieldError id="settings-project-error" match role="alert">
                  {t("validation.identifier", {
                    label: t("common.fields.project"),
                    max: "128",
                  })}
                </FieldError>
              )}
            </Field>
            <Field invalid={namespaceInvalid}>
              <FieldLabel htmlFor="settings-namespace">
                {t("settings.context.defaultNamespace")}
              </FieldLabel>
              <ContextSelect
                ariaDescribedBy={namespaceInvalid ? "settings-namespace-error" : "settings-namespace-hint"}
                ariaInvalid={namespaceInvalid}
                disabled={projectDirectoryLoading}
                id="settings-namespace"
                kind="namespace"
                onValueChange={(next) => {
                  setNamespaceInvalid(false);
                  setNamespaceDraft(next);
                }}
                options={namespaceOptions}
                value={namespaceDraft}
              />
              <FieldDescription id="settings-namespace-hint">
                {t("settings.context.identifierHint")}
              </FieldDescription>
              {namespaceInvalid && (
                <FieldError id="settings-namespace-error" match role="alert">
                  {t("validation.identifier", {
                    label: t("common.fields.namespace"),
                    max: "64",
                  })}
                </FieldError>
              )}
            </Field>
                </div>
              </CardPanel>
            </Card>
            <CardFrameFooter className="flex justify-end">
              <Button
                disabled={
                  projectDraft === defaultProject &&
                  namespaceDraft === defaultNamespace
                }
                type="submit"
              >
                {t("settings.context.save")}
              </Button>
            </CardFrameFooter>
          </CardFrame>
      </section>
    </>
  );
}
