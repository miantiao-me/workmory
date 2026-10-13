import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_ATTACHMENT_BYTES } from "../../server/attachments/types";
import { sha256Hex } from "../../server/shared/crypto";
import { resetTestEnv, testEnv } from "./helpers";
import {
  attachmentService,
  FakeConverter,
  text,
} from "./attachment-fixtures";

beforeEach(resetTestEnv);

describe("remote URL attachment import", () => {
  it("follows three HTTPS redirects, sends only fixed headers, and redacts query/fragment", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, init });
      const step = new URL(url).pathname;
      if (step === "/start") return new Response(null, { status: 302, headers: { location: "https://files.example/one?token=secret" } });
      if (step === "/one") return new Response(null, { status: 302, headers: { location: "/two#hidden" } });
      if (step === "/two") return new Response(null, { status: 302, headers: { location: "/final.txt?credential=hidden" } });
      return new Response("remote body", { status: 200, headers: { "content-type": "text/plain", "content-length": "11" } });
    }) as typeof fetch;
    const service = attachmentService({ fetch: fetcher }).service;
    const result = await service.importRemote({ project: "workmory", url: "https://files.example/start?api_key=secret#fragment", idempotencyKey: "remote-ok" });
    expect(result.sourceUrl).toBe("https://files.example/final.txt");
    expect(requests).toHaveLength(4);
    for (const request of requests) {
      const headers = new Headers(request.init?.headers);
      expect(headers.get("authorization")).toBeNull();
      expect(headers.get("cookie")).toBeNull();
      expect(headers.get("accept-encoding")).toBe("identity");
      expect(request.init?.redirect).toBe("manual");
      expect(request.init?.method).toBe("GET");
    }
    const persisted = await testEnv.DB.prepare("SELECT source_url AS sourceUrl FROM attachments WHERE id = ?").bind(result.id).first<{ sourceUrl: string }>();
    expect(persisted?.sourceUrl).toBe("https://files.example/final.txt");
    const replay = await service.importRemote({
      project: "workmory",
      url: "https://files.example/start?api_key=secret#fragment",
      idempotencyKey: "remote-ok",
    });
    expect(replay).toMatchObject({ id: result.id, reused: true });
    expect(fetcher).toHaveBeenCalledTimes(4);
    await expect(
      service.importRemote({ project: "workmory", url: "https://files.example/different", idempotencyKey: "remote-ok" }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it("preserves the legacy user fingerprint and conflicts across lifecycles", async () => {
    const url = "https://files.example/source.txt";
    const fetcher = vi.fn(async () => new Response("remote body", {
      headers: { "content-type": "text/plain", "content-disposition": "attachment; filename=source.txt" },
    })) as typeof fetch;
    const service = attachmentService({ fetch: fetcher }).service;
    const result = await service.importRemote({ project: "workmory", url, idempotencyKey: "lifecycle" });
    const sourceFingerprint = await sha256Hex(url);
    const legacyFingerprint = await sha256Hex(JSON.stringify({ sourceKind: "url", sourceFingerprint }));
    expect(await testEnv.DB.prepare("SELECT lifecycle, fingerprint FROM attachments WHERE id = ?").bind(result.id).first())
      .toEqual({ lifecycle: "user", fingerprint: legacyFingerprint });

    await expect(service.importRemote({
      project: "workmory",
      url,
      idempotencyKey: "lifecycle",
      lifecycle: "memory_source",
    })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT", status: 409 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("rejects HTTP, custom ports, userinfo, and a fourth redirect", async () => {
    const service = attachmentService({ fetch: async () => new Response(null, { status: 302, headers: { location: "/again" } }) }).service;
    for (const url of ["http://example.com/file.txt", "https://example.com:8443/file.txt", "https://user:pass@example.com/file.txt"]) {
      await expect(service.importRemote({ project: "workmory", url, idempotencyKey: `bad-${url.length}` })).rejects.toMatchObject({
        code: "REMOTE_URL_INVALID",
      });
    }
    await expect(
      service.importRemote({ project: "workmory", url: "https://example.com/start", idempotencyKey: "four-redirects" }),
    ).rejects.toMatchObject({ code: "REMOTE_REDIRECT_LIMIT" });
  });

  it("handles timeout, oversized, non-2xx, empty, and unsupported responses", async () => {
    const timeoutFetch = ((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))))) as typeof fetch;
    await expect(
      attachmentService({ fetch: timeoutFetch, deadline: 5 }).service.importRemote({ project: "workmory", url: "https://example.com/file.txt", idempotencyKey: "timeout" }),
    ).rejects.toMatchObject({ code: "REMOTE_TIMEOUT" });

    const cases: Array<[string, typeof fetch, string]> = [
      ["oversized", async () => new Response("x", { headers: { "content-type": "text/plain", "content-length": String(MAX_ATTACHMENT_BYTES + 1) } }), "PAYLOAD_TOO_LARGE"],
      ["not-found", async () => new Response("missing", { status: 404 }), "REMOTE_FETCH_FAILED"],
      ["empty", async () => new Response(new Uint8Array(), { headers: { "content-type": "text/plain" } }), "EMPTY_BODY"],
      ["unsupported", async () => new Response(new Uint8Array([0, 1, 2]), { headers: { "content-type": "application/octet-stream", "content-disposition": "attachment; filename=file.bin" } }), "UNSUPPORTED_MEDIA"],
    ];
    for (const [key, fetcher, code] of cases) {
      await expect(
        attachmentService({ fetch: fetcher }).service.importRemote({ project: "workmory", url: "https://example.com/file", idempotencyKey: key }),
      ).rejects.toMatchObject({ code });
    }
  });

  it("enforces the absolute ingest deadline after a near-deadline download and slow conversion", async () => {
    let now = 0;
    const converter = new FakeConverter();
    converter.onConvert = () => { now = 60_001; };
    const fetcher = (async () => {
      now = 59_000;
      return new Response(text("%PDF-1.7\nfixture"), {
        headers: { "content-type": "application/pdf", "content-disposition": "attachment; filename=slow.pdf" },
      });
    }) as typeof fetch;
    const service = attachmentService({ converter, fetch: fetcher, overallDeadline: 60_000, now: () => now }).service;
    await expect(
      service.importRemote({ project: "workmory", url: "https://example.com/slow.pdf", idempotencyKey: "slow-overall" }),
    ).rejects.toMatchObject({ code: "REMOTE_TIMEOUT", status: 504 });
    expect(await testEnv.DB.prepare(
      "SELECT status, error_code AS errorCode FROM attachments WHERE idempotency_key = 'slow-overall'",
    ).first()).toMatchObject({ status: "failed", errorCode: "REMOTE_TIMEOUT" });
  });
});
