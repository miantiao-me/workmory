import { AttachmentService } from "../../server/attachments/service";
import { AttachmentCleanup } from "../../server/attachments/attachment-cleanup";
import { AttachmentIngestor, type IngestAttachmentInput } from "../../server/attachments/attachment-ingest";
import { AttachmentRepository } from "../../server/attachments/attachment-repository";
import type { MarkdownConverter } from "../../server/attachments/converter";
import type { AttachmentObjectStore } from "../../server/storage/attachment-object-store";
import { createMemoryService } from "../../server/application/d1-memory-service";
import type { RuntimeBindings } from "../../server/env";
import type { RequestServices } from "../../server/http/services";
import { D1ProjectDirectoryService } from "../../server/application/project-directory";
import type { HandlerRuntime } from "../../server/http/runtime";
import { R2AttachmentObjectStore } from "../../server/storage/attachment-object-store";
import { accessActor, testEnv } from "./helpers";
import { createProfileService } from "../../server/profile/service";
import { getMaintenanceStatus } from "../../server/maintenance/status";
export const rootKey = "root-secret-value-that-is-at-least-32-bytes";
export const text = (value: string) => new TextEncoder().encode(value);

export class FakeConverter implements MarkdownConverter {
  calls = 0;
  fail = false;
  output = "# Converted";
  onConvert?: () => void;

  async convert() {
    this.calls += 1;
    this.onConvert?.();
    if (this.fail) throw new Error("conversion failed");
    return { markdown: this.output, id: "fake-conversion", tokens: 7, converter: "fake" };
  }
}

export function attachmentService(options: {
  ownerId?: string;
  converter?: FakeConverter;
  fetch?: typeof fetch;
  deadline?: number;
  overallDeadline?: number;
  now?: () => number;
} = {}) {
  const converter = options.converter ?? new FakeConverter();
  return {
    converter,
    service: new AttachmentService(
      testEnv.DB,
      new R2AttachmentObjectStore(testEnv.BUCKET),
      converter,
      accessActor(options.ownerId),
      {
        fetch: options.fetch,
        remoteDeadlineMs: options.deadline,
        overallDeadlineMs: options.overallDeadline,
        now: options.now,
      },
    ),
  };
}

export function attachmentCleanup(now?: () => number): AttachmentCleanup {
  return new AttachmentCleanup(testEnv.DB, new R2AttachmentObjectStore(testEnv.BUCKET), now);
}

export function attachmentIngestor(options: {
  repository?: AttachmentRepository;
  objectStore?: AttachmentObjectStore;
  converter?: FakeConverter;
  ownerId?: string;
  now?: () => number;
} = {}): AttachmentIngestor {
  return new AttachmentIngestor(
    options.repository ?? new AttachmentRepository(testEnv.DB, accessActor(options.ownerId)),
    options.objectStore ?? new R2AttachmentObjectStore(testEnv.BUCKET),
    options.converter ?? new FakeConverter(),
    options.ownerId ?? "subject-a",
    options.now ?? (() => 500),
  );
}

export function pdfInput(overrides: Partial<IngestAttachmentInput> = {}): IngestAttachmentInput {
  return {
    project: "workmory",
    filename: "fixture.pdf",
    declaredMime: "application/pdf",
    bytes: text("%PDF-1.7 fixture"),
    idempotencyKey: "pdf-fixture",
    sourceKind: "upload",
    ...overrides,
  };
}

export function accessHeaders(subject: string, extra: HeadersInit = {}): Headers {
  return new Headers({ Authorization: `Bearer ${subject}`, ...Object.fromEntries(new Headers(extra)) });
}

export function httpRuntime(): HandlerRuntime {
  const httpEnv = {
    DB: testEnv.DB,
    BUCKET: testEnv.BUCKET,
    ACCESS_TEAM_DOMAIN: "https://team.cloudflareaccess.com",
    ACCESS_AUD: "audience",
    EMBEDDING_MODEL: "fake",
    EMBEDDING_DIMENSIONS: "3",
    VECTOR_INDEX_VERSION: "test-v1",
    ROOT_API_KEY: rootKey,
  } as unknown as RuntimeBindings;
  return {
    env: httpEnv,
    defer: () => undefined,
    accessVerifier: {
      verify: async (subject) => ({
        issuer: "https://team.cloudflareaccess.com",
        audience: "audience",
        subject,
        type: "app",
      }),
    },
    createServices: (requestActor) => {
      const attachments = new AttachmentService(
        testEnv.DB,
        new R2AttachmentObjectStore(testEnv.BUCKET),
        new FakeConverter(),
        requestActor,
      );
      const cleanup = new AttachmentCleanup(testEnv.DB, new R2AttachmentObjectStore(testEnv.BUCKET));
      const memory = createMemoryService({ DB: testEnv.DB, BUCKET: testEnv.BUCKET }, requestActor, { attachments });
      return {
        attachments,
        memory,
        profile: createProfileService(memory),
        projectDirectory: new D1ProjectDirectoryService(testEnv.DB, requestActor),
        maintenance: async (action = "process") => {
          if (action === "status") return getMaintenanceStatus(testEnv.DB);
          if (action === "reindex") return { reindex: { enqueued: 0, graphMarked: 0 } };
          return {
            outbox: { claimed: 0, succeeded: 0, failed: 0 },
            vectorCleanup: { claimed: 0, succeeded: 0, failed: 0 },
            canonicalCleanup: { claimed: 0, deleted: 0, failed: 0 },
            attachments: await cleanup.cleanupStale(),
            graph: { selected: 0, succeeded: 0, failed: 0, stale: 0 },
          };
        },
      } satisfies RequestServices;
    },
  };
}
