import { Eye, FileJson } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ProfileGetResult } from "../../../server/profile/profile-service";
import type { EffectiveProfileField } from "../../../server/profile/types";
import { EmptyState } from "../../components/common";
import { ListItem, ListItemActions, ListItemContent, ListItemDescription, ListItemHeader, ListItemTitle } from "../../components/list-item";
import { Alert, AlertDescription, AlertTitle } from "../../components/ui/alert";
import { Badge } from "../../components/ui/badge";
import { Card, CardFrame, CardFrameDescription, CardFrameHeader, CardFrameTitle, CardPanel } from "../../components/ui/card";
import { Label } from "../../components/ui/label";
import { ScrollArea } from "../../components/ui/scroll-area";
import { Switch } from "../../components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";
import { cn } from "../../lib/utils";

export function ToggleField({ checked, onChange, id, label, description, disabled = false }: {
  checked: boolean;
  onChange: (value: boolean) => void;
  id: string;
  label: string;
  description: string;
  disabled?: boolean;
}) {
  const descriptionId = `${id}-description`;
  return (
    <ListItem>
      <ListItemContent>
        <ListItemHeader>
          <ListItemTitle><Label htmlFor={id}>{label}</Label></ListItemTitle>
          <ListItemDescription id={descriptionId}>{description}</ListItemDescription>
        </ListItemHeader>
      </ListItemContent>
      <ListItemActions>
        <Switch aria-describedby={descriptionId} aria-label={label} checked={checked} className="shrink-0" disabled={disabled} id={id} onCheckedChange={onChange} />
      </ListItemActions>
    </ListItem>
  );
}

export function EffectiveFields({ profile }: { profile: ProfileGetResult }) {
  const { t } = useTranslation();
  const sections = Object.entries(profile.effective).filter(([, fields]) => Object.keys(fields).length > 0);
  if (!sections.length) {
    return (
      <CardFrame className="min-h-72">
        <EmptyState description={t("profile.effectiveEmptyDescription")} icon={<Eye aria-hidden="true" />} title={t("profile.effectiveEmptyTitle")} />
      </CardFrame>
    );
  }
  return (
    <div className="grid min-w-0 gap-4">
      {sections.map(([section, fields]) => (
        <CardFrame className="min-w-0 overflow-hidden" key={section}>
          <CardFrameHeader>
            <CardFrameTitle><span className="font-mono">{section}</span></CardFrameTitle>
            <CardFrameDescription>{t("profile.fieldCount", { count: Object.keys(fields).length })}</CardFrameDescription>
          </CardFrameHeader>
          <div className="min-w-0 px-4 pb-4 sm:px-6 sm:pb-6">
            <Table variant="card">
              <TableHeader>
                <TableRow>
                  <TableHead>{t("profile.fieldColumn")}</TableHead>
                  <TableHead>{t("profile.value")}</TableHead>
                  <TableHead>{t("profile.origin")}</TableHead>
                  <TableHead>{t("profile.sensitivity")}</TableHead>
                  <TableHead>{t("profile.provenance")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Object.entries(fields).map(([name, field]) => <FieldRow field={field} key={name} name={name} />)}
              </TableBody>
            </Table>
          </div>
        </CardFrame>
      ))}
    </div>
  );
}

function FieldRow({ name, field }: { name: string; field: EffectiveProfileField }) {
  const { t } = useTranslation();
  const hasValue = Object.prototype.hasOwnProperty.call(field, "value");
  const value = hasValue ? JSON.stringify(field.value, null, 2) : t("profile.masked");
  const sensitivityLabel = t(`profile.sensitivityLabels.${field.sensitivity}`, { defaultValue: field.sensitivity });
  const provenanceLabel = t(`profile.provenanceKinds.${field.provenance.kind}`, { defaultValue: field.provenance.kind });
  return (
    <TableRow>
      <TableCell className="whitespace-normal align-top"><code className="break-all font-mono text-xs font-medium leading-5">{name}</code></TableCell>
      <TableCell className="whitespace-normal align-top"><pre className="whitespace-pre-wrap break-words font-mono text-xs leading-5 [overflow-wrap:anywhere]">{value}</pre></TableCell>
      <TableCell className="align-top"><Badge variant="outline">{field.origin === "global" ? t("profile.global") : t("common.fields.project")}</Badge></TableCell>
      <TableCell className="align-top"><Badge title={field.sensitivity} variant={field.sensitivity === "sensitive" ? "warning" : "secondary"}>{sensitivityLabel}</Badge></TableCell>
      <TableCell className="whitespace-normal align-top text-xs leading-5 text-muted-foreground">
        <p title={field.provenance.kind}>{provenanceLabel}</p>
        {field.confidence !== undefined && <p>{t("profile.confidence")}: {field.confidence}</p>}
        {field.stale_after && <p>{t("profile.staleAfter")}: {field.stale_after}</p>}
      </TableCell>
    </TableRow>
  );
}

export function ProfileState({ profile }: { profile: ProfileGetResult }) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardPanel>
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <StateItem label={t("profile.globalRevision")} mono value={profile.globalRevision ?? "—"} />
          <StateItem label={t("profile.projectRevision")} mono value={profile.projectRevision ?? "—"} />
          <StateItem className="sm:col-span-2" label={t("profile.staleTitle")} value={<PathList paths={profile.staleFields} />} />
          <StateItem className="sm:col-span-2" label={t("profile.maskedTitle")} value={<PathList paths={profile.maskedFields} />} />
        </dl>
      </CardPanel>
    </Card>
  );
}

function StateItem({ label, value, mono = false, className }: { label: string; value: React.ReactNode; mono?: boolean; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="font-medium text-sm text-foreground">{label}</dt>
      <dd className={cn("mt-2 break-words text-sm text-muted-foreground", mono && "font-mono text-xs")}>{value}</dd>
    </div>
  );
}

function PathList({ paths }: { paths: ProfileGetResult["staleFields"] }) {
  const { t } = useTranslation();
  if (!paths.length) return <span className="font-normal text-muted-foreground">{t("profile.none")}</span>;
  return <span className="flex flex-wrap gap-2">{paths.map((path) => <Badge key={`${path.section}.${path.field}`} variant="outline">{path.section}.{path.field}</Badge>)}</span>;
}

export function RawProfile({ profile }: { profile: ProfileGetResult }) {
  const { t } = useTranslation();
  return (
    <div className="grid w-full min-w-0 gap-4">
      <Alert role="note" variant="warning">
        <FileJson aria-hidden="true" />
        <AlertTitle>{t("profile.rawWarningTitle")}</AlertTitle>
        <AlertDescription>{t("profile.rawWarningDescription")}</AlertDescription>
      </Alert>
      {profile.raw?.global && <RawBlock label={t("profile.globalDocument")} value={profile.raw.global} />}
      {profile.raw?.project && <RawBlock label={t("profile.projectDocument")} value={profile.raw.project} />}
      {!profile.raw?.global && !profile.raw?.project && (
        <CardFrame className="min-h-72">
          <EmptyState description={t("profile.noRawDescription")} title={t("profile.noRawTitle")} />
        </CardFrame>
      )}
    </div>
  );
}

function RawBlock({ label, value }: { label: string; value: string }) {
  return (
    <CardFrame className="min-w-0 overflow-hidden">
      <CardFrameHeader>
        <CardFrameTitle>{label}</CardFrameTitle>
      </CardFrameHeader>
      <Card>
        <CardPanel className="p-0">
          <ScrollArea className="h-96 w-full" clampContentMinWidth={false} scrollFade scrollbarGutter>
            <pre className="min-w-full whitespace-pre-wrap break-words p-4 font-mono text-xs leading-5 text-foreground [overflow-wrap:anywhere] sm:p-6">{value}</pre>
          </ScrollArea>
        </CardPanel>
      </Card>
    </CardFrame>
  );
}
