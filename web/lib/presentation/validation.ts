import i18n from "../i18n";
import { UserFacingError } from "./errors";

const stableIdentifierPattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const operationIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

export function makeOperationId(prefix: string): string {
  return `${prefix}:${crypto.randomUUID()}`.slice(0, 128);
}

export function stableIdentifier(value: string, label: string, maxLength: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength || !stableIdentifierPattern.test(normalized)) {
    throw new UserFacingError(i18n.t("validation.identifier", { label, max: String(maxLength) }));
  }
  return normalized;
}

// 渲染期安全解析：不做上限校验，供计数、筛选预览等展示路径使用
export function parseTagsInput(value: string): string[] {
  return value.split(",").map((tag) => tag.trim()).filter(Boolean);
}

export function tagsFromInput(value: string): string[] {
  const tags = parseTagsInput(value);
  if (tags.length > 32) throw new UserFacingError(i18n.t("validation.tagsMax"));
  if (tags.some((tag) => tag.length > 64)) throw new UserFacingError(i18n.t("validation.tagLength"));
  return tags;
}

export function operationIdFromInput(value: string, required = false): string | undefined {
  const normalized = value.trim();
  if (!normalized && !required) return undefined;
  if (normalized.length < 8 || normalized.length > 128 || !operationIdPattern.test(normalized)) {
    throw new UserFacingError(i18n.t("validation.operationId"));
  }
  return normalized;
}

export function idempotencyKeyFromInput(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 128) throw new UserFacingError(i18n.t("validation.idempotencyKey"));
  return normalized;
}

export function parseJsonObject(value: string, label: string): Record<string, unknown> | undefined {
  if (!value.trim()) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new UserFacingError(i18n.t("validation.jsonObject", { label }));
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new UserFacingError(i18n.t("validation.jsonObject", { label }));
  }
  return parsed as Record<string, unknown>;
}
