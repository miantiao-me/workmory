import { describe, expect, it, vi } from "vitest";
import { handleMaintenanceRequest } from "../server/http/maintenance-handler";
import { headers, runtime } from "./fixtures/http";

const STATUS_RESULT = {
  outbox: { pending: 5, due: 2, processing: 3, stale: 1, retrying: 2 },
  attachments: { processing: 4, staleProcessing: 1, failed: 2, deleting: 1 },
  reindex: { candidates: 7 },
  graph: { pending: 6, retrying: 2, truncated: 1 },
  vectorCleanup: { pending: 4, due: 2, processing: 2, stale: 1, retrying: 1 },
  vectorStaging: { total: 3, abandoned: 1 },
  canonicalObjectStaging: { pending: 2, due: 1, processing: 1, stale: 1, retrying: 1 },
};

describe("maintenance route", () => {
  it("is root-only and returns maintenance counts", async () => {
    const root = await handleMaintenanceRequest(
      new Request("https://api.example.com/v1/maintenance", { method: "POST", headers: headers() }), runtime(),
    );
    expect(root.status).toBe(200);
    expect(await root.json()).toEqual({
      outbox: { claimed: 1, succeeded: 1, failed: 0 },
      vectorCleanup: { claimed: 0, succeeded: 0, failed: 0 },
      canonicalCleanup: { claimed: 0, deleted: 0, failed: 0 },
      attachments: { markedFailed: 0, deleted: 1 },
      graph: { selected: 0, succeeded: 0, failed: 0, stale: 0 },
    });
    const access = await handleMaintenanceRequest(
      new Request("https://api.example.com/v1/maintenance", { method: "POST", headers: { Authorization: "Bearer subject" } }), runtime(),
    );
    expect(access.status).toBe(403);
  });

  it("dispatches status and preserves its aggregate-only contract", async () => {
    const maintenance = vi.fn(async () => STATUS_RESULT);
    const response = await handleMaintenanceRequest(
      new Request("https://api.example.com/v1/maintenance", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ action: "status" }),
      }),
      runtime({ maintenance }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual(STATUS_RESULT);
    expect(maintenance).toHaveBeenCalledOnce();
    expect(maintenance).toHaveBeenCalledWith("status");
  });

  it("rejects Access before status execution", async () => {
    const maintenance = vi.fn();
    const response = await handleMaintenanceRequest(
      new Request("https://api.example.com/v1/maintenance", {
        method: "POST",
        headers: { Authorization: "Bearer subject", "Content-Type": "application/json" },
        body: JSON.stringify({ action: "status" }),
      }),
      runtime({ maintenance }),
    );

    expect(response.status).toBe(403);
    expect(maintenance).not.toHaveBeenCalled();
  });

  it.each([
    { action: "unknown" },
    { action: null },
    { action: "status", dry_run: true },
    { action: "status", extra: "field" },
    ["status"],
  ])("rejects a non-strict maintenance body: %j", async (body) => {
    const maintenance = vi.fn();
    const response = await handleMaintenanceRequest(
      new Request("https://api.example.com/v1/maintenance", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(body),
      }),
      runtime({ maintenance }),
    );

    expect(response.status).toBe(400);
    expect(maintenance).not.toHaveBeenCalled();
  });

  it("rejects an oversized body after root authentication", async () => {
    const maintenance = vi.fn();
    const response = await handleMaintenanceRequest(
      new Request("https://api.example.com/v1/maintenance", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ action: "status", padding: "x".repeat(1024) }),
      }),
      runtime({ maintenance }),
    );

    expect(response.status).toBe(413);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(await response.json()).toEqual({
      error: { code: "MAINTENANCE_BODY_TOO_LARGE", message: "Maintenance request body exceeds 1 KiB" },
    });
    expect(maintenance).not.toHaveBeenCalled();
  });

  it("authenticates before rejecting an oversized body", async () => {
    const maintenance = vi.fn();
    const response = await handleMaintenanceRequest(
      new Request("https://api.example.com/v1/maintenance", {
        method: "POST",
        headers: { Authorization: "Bearer subject", "Content-Type": "application/json" },
        body: "x".repeat(1025),
      }),
      runtime({ maintenance }),
    );

    expect(response.status).toBe(403);
    expect(maintenance).not.toHaveBeenCalled();
  });
});
