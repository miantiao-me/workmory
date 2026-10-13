import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { RefreshCw, Shield, Trash2 } from "lucide-react";
import type { ProfileGetResult } from "../../server/profile/profile-service";
import { AppHeader, AppHeaderActions, AppHeaderContent, AppHeaderDescription } from "../components/app/app-header";
import { ContextSelect, EmptyState, ErrorAlert } from "../components/common";
import { ConfirmDialog } from "@/components/dialogs";
import { ProfilePatchForm } from "@/components/forms";
import { ListItem, ListItemActions, ListItemContent, ListItemDescription, ListItemHeader, ListItemTitle } from "../components/list-item";
import { Button } from "../components/ui/button";
import { Card, CardFrame, CardFrameDescription, CardFrameHeader, CardFrameTitle, CardPanel } from "../components/ui/card";
import { Field, FieldDescription, FieldError, FieldLabel } from "../components/ui/field";
import { Skeleton } from "../components/ui/skeleton";
import { useApp } from "../context/app-context";
import { errorMessage, makeOperationId, RequestGeneration, stableIdentifier } from "../lib/presentation";
import { segmentedControlItemVariants, segmentedControlRootClassName } from "../lib/segmented-control";
import { EffectiveFields, ProfileState, RawProfile, ToggleField } from "./profile/profile-view";

export function ProfilePage() {
  const { t } = useTranslation();
  const { api, defaultProject, handleApiError, notify, projectDirectory, projectDirectoryLoading, projectDirectoryError, refreshProjectDirectory } = useApp();
  const [scope, setScope] = useState<"global" | "project">("global");
  const [project, setProject] = useState(defaultProject);
  const [projectError, setProjectError] = useState("");
  const [includeSensitive, setIncludeSensitive] = useState(false);
  const [includeRaw, setIncludeRaw] = useState(false);
  const [profile, setProfile] = useState<ProfileGetResult>();
  const [readState, setReadState] = useState<"loading" | "error" | "success">("loading");
  const loading = readState === "loading";
  const [mutationPending, setMutationPending] = useState(false);
  const [error, setError] = useState("");
  const profileRequests = useRef(new RequestGeneration());
  const previousDefaultProject = useRef(defaultProject);

  const requestProject = scope === "project" ? project.trim() : undefined;
  const targetRevision = scope === "project" ? profile?.projectRevision : profile?.globalRevision;
  const profileExists = targetRevision !== undefined;

  const prepareContextChange = useCallback(() => {
    profileRequests.current.invalidate();
    setProfile(undefined);
    setError("");
    setReadState("loading");
  }, []);

  const load = useCallback(async () => {
    const token = profileRequests.current.issue();
    setProfile(undefined);
    setReadState("loading");
    setError("");
    try {
      const validatedProject = scope === "project" ? stableIdentifier(project, t("common.fields.project"), 128) : undefined;
      const result = await api.profileGet({ ...(validatedProject ? { project: validatedProject } : {}), include_sensitive: includeSensitive, include_raw: includeRaw });
      if (!profileRequests.current.isCurrent(token)) return;
      setProfile(result.profile);
      setReadState("success");
    } catch (cause) {
      if (!profileRequests.current.isCurrent(token)) return;
      handleApiError(cause);
      setReadState("error");
      setError(errorMessage(cause));
    }
  }, [api, handleApiError, includeRaw, includeSensitive, project, scope, t]);

  useEffect(() => {
    void load();
    return () => profileRequests.current.invalidate();
  }, [load]);

  useEffect(() => {
    if (previousDefaultProject.current === defaultProject) return;
    previousDefaultProject.current = defaultProject;
    if (scope === "project") prepareContextChange();
    setProject(defaultProject);
    setProjectError("");
  }, [defaultProject, prepareContextChange, scope]);

  async function removeProfile() {
    if (!profileExists || loading || mutationPending) return;
    setMutationPending(true);
    try {
      await api.profileDelete({ ...(requestProject ? { project: requestProject } : {}), ...(targetRevision !== undefined ? { expected_revision: targetRevision } : {}), operation_id: makeOperationId("profile-delete") });
      notify(t("profile.deleted"));
      await load();
    } catch (cause) {
      handleApiError(cause);
      setError(errorMessage(cause));
    } finally {
      setMutationPending(false);
    }
  }

  // 项目切换即时生效，与 memories/graph 页一致
  function selectProject(rawValue: string) {
    setProjectError("");
    try {
      const nextProject = stableIdentifier(rawValue, t("common.fields.project"), 128);
      if (nextProject === project) return;
      prepareContextChange();
      setProject(nextProject);
    } catch (cause) {
      setProjectError(errorMessage(cause));
    }
  }

  const projectOptions = projectDirectory.map((entry) => entry.project);

  return (
    <>
      <AppHeader>
        <AppHeaderContent title={t("profile.title")}>
          <AppHeaderDescription>{t("profile.description")}</AppHeaderDescription>
        </AppHeaderContent>
        <AppHeaderActions>
          <Button disabled={mutationPending} loading={loading} onClick={() => void load()} variant="outline"><RefreshCw aria-hidden="true" />{t("profile.refresh")}</Button>
        </AppHeaderActions>
      </AppHeader>

      <div className="flex min-w-0 flex-col gap-4">
        <CardFrame>
          <CardFrameHeader>
            <CardFrameTitle>{t("profile.contextTitle")}</CardFrameTitle>
            <CardFrameDescription>{t("profile.contextDescription")}</CardFrameDescription>
          </CardFrameHeader>
          <Card>
            <CardPanel className="p-0">
              {projectDirectoryError && (
                <div className="px-4 pt-4 sm:px-6">
                  <ErrorAlert message={projectDirectoryError} onRetry={() => void refreshProjectDirectory()} />
                </div>
              )}
              <div className="grid min-w-0 gap-5 px-4 py-4 sm:px-6 md:grid-cols-2 md:items-start">
                <div className="flex min-w-0 flex-col items-start gap-2">
                  <p className="font-medium text-sm text-foreground">{t("profile.scope")}</p>
                  <div aria-label={t("profile.scopeAria")} className={segmentedControlRootClassName} role="group">
                    <button
                      aria-pressed={scope === "global"}
                      className={segmentedControlItemVariants({ state: "pressed" })}
                      data-pressed={scope === "global" ? "" : undefined}
                      disabled={mutationPending}
                      onClick={() => {
                        if (scope !== "global") {
                          prepareContextChange();
                          setScope("global");
                        }
                      }}
                      type="button"
                    >
                      {t("profile.global")}
                    </button>
                    <button
                      aria-pressed={scope === "project"}
                      className={segmentedControlItemVariants({ state: "pressed" })}
                      data-pressed={scope === "project" ? "" : undefined}
                      disabled={mutationPending}
                      onClick={() => {
                        if (scope !== "project") {
                          prepareContextChange();
                          setScope("project");
                        }
                      }}
                      type="button"
                    >
                      {t("common.fields.project")}
                    </button>
                  </div>
                </div>
                <Field invalid={Boolean(projectError)}>
                  <FieldLabel htmlFor="profile-project">{t("common.fields.project")}</FieldLabel>
                  <ContextSelect
                    ariaDescribedBy={projectError ? "profile-project-error" : "profile-project-hint"}
                    ariaInvalid={Boolean(projectError)}
                    disabled={scope === "global" || mutationPending || projectDirectoryLoading}
                    id="profile-project"
                    kind="project"
                    onValueChange={selectProject}
                    options={projectOptions}
                    value={project}
                  />
                  <FieldDescription id="profile-project-hint">{t("profile.projectHint")}</FieldDescription>
                  {projectError && <FieldError id="profile-project-error" match role="alert">{projectError}</FieldError>}
                </Field>
                <div className="flex min-w-0 items-start gap-2 text-xs leading-5 text-muted-foreground md:col-span-2" role="note">
                  <Shield aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                  <p><span className="font-medium text-foreground">{t("profile.warningTitle")}</span> {t("profile.warningDescription")}</p>
                </div>
              </div>
              <div aria-labelledby="profile-privacy-heading" className="border-t">
                <div className="px-4 pb-2 pt-4 sm:px-6">
                  <h2 className="font-semibold text-sm text-foreground" id="profile-privacy-heading">{t("profile.privacyTitle")}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">{t("profile.privacyDescription")}</p>
                </div>
                <div>
                  <ToggleField checked={includeSensitive} description={t("profile.sensitiveDescription")} disabled={mutationPending} id="profile-sensitive" label={t("profile.sensitive")} onChange={(checked) => { prepareContextChange(); setIncludeSensitive(checked); if (!checked) setIncludeRaw(false); }} />
                  <ToggleField checked={includeRaw} description={t("profile.rawDescription")} disabled={mutationPending} id="profile-raw" label={t("profile.raw")} onChange={(checked) => { prepareContextChange(); setIncludeRaw(checked); if (checked) setIncludeSensitive(true); }} />
                </div>
              </div>
            </CardPanel>
          </Card>
        </CardFrame>

        {error && <ErrorAlert message={error} onRetry={() => void load()} />}
        {loading ? <ProfileSkeleton /> : readState === "error" ? null : profile ? (
          <>
            <EffectiveFields profile={profile} />
            {includeRaw && <RawProfile profile={profile} />}
            <ProfilePatchForm disabled={loading || mutationPending} onPendingChange={setMutationPending} onSaved={async () => { notify(t("profile.patched")); await load(); }} project={requestProject} revision={targetRevision} state={<ProfileState profile={profile} />} />
          </>
        ) : (
          <>
            <CardFrame className="min-h-72"><EmptyState description={t("profile.emptyDescription")} title={t("profile.emptyTitle")} /></CardFrame>
            <ProfilePatchForm disabled={loading || mutationPending || readState !== "success"} onPendingChange={setMutationPending} onSaved={async () => { notify(t("profile.patched")); await load(); }} project={requestProject} revision={targetRevision} />
          </>
        )}

        {profileExists && (
          <CardFrame>
            <Card>
              <CardPanel className="p-0">
                <ListItem className="*:max-sm:flex-col *:max-sm:items-stretch">
                  <ListItemContent>
                    <ListItemHeader>
                      <ListItemTitle>{t("profile.deleteTitle")}</ListItemTitle>
                      <ListItemDescription>{scope === "global" ? t("profile.deleteGlobalDescription") : t("profile.deleteProjectDescription", { project })}</ListItemDescription>
                    </ListItemHeader>
                  </ListItemContent>
                  <ListItemActions className="max-sm:w-full max-sm:justify-end">
                    <ConfirmDialog confirmLabel={t("profile.deleteConfirm")} description={scope === "global" ? t("profile.deleteGlobalDescription") : t("profile.deleteProjectDescription", { project })} destructive onConfirm={() => void removeProfile()} title={t("profile.deleteTitle")} trigger={<Button className="max-sm:w-full" disabled={loading || mutationPending} loading={mutationPending} variant="destructive-outline"><Trash2 aria-hidden="true" />{t("profile.delete")}</Button>} />
                  </ListItemActions>
                </ListItem>
              </CardPanel>
            </Card>
          </CardFrame>
        )}
      </div>
    </>
  );
}

function ProfileSkeleton() {
  const { t } = useTranslation();
  return (
    <div aria-busy="true" aria-live="polite" role="status">
      <span className="sr-only">{t("common.loading")}</span>
      <div aria-hidden="true" className="flex min-w-0 flex-col gap-4">
        {[0, 1].map((index) => (
          <CardFrame key={index}>
            <Card>
              <CardPanel className="grid gap-5">
                <Skeleton className="h-6 w-48" />
                <div className="grid gap-4 lg:grid-cols-2">
                  <Skeleton className="h-20 w-full" />
                  <Skeleton className="h-20 w-full" />
                </div>
                <Skeleton className="h-36 w-full" />
              </CardPanel>
            </Card>
          </CardFrame>
        ))}
      </div>
    </div>
  );
}
