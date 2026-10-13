import { useState } from "react";
import { FileSearch, Paperclip, UploadCloud } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AppHeader, AppHeaderContent, AppHeaderDescription } from "../components/app/app-header";
import { ErrorAlert } from "../components/common";
import { AttachmentDetailDialog } from "@/components/dialogs";
import { AttachmentUploadForm } from "@/components/forms";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert";
import { CardFrame, CardFrameDescription, CardFrameHeader, CardFrameTitle } from "../components/ui/card";
import { Separator } from "../components/ui/separator";
import { Tabs, TabsList, TabsPanel, TabsTab } from "../components/ui/tabs";
import { useApp } from "../context/app-context";
import { useCopyWithNotice } from "../hooks/use-copy-with-notice";
import { makeOperationId } from "../lib/presentation";
import { AttachmentLookupForm } from "./attachments/attachment-lookup-form";
import { RecentAttachmentList } from "./attachments/recent-attachment-list";
import { useAttachmentScope } from "./attachments/use-attachment-scope";

export function AttachmentsPage() {
  const { t } = useTranslation();
  const { projectDirectory, projectDirectoryLoading, projectDirectoryError, refreshProjectDirectory } = useApp();
  const [file, setFile] = useState<File>();
  const [idempotencyKey, setIdempotencyKey] = useState(() => makeOperationId("attachment-upload"));
  const copyWithNotice = useCopyWithNotice();
  const {
    project,
    setProject,
    items,
    selected,
    detailOpen,
    setDetailDialogOpen,
    attachmentId,
    setAttachmentId,
    pending,
    busy,
    error,
    upload,
    query,
    download,
    remove,
    selectItem,
  } = useAttachmentScope();
  const projectOptions = projectDirectory.map((entry) => entry.project);

  return (
    <>
      <AppHeader>
        <AppHeaderContent title={t("attachments.title")}>
          <AppHeaderDescription>{t("attachments.description")}</AppHeaderDescription>
        </AppHeaderContent>
      </AppHeader>

      <div className="flex flex-col gap-4">
        <Alert className="shrink-0" variant="info">
          <Paperclip aria-hidden="true" />
          <AlertTitle>{t("attachments.noticeTitle")}</AlertTitle>
          <AlertDescription>{t("attachments.noticeDescription")}</AlertDescription>
        </Alert>

        {error && !detailOpen && <ErrorAlert className="shrink-0" message={error} />}

        {projectDirectoryError && (
          <ErrorAlert className="shrink-0" message={projectDirectoryError} onRetry={() => void refreshProjectDirectory()} />
        )}

        <CardFrame aria-busy={busy} className="shrink-0">
          <Tabs className="gap-0" defaultValue="upload">
            <div className="flex items-center px-4 py-3 sm:px-6 sm:py-4">
              <TabsList aria-label={t("attachments.title")} size="sm">
                <TabsTab value="upload"><UploadCloud aria-hidden="true" />{t("attachments.uploadTitle")}</TabsTab>
                <TabsTab value="retrieve"><FileSearch aria-hidden="true" />{t("attachments.queryTitle")}</TabsTab>
              </TabsList>
            </div>
            <Separator />

            <TabsPanel value="upload">
              <AttachmentUploadForm
                busy={busy}
                fileName={file?.name}
                idempotencyKey={idempotencyKey}
                onCopyKey={() => copyWithNotice(idempotencyKey, t("attachments.notifications.keyCopied"))}
                onFileChange={(value) => { setFile(value); setIdempotencyKey(makeOperationId("attachment-upload")); }}
                onIdempotencyKeyChange={setIdempotencyKey}
                onProjectChange={setProject}
                onSubmit={(event) => void upload(event, file, idempotencyKey)}
                pending={pending === "upload"}
                project={project}
                projectDirectoryLoading={projectDirectoryLoading}
                projectOptions={projectOptions}
              />
            </TabsPanel>

            <TabsPanel value="retrieve">
              <AttachmentLookupForm
                attachmentId={attachmentId}
                busy={busy}
                onAttachmentIdChange={setAttachmentId}
                onProjectChange={setProject}
                onSubmit={(event) => void query(event)}
                pending={pending === "query"}
                project={project}
                projectOptions={projectOptions}
              />
            </TabsPanel>
          </Tabs>
        </CardFrame>

        <CardFrame aria-labelledby="attachment-recent-title" className="shrink-0">
          <CardFrameHeader>
            <CardFrameTitle id="attachment-recent-title">{t("attachments.recent")}</CardFrameTitle>
            <CardFrameDescription>{t("attachments.recentDescription")}</CardFrameDescription>
          </CardFrameHeader>
          <RecentAttachmentList busy={busy} items={items} onSelect={selectItem} />
        </CardFrame>
      </div>

      <AttachmentDetailDialog
        error={error}
        item={selected}
        onCopy={(value) => copyWithNotice(value, t("attachments.notifications.idCopied"))}
        onDelete={() => void remove()}
        onDownload={(kind) => void download(kind)}
        onOpenChange={setDetailDialogOpen}
        open={detailOpen}
        pending={pending}
      />
    </>
  );
}
