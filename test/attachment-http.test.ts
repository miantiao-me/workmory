import { describe, expect, it, vi } from "vitest";
import { AttachmentServiceError, type AttachmentMetadata } from "../server/attachments/types";
import { handleAttachmentRequest } from "../server/http/attachment-handler";
import { handleMaintenanceRequest } from "../server/http/maintenance-handler";
import type { RequestServices } from "../server/http/services";
import { headers, runtime } from "./fixtures/http";

describe("HTTP security and attachment routes", () => {
  it("returns 405 for GET on the attachment collection", async () => {
    const response = await handleAttachmentRequest(new Request(
      "https://api.example.com/v1/projects/workmory/attachments",
      { method: "GET", headers: headers() },
    ), runtime());
    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("POST, OPTIONS");
    expect(response.headers.get("Content-Type") ?? "").not.toContain("text/html");
  });

  it("accepts arbitrary hosts, protocols, and origins while preserving authentication", async () => {
    const requests = [
      new Request("http://evil.example.com/v1/maintenance", { method: "POST", headers: headers() }),
      new Request("https://api.example.com/v1/maintenance", { method: "POST", headers: headers({ Origin: "null" }) }),
      new Request("https://api.example.com/v1/maintenance", { method: "POST", headers: headers({ Origin: "http://evil.example.com" }) }),
    ];
    for (const request of requests) {
      const response = await handleMaintenanceRequest(request, runtime());
      expect(response.status).toBe(200);
      expect(response.headers.get("access-control-allow-origin")).toBe("*");
    }
  });

  it("maps upload headers/status and serves safe download headers", async () => {
    const metadata: AttachmentMetadata = {
      id: `att_${"a".repeat(32)}`, project: "workmory", status: "ready", sourceKind: "upload", filename: "note.txt",
      detectedMime: "text/plain", originalSize: 4, originalSha256: "hash",
      createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
    };
    const upload = vi.fn(async () => metadata);
    const attachments = {
      upload,
      getMetadata: async () => metadata,
      getOriginal: async () => ({ metadata, bytes: new TextEncoder().encode("body") }),
      getMarkdown: async () => ({ metadata, bytes: new TextEncoder().encode("# body") }),
      delete: async () => undefined,
    } as unknown as RequestServices["attachments"];
    const uploadResponse = await handleAttachmentRequest(new Request("https://api.example.com/v1/projects/workmory/attachments", {
      method: "POST",
      headers: headers({ "Content-Type": "text/plain", "Content-Disposition": "attachment; filename=note.txt", "Idempotency-Key": "upload-operation", "X-Content-SHA256": "hash" }),
      body: "body",
    }), runtime({ attachments }));
    expect(uploadResponse.status).toBe(201);
    expect(upload).toHaveBeenCalledWith(expect.objectContaining({ filename: "note.txt", idempotencyKey: "upload-operation" }));
    for (const content of ["original", "markdown"] as const) {
      const response = await handleAttachmentRequest(new Request(
        `https://api.example.com/v1/projects/workmory/attachments/${metadata.id}/content/${content}`, { headers: headers() },
      ), runtime({ attachments }));
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.get("content-disposition")).toContain("attachment");
      expect(response.headers.get("content-type")).toBe(content === "original" ? "application/octet-stream" : "text/markdown;charset=utf-8");
    }
  });

  it("returns 200 for idempotent replay and maps delete conflicts", async () => {
    const id = `att_${"b".repeat(32)}`;
    const attachments = {
      upload: async () => ({ reused: true, id }),
      delete: async () => { throw new AttachmentServiceError("ATTACHMENT_REFERENCED", 409, "referenced"); },
    } as unknown as RequestServices["attachments"];
    const replay = await handleAttachmentRequest(new Request("https://api.example.com/v1/projects/workmory/attachments", {
      method: "POST", headers: headers({ "Content-Disposition": "attachment; filename=note.txt", "Idempotency-Key": "replay-key" }), body: "body",
    }), runtime({ attachments }));
    expect(replay.status).toBe(200);
    const deleted = await handleAttachmentRequest(new Request(
      `https://api.example.com/v1/projects/workmory/attachments/${id}`, { method: "DELETE", headers: headers() },
    ), runtime({ attachments }));
    expect(deleted.status).toBe(409);
  });
});
