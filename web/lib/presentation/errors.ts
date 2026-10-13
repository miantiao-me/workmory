import { ApiError } from "../api/client";
import i18n from "../i18n";

type ApiErrorTranslationKey = keyof typeof import("../../locales/zh-CN").zhCN.errors.api;

const API_ERROR_KEYS: Record<string, ApiErrorTranslationKey> = {
  AUTH_REQUIRED: "authRequired",
  AUTH_INVALID: "authInvalid",
  ROOT_REQUIRED: "rootRequired",
  REVISION_CONFLICT: "revisionConflict",
  OPERATION_CONFLICT: "operationConflict",
  IDEMPOTENCY_CONFLICT: "idempotencyConflict",
  NOT_FOUND: "notFound",
  ATTACHMENT_NOT_FOUND: "attachmentNotFound",
  ATTACHMENT_REFERENCED: "attachmentReferenced",
  ATTACHMENT_NOT_READY: "attachmentNotReady",
  PAYLOAD_TOO_LARGE: "payloadTooLarge",
  UNSUPPORTED_MEDIA: "unsupportedMedia",
  REMOTE_TIMEOUT: "remoteTimeout",
  INVALID_INPUT: "invalidInput",
  UNAVAILABLE: "unavailable",
};

export class UserFacingError extends Error {}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const key = API_ERROR_KEYS[error.code];
    return key ? i18n.t(`errors.api.${key}`) : i18n.t("errors.generic");
  }
  return error instanceof UserFacingError ? error.message : i18n.t("errors.generic");
}

export function isCredentialRejection(error: unknown): boolean {
  return error instanceof ApiError && (
    error.status === 401
    || error.status === 403
    || error.code === "AUTH_REQUIRED"
    || error.code === "AUTH_INVALID"
  );
}
