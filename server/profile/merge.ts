import type {
  EffectiveProfile,
  EffectiveProfileField,
  ProfileDocument,
  ProfileField,
  ProfileFieldPath,
  ProfileScope,
} from "./types";
import { ProfileValidationError } from "./schema";
import { validateProfileDocument } from "./document";

export interface MergeProfileOptions {
  includeSensitive?: boolean;
  now: Date | string;
}

function instant(value: Date | string): number {
  const timestamp = value instanceof Date ? value.valueOf() : Date.parse(value);
  if (Number.isNaN(timestamp)) throw new ProfileValidationError("Merge now must be a valid timestamp");
  return timestamp;
}

function isExpired(field: ProfileField, now: number): boolean {
  return field.expires_at !== undefined && Date.parse(field.expires_at) <= now;
}

function isStale(field: ProfileField, now: number): boolean {
  if (!field.stale_after) return false;
  return field.stale_after <= new Date(now).toISOString().slice(0, 10);
}

function effectiveField(value: ProfileField, origin: ProfileScope, masked: boolean): EffectiveProfileField {
  const provenance = {
    kind: value.provenance.kind,
    ...(value.provenance.source_ids === undefined ? {} : { source_ids: value.provenance.source_ids }),
    recorded_at: value.provenance.recorded_at,
  };
  return {
    state: "set",
    ...(!masked && value.state === "set" ? { value: value.value } : {}),
    provenance,
    ...(value.confidence === undefined ? {} : { confidence: value.confidence }),
    sensitivity: value.sensitivity,
    ...(value.stale_after === undefined ? {} : { stale_after: value.stale_after }),
    ...(value.expires_at === undefined ? {} : { expires_at: value.expires_at }),
    origin,
  };
}

export function mergeProfiles(
  globalProfile: ProfileDocument,
  projectProfile: ProfileDocument | undefined,
  options: MergeProfileOptions,
): EffectiveProfile {
  const global = validateProfileDocument(globalProfile);
  const project = projectProfile ? validateProfileDocument(projectProfile) : undefined;
  if (global.frontmatter.scope !== "global") throw new ProfileValidationError("Global profile must use global scope");
  if (project && project.frontmatter.scope !== "project") throw new ProfileValidationError("Project profile must use project scope");
  const now = instant(options.now);
  const selected = new Map<string, { section: string; field: string; value: ProfileField; origin: ProfileScope }>();

  for (const [section, fields] of Object.entries(global.frontmatter.sections)) {
    for (const [field, value] of Object.entries(fields)) {
      if (!isExpired(value, now) && value.state === "set") {
        selected.set(`${section}\0${field}`, { section, field, value, origin: "global" });
      }
    }
  }
  if (project) {
    for (const [section, fields] of Object.entries(project.frontmatter.sections)) {
      for (const [field, value] of Object.entries(fields)) {
        if (isExpired(value, now)) continue;
        const path = `${section}\0${field}`;
        if (value.state === "suppressed") selected.delete(path);
        else selected.set(path, { section, field, value, origin: "project" });
      }
    }
  }

  const sections: EffectiveProfile["sections"] = Object.create(null);
  const staleFields: ProfileFieldPath[] = [];
  const maskedFields: ProfileFieldPath[] = [];
  for (const { section, field, value, origin } of selected.values()) {
    const path = { section, field };
    if (isStale(value, now)) staleFields.push(path);
    const masked = value.sensitivity === "sensitive" && !options.includeSensitive;
    if (masked) maskedFields.push(path);
    if (!Object.hasOwn(sections, section)) sections[section] = Object.create(null);
    sections[section][field] = effectiveField(value, origin, masked);
  }
  return { sections, staleFields, maskedFields };
}
