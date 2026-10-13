import { projectOpaqueId } from "../domain/identity";
import { sha256Hex } from "../shared/crypto";
import { remoteSourceUrl } from "../shared/remote-source-url";
import { AttachmentIngestor, assertIngestDeadline, readAttachmentBody, withinDeadline } from "./attachment-ingest";
import { AttachmentRepository } from "./attachment-repository";
import { contentDispositionFilename } from "./content-disposition";
import { normalizeFilename, SUPPORTED_TO_MARKDOWN_FORMATS } from "./formats";
import { AttachmentServiceError, type AttachmentLifecycle, type AttachmentMetadata, type RemoteImportInput } from "./types";

const REMOTE_NETWORK_DEADLINE_MS = 20_000;
const REMOTE_OVERALL_DEADLINE_MS = 60_000;
const MAX_REDIRECTS = 3;

function validateRemoteUrl(value: string): URL {
  const url = remoteSourceUrl(value);
  if (!url) throw new AttachmentServiceError("REMOTE_URL_INVALID", 400, "Remote URL must use HTTPS on the default port without userinfo");
  return url;
}

function redactedUrl(url: URL): string {
  return `${url.origin}${url.pathname}`;
}

function fallbackFilename(url: URL, disposition: string | null, mime: string | undefined): string {
  const fromHeader = contentDispositionFilename(disposition);
  if (fromHeader) return normalizeFilename(fromHeader);
  const basename = url.pathname.split("/").filter(Boolean).at(-1);
  if (basename) {
    try {
      return normalizeFilename(decodeURIComponent(basename));
    } catch (error) {
      if (error instanceof AttachmentServiceError) throw error;
    }
  }
  const format = SUPPORTED_TO_MARKDOWN_FORMATS.find((item) => (item.mimeTypes as readonly string[]).includes(mime ?? ""));
  return `remote.${format?.extensions[0] ?? "bin"}`;
}

export interface RemoteImportOptions {
  fetch?: typeof fetch;
  remoteDeadlineMs?: number;
  overallDeadlineMs?: number;
  now?: () => number;
}

async function remoteImportFingerprint(url: string, lifecycle: AttachmentLifecycle): Promise<string> {
  const sourceFingerprint = await sha256Hex(url);
  const legacyInput = { sourceKind: "url", sourceFingerprint };
  return sha256Hex(JSON.stringify(lifecycle === "user" ? legacyInput : { ...legacyInput, lifecycle }));
}

export class RemoteAttachmentImporter {
  private readonly fetcher: typeof fetch;
  private readonly networkDeadlineMs: number;
  private readonly overallDeadlineMs: number;
  private readonly now: () => number;

  constructor(
    private readonly repository: AttachmentRepository,
    private readonly ingestor: AttachmentIngestor,
    private readonly ownerId: string,
    options: RemoteImportOptions = {},
  ) {
    this.fetcher = options.fetch ?? fetch;
    this.networkDeadlineMs = Math.min(options.remoteDeadlineMs ?? REMOTE_NETWORK_DEADLINE_MS, REMOTE_NETWORK_DEADLINE_MS);
    this.overallDeadlineMs = Math.min(options.overallDeadlineMs ?? REMOTE_OVERALL_DEADLINE_MS, REMOTE_OVERALL_DEADLINE_MS);
    this.now = options.now ?? Date.now;
  }

  async importRemote(input: RemoteImportInput): Promise<AttachmentMetadata> {
    const deadlineAt = this.now() + this.overallDeadlineMs;
    let currentUrl = validateRemoteUrl(input.url);
    const projectId = await projectOpaqueId(this.ownerId, input.project);
    const lifecycle = input.lifecycle ?? "user";
    const fingerprint = await remoteImportFingerprint(input.url, lifecycle);
    const existingResult = await withinDeadline(
      () => this.repository.existingResult(projectId, input.idempotencyKey, fingerprint, input.project),
      deadlineAt,
      this.now,
    );
    if (existingResult) return existingResult;

    const controller = new AbortController();
    const networkTimeout = Math.min(this.networkDeadlineMs, Math.max(0, deadlineAt - this.now()));
    const timer = setTimeout(() => controller.abort(), networkTimeout);
    try {
      for (let redirects = 0; ; redirects += 1) {
        let response: Response;
        try {
          response = await this.fetcher(currentUrl, {
            method: "GET",
            redirect: "manual",
            signal: controller.signal,
            headers: {
              "User-Agent": "workmory-attachment-import/0.1",
              Accept: "*/*",
              "Accept-Encoding": "identity",
            },
          });
        } catch {
          if (controller.signal.aborted) {
            throw new AttachmentServiceError("REMOTE_TIMEOUT", 504, "Remote attachment import timed out");
          }
          throw new AttachmentServiceError("REMOTE_FETCH_FAILED", 502, "Remote attachment request failed");
        }
        if (response.status >= 300 && response.status < 400) {
          await response.body?.cancel().catch(() => {});
          if (redirects >= MAX_REDIRECTS) {
            throw new AttachmentServiceError("REMOTE_REDIRECT_LIMIT", 422, "Remote attachment exceeded redirect limit");
          }
          const location = response.headers.get("location");
          if (!location) throw new AttachmentServiceError("REMOTE_FETCH_FAILED", 502, "Remote redirect has no location");
          currentUrl = validateRemoteUrl(new URL(location, currentUrl).toString());
          continue;
        }
        if (!response.ok) {
          await response.body?.cancel().catch(() => {});
          throw new AttachmentServiceError("REMOTE_FETCH_FAILED", 502, "Remote attachment returned a non-success response");
        }
        const lengthHeader = response.headers.get("content-length");
        const contentLength = lengthHeader === null ? undefined : Number(lengthHeader);
        if (!response.body) throw new AttachmentServiceError("EMPTY_BODY", 400, "Remote attachment body is empty");
        const bytes = await readAttachmentBody(response.body, contentLength, controller.signal);
        assertIngestDeadline(deadlineAt, this.now);
        const declaredMime = response.headers.get("content-type") ?? undefined;
        const filename = fallbackFilename(
          currentUrl,
          response.headers.get("content-disposition"),
          declaredMime?.split(";", 1)[0].toLowerCase(),
        );
        return await this.ingestor.ingestAttachment({
          project: input.project,
          filename,
          declaredMime,
          bytes,
          idempotencyKey: input.idempotencyKey,
          sourceKind: "url",
          lifecycle,
          sourceUrl: redactedUrl(currentUrl),
          fingerprintOverride: fingerprint,
          deadlineAt,
        });
      }
    } finally {
      clearTimeout(timer);
    }
  }
}
