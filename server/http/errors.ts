import { AttachmentServiceError } from "../attachments/types";
import { AuthenticationError } from "../auth/types";
import { MemoryServiceError } from "../application/memory-service";
import { ProjectDirectoryError } from "../application/project-directory";

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function jsonResponse(value: unknown, status = 200, headers?: HeadersInit): Response {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "private, no-store", ...Object.fromEntries(new Headers(headers)) },
  });
}

export function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) return jsonResponse({ error: { code: error.code, message: error.message } }, error.status);
  if (error instanceof AuthenticationError) return jsonResponse({ error: { code: error.code, message: error.message } }, error.status);
  if (error instanceof AttachmentServiceError) {
    return jsonResponse({ error: { code: error.code, message: error.message, ...(error.detail ? { detail: error.detail } : {}) } }, error.status);
  }
  if (error instanceof ProjectDirectoryError) {
    return jsonResponse({ error: { code: error.code, message: error.message } }, 409);
  }
  if (error instanceof MemoryServiceError) {
    const status =
      error.code === "NOT_FOUND"
        ? 404
        : error.code === "REVISION_CONFLICT" || error.code === "OPERATION_CONFLICT" || error.code === "CONFLICT"
          ? 409
          : error.code === "INVALID_INPUT"
            ? 422
            : 503;
    return jsonResponse({ error: { code: error.code, message: error.message } }, status);
  }
  return jsonResponse({ error: { code: "INTERNAL_ERROR", message: "Request failed" } }, 503);
}
