import { parseOkf, serializeOkf } from "../domain/okf";
import { PROFILE_BODY } from "../domain/profile";
import { utf8Length } from "../shared/crypto";
import type { ProfileDocument, ProfilePatchOperation } from "./types";
import {
  MAX_PROFILE_BYTES,
  ProfileValidationError,
  cloneProfileSections,
  parseProfileFrontmatter,
  parseProfileOperations,
  profileErrorMessage,
  type ValidatedProfileOperation,
} from "./schema";

export function validateProfileDocument(document: ProfileDocument): ProfileDocument {
  const frontmatter = parseProfileFrontmatter(document.frontmatter);
  if (document.body !== PROFILE_BODY) throw new ProfileValidationError("Invalid profile disclaimer");
  return { frontmatter, body: PROFILE_BODY } as ProfileDocument;
}

export function parseProfileOkf(markdown: string): ProfileDocument {
  if (utf8Length(markdown) > MAX_PROFILE_BYTES) {
    throw new ProfileValidationError(`Profile exceeds ${MAX_PROFILE_BYTES} bytes`);
  }
  try {
    const parsed = parseOkf(markdown);
    return validateProfileDocument({ frontmatter: parsed.frontmatter, body: parsed.body } as ProfileDocument);
  } catch (error) {
    if (error instanceof ProfileValidationError) throw error;
    throw new ProfileValidationError(profileErrorMessage(error));
  }
}

export function serializeProfileOkf(document: ProfileDocument): string {
  const validated = validateProfileDocument(document);
  const markdown = serializeOkf(validated);
  if (utf8Length(markdown) > MAX_PROFILE_BYTES) {
    throw new ProfileValidationError(`Profile exceeds ${MAX_PROFILE_BYTES} bytes`);
  }
  return markdown;
}

export function patchProfile(
  document: ProfileDocument,
  operations: readonly ProfilePatchOperation[],
): ProfileDocument {
  const current = validateProfileDocument(document);
  const parsed = parseProfileOperations(operations, current.frontmatter.scope);
  return patchValidatedProfile(current, parsed);
}

export function patchValidatedProfile(
  document: ProfileDocument,
  operations: readonly ValidatedProfileOperation[],
): ProfileDocument {
  const sections = cloneProfileSections(document.frontmatter.sections);
  for (const operation of operations) {
    if (operation.op === "remove") {
      const fields = Object.hasOwn(sections, operation.section) ? sections[operation.section] : undefined;
      if (fields && Object.hasOwn(fields, operation.field)) {
        delete fields[operation.field];
        if (Object.keys(fields).length === 0) delete sections[operation.section];
      }
      continue;
    }
    if (!Object.hasOwn(sections, operation.section)) sections[operation.section] = Object.create(null);
    sections[operation.section][operation.field] = operation.fieldValue;
  }

  return validateProfileDocument({
    frontmatter: { ...document.frontmatter, sections },
    body: PROFILE_BODY,
  });
}
