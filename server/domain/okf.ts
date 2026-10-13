import { Document, isMap, parseDocument } from "yaml";
import { utf8Length } from "../shared/crypto";

export const OKF_VERSION = "0.2" as const;
export const MAX_OKF_BYTES = 1_048_576;
export const MAX_FRONTMATTER_BYTES = 262_144;
const MAX_YAML_ALIASES = 50;

export type OkfFrontmatter = Record<string, unknown>;
export type TrustTier = "unverified" | "machine-confirmed" | "human-reviewed";

export interface VerificationEvent {
  by?: string;
  at?: string;
  [key: string]: unknown;
}

export interface OkfNormalizedFields {
  sources: Record<string, unknown>[];
  generated?: Record<string, unknown>;
  verified: VerificationEvent[];
  status: string;
  staleAfter?: string;
}

export interface OkfDocument {
  frontmatter: OkfFrontmatter;
  body: string;
  normalized: OkfNormalizedFields;
}

export interface OkfValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  document?: OkfDocument;
}

export interface OkfValidationOptions {
  filename?: string;
  bundleRoot?: boolean;
}

class OkfParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OkfParseError";
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function normalizeMappings(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      const mapping = asRecord(item);
      return mapping ? [mapping] : [];
    });
  }
  const mapping = asRecord(value);
  return mapping ? [mapping] : [];
}

export function normalizeOkfFields(frontmatter: OkfFrontmatter): OkfNormalizedFields {
  return {
    sources: normalizeMappings(frontmatter.sources),
    generated: asRecord(frontmatter.generated),
    verified: normalizeMappings(frontmatter.verified),
    status: typeof frontmatter.status === "string" ? frontmatter.status : "stable",
    staleAfter:
      typeof frontmatter.stale_after === "string" ? frontmatter.stale_after : undefined,
  };
}

function splitFrontmatter(markdown: string): { yaml: string; body: string } {
  if (utf8Length(markdown) > MAX_OKF_BYTES) {
    throw new OkfParseError(`OKF document exceeds ${MAX_OKF_BYTES} bytes`);
  }
  if (!markdown.startsWith("---\n") && !markdown.startsWith("---\r\n")) {
    throw new OkfParseError("OKF document must start with YAML frontmatter");
  }

  const match = /^(?:---\r?\n)([\s\S]*?)(?:\r?\n---(?:\r?\n|$))/.exec(markdown);
  if (!match) {
    throw new OkfParseError("OKF document is missing the closing frontmatter delimiter");
  }
  if (utf8Length(match[1]) > MAX_FRONTMATTER_BYTES) {
    throw new OkfParseError(`YAML frontmatter exceeds ${MAX_FRONTMATTER_BYTES} bytes`);
  }
  return { yaml: match[1], body: markdown.slice(match[0].length) };
}

function parseYamlMapping(source: string): OkfFrontmatter {
  const yaml = parseDocument(source, {
    schema: "core",
    customTags: [],
    prettyErrors: false,
    strict: true,
  });
  if (yaml.errors.length > 0) {
    throw new OkfParseError(`Invalid YAML frontmatter: ${yaml.errors[0].message}`);
  }
  if (!isMap(yaml.contents)) {
    throw new OkfParseError("YAML frontmatter must be a mapping");
  }
  try {
    return yaml.toJS({ maxAliasCount: MAX_YAML_ALIASES }) as OkfFrontmatter;
  } catch (error) {
    throw new OkfParseError(
      error instanceof Error ? `Unsafe YAML frontmatter: ${error.message}` : "Unsafe YAML frontmatter",
    );
  }
}

export function parseOkf(markdown: string): OkfDocument {
  const { yaml, body } = splitFrontmatter(markdown);
  const frontmatter = parseYamlMapping(yaml);
  return { frontmatter, body, normalized: normalizeOkfFields(frontmatter) };
}

export function serializeOkf(document: Pick<OkfDocument, "frontmatter" | "body">): string {
  const frontmatter = { ...document.frontmatter };
  if (asRecord(frontmatter.verified)) {
    frontmatter.verified = [frontmatter.verified];
  }
  if (asRecord(frontmatter.sources)) {
    frontmatter.sources = [frontmatter.sources];
  }

  const yaml = new Document(frontmatter, { schema: "core" });
  const serialized = `---\n${yaml.toString({ lineWidth: 0 }).trimEnd()}\n---\n${document.body}`;
  if (utf8Length(serialized) > MAX_OKF_BYTES) {
    throw new OkfParseError(`OKF document exceeds ${MAX_OKF_BYTES} bytes`);
  }
  return serialized;
}

function actorWarning(actor: unknown, field: string, warnings: string[]): void {
  if (
    typeof actor === "string" &&
    actor.length > 0 &&
    !actor.startsWith("human:") &&
    !actor.startsWith("process:") &&
    !actor.includes("/")
  ) {
    warnings.push(`${field} does not follow the OKF actor convention`);
  }
}

function validateConcept(document: OkfDocument, errors: string[], warnings: string[]): void {
  const { frontmatter, normalized } = document;
  if (typeof frontmatter.type !== "string" || frontmatter.type.trim() === "") {
    errors.push("Frontmatter field 'type' must be a non-empty string");
  }
  if (!(["draft", "stable", "deprecated"] as unknown[]).includes(normalized.status)) {
    warnings.push("status should be draft, stable, or deprecated");
  }
  if (frontmatter.sources !== undefined) {
    const sourceValues = Array.isArray(frontmatter.sources)
      ? frontmatter.sources
      : [frontmatter.sources];
    if (sourceValues.some((source) => !asRecord(source)?.resource)) {
      warnings.push("each sources entry should be a mapping with resource");
    }
  }
  if (frontmatter.generated !== undefined && !normalized.generated) {
    warnings.push("generated should be a mapping");
  }
  if (normalized.generated) {
    if (!normalized.generated.by) warnings.push("generated.by should be present");
    actorWarning(normalized.generated.by, "generated.by", warnings);
  }
  if (frontmatter.verified !== undefined && normalized.verified.length === 0) {
    warnings.push("verified should be a mapping or array of mappings");
  }
  for (const event of normalized.verified) {
    if (!event.by || !event.at) warnings.push("verified entries should contain by and at");
    actorWarning(event.by, "verified.by", warnings);
  }
  if (frontmatter.stale_after !== undefined && !isIsoDate(normalized.staleAfter)) {
    warnings.push("stale_after should use YYYY-MM-DD");
  }
  if (frontmatter.type === "Attested Computation" && typeof frontmatter.runtime !== "string") {
    warnings.push("Attested Computation should declare a runtime");
  }
}

function validateIndex(
  markdown: string,
  options: OkfValidationOptions,
  errors: string[],
): OkfDocument | undefined {
  if (!markdown.startsWith("---\n") && !markdown.startsWith("---\r\n")) return undefined;
  let document: OkfDocument;
  try {
    document = parseOkf(markdown);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "Invalid index frontmatter");
    return undefined;
  }
  if (!options.bundleRoot) {
    errors.push("Only a bundle-root index.md may contain frontmatter");
  } else if (document.frontmatter.okf_version !== OKF_VERSION) {
    errors.push(`Bundle-root index.md frontmatter must set okf_version to "${OKF_VERSION}"`);
  }
  return document;
}

export function validateOkf(
  markdown: string,
  options: OkfValidationOptions = {},
): OkfValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const filename = options.filename?.split("/").at(-1);

  if (filename === "index.md") {
    const document = validateIndex(markdown, options, errors);
    return { valid: errors.length === 0, errors, warnings, document };
  }
  if (filename === "log.md") {
    if (markdown.startsWith("---\n") || markdown.startsWith("---\r\n")) {
      errors.push("log.md must not contain frontmatter");
    }
    for (const heading of markdown.matchAll(/^##\s+(.+)$/gm)) {
      if (!isIsoDate(heading[1])) warnings.push(`log.md date heading '${heading[1]}' is not YYYY-MM-DD`);
    }
    return { valid: errors.length === 0, errors, warnings };
  }

  try {
    const document = parseOkf(markdown);
    validateConcept(document, errors, warnings);
    return { valid: errors.length === 0, errors, warnings, document };
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "Invalid OKF document");
    return { valid: false, errors, warnings };
  }
}

export function getTrustTier(value: Pick<OkfDocument, "normalized"> | OkfFrontmatter): TrustTier {
  const normalized = (value as Partial<Pick<OkfDocument, "normalized">>).normalized;
  const verified = normalized ? normalized.verified : normalizeOkfFields(value as OkfFrontmatter).verified;
  if (verified.length === 0) return "unverified";
  return verified.some((event) => typeof event.by === "string" && event.by.startsWith("human:"))
    ? "human-reviewed"
    : "machine-confirmed";
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function isStale(staleAfter: unknown, today: Date | string = new Date()): boolean {
  if (!isIsoDate(staleAfter)) return false;
  const todayString = typeof today === "string" ? today : today.toISOString().slice(0, 10);
  return isIsoDate(todayString) && todayString >= staleAfter;
}
