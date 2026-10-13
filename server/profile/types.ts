import type { z } from "zod";
import type {
  profileFrontmatterSchema,
  profileProvenanceSchema,
  setProfileFieldSchema,
  suppressedProfileFieldSchema,
} from "./schema";

export type ProfileScope = "global" | "project";
export type ProfileProvenanceKind = "user_explicit" | "user_imported" | "agent_inferred";
export type ProfileSensitivity = "normal" | "personal" | "sensitive";

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

// Stored-field shapes derive from the zod schemas so validation and typing stay in sync.
export type ProfileProvenance = z.output<typeof profileProvenanceSchema>;
export type SetProfileField = z.output<typeof setProfileFieldSchema>;
export type SuppressedProfileField = z.output<typeof suppressedProfileFieldSchema>;
export type ProfileField = SetProfileField | SuppressedProfileField;
export type SetProfileFieldInput = z.input<typeof setProfileFieldSchema>;
export type SuppressedProfileFieldInput = z.input<typeof suppressedProfileFieldSchema>;
export type ProfileSections = Record<string, Record<string, ProfileField>>;

export type ProfileFrontmatter = z.output<typeof profileFrontmatterSchema>;

export interface ProfileDocument {
  frontmatter: ProfileFrontmatter;
  body: string;
}

// Keep explicit operation types: the zod wire schema's discriminated input union
// produces a different (broader) shape than callers need.
export interface SetProfileOperation {
  op: "set";
  section: string;
  field: string;
  fieldValue: SetProfileFieldInput;
}

export interface RemoveProfileOperation {
  op: "remove";
  section: string;
  field: string;
}

export interface SuppressProfileOperation {
  op: "suppress";
  section: string;
  field: string;
  fieldValue: SuppressedProfileFieldInput;
}

export type ProfilePatchOperation = SetProfileOperation | RemoveProfileOperation | SuppressProfileOperation;

export interface ProfileFieldPath {
  section: string;
  field: string;
}

export interface EffectiveProfileField {
  state: "set";
  value?: JsonValue;
  provenance: {
    kind: ProfileProvenanceKind;
    source_ids?: string[];
    recorded_at: string;
  };
  confidence?: number;
  sensitivity: ProfileSensitivity;
  stale_after?: string;
  expires_at?: string;
  origin: ProfileScope;
}

export interface EffectiveProfile {
  sections: Record<string, Record<string, EffectiveProfileField>>;
  staleFields: ProfileFieldPath[];
  maskedFields: ProfileFieldPath[];
}
