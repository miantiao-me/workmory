import { projectSchema } from "../domain/contracts";
import { contentDispositionFilename } from "../attachments/content-disposition";
import { authenticatedServices } from "./authenticated";
import { HttpError, jsonResponse } from "./errors";
import { handleRequest } from "./handler";
import { preflightResponse } from "./security";
import type { HandlerRuntime } from "./runtime";

function route(request: Request): { project: string; id?: string; content?: "original" | "markdown" } {
  const match = /^\/v1\/projects\/([^/]+)\/attachments(?:\/(att_[a-f0-9]{32}))?(?:\/content\/(original|markdown))?\/?$/.exec(
    new URL(request.url).pathname,
  );
  if (!match) throw new HttpError(404, "NOT_FOUND", "Route was not found");
  let project: string;
  try {
    project = decodeURIComponent(match[1]);
  } catch {
    throw new HttpError(400, "INVALID_PROJECT", "Project is invalid");
  }
  const parsed = projectSchema.safeParse(project);
  if (!parsed.success) throw new HttpError(400, "INVALID_PROJECT", "Project is invalid");
  return { project: parsed.data, id: match[2], content: match[3] as "original" | "markdown" | undefined };
}

function downloadHeaders(filename: string, markdown: boolean): HeadersInit {
  return {
    "Content-Type": markdown ? "text/markdown;charset=utf-8" : "application/octet-stream",
    "Content-Disposition": markdown
      ? `attachment; filename="attachment.md"; filename*=UTF-8''${encodeURIComponent(filename.replace(/\.[^.]+$/, "") + ".md")}`
      : `attachment; filename="attachment"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, no-store",
  };
}

function routeTemplate(request: Request): string {
  const pathname = new URL(request.url).pathname;
  if (/\/content\/(?:original|markdown)\/?$/.test(pathname)) return "/v1/projects/:project/attachments/:attachment/content/:kind";
  if (/\/att_[a-f0-9]{32}\/?$/.test(pathname)) return "/v1/projects/:project/attachments/:attachment";
  return "/v1/projects/:project/attachments";
}

export async function handleAttachmentRequest(request: Request, runtime: HandlerRuntime): Promise<Response> {
  return handleRequest(routeTemplate(request), async () => {
    if (request.method === "OPTIONS") return preflightResponse("POST, GET, DELETE, OPTIONS");
    const { project, id, content } = route(request);
    const { services } = await authenticatedServices(request, runtime);

    if (!id && request.method === "POST") {
      const disposition = contentDispositionFilename(request.headers.get("content-disposition"));
      if (!disposition) throw new HttpError(400, "FILENAME_REQUIRED", "Content-Disposition filename is required");
      const idempotencyKey = request.headers.get("idempotency-key");
      if (!idempotencyKey || idempotencyKey.length > 128) throw new HttpError(400, "IDEMPOTENCY_KEY_REQUIRED", "A valid Idempotency-Key is required");
      if (!request.body) throw new HttpError(400, "EMPTY_BODY", "Attachment body is required");
      const length = request.headers.get("content-length");
      const result = await services.attachments.upload({
        project,
        filename: disposition,
        declaredMime: request.headers.get("content-type") ?? undefined,
        body: request.body,
        contentLength: length === null ? undefined : Number(length),
        expectedSha256: request.headers.get("x-content-sha256") ?? undefined,
        idempotencyKey,
      });
      return jsonResponse(result, result.reused ? 200 : 201);
    }
    if (!id) return new Response(null, { status: 405, headers: { Allow: "POST, OPTIONS" } });

    if (request.method === "GET" && !content) {
      return jsonResponse(await services.attachments.getMetadata(project, id));
    }
    if (request.method === "GET" && content) {
      if (request.headers.has("range")) throw new HttpError(400, "RANGE_NOT_SUPPORTED", "Range requests are not supported");
      const result = content === "original"
        ? await services.attachments.getOriginal(project, id)
        : await services.attachments.getMarkdown(project, id);
      return new Response(Uint8Array.from(result.bytes).buffer, { status: 200, headers: downloadHeaders(result.metadata.filename, content === "markdown") });
    }
    if (request.method === "DELETE" && !content) {
      await services.attachments.delete(project, id);
      return new Response(null, { status: 204, headers: { "Cache-Control": "private, no-store" } });
    }
    return new Response(null, { status: 405, headers: { Allow: content ? "GET, OPTIONS" : "GET, DELETE, OPTIONS" } });
  });
}
