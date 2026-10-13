import { describe, expect, it, vi } from "vitest";
import { observeRequest, type RequestLog } from "../server/http/observability";

describe("request observability", () => {
  it("logs only anonymous bounded fields and ignores a supplied request id", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      const response = await observeRequest("/v1/projects/:project/attachments/:attachment", () => {
        throw Object.assign(new Error("secret body token owner@example.com"), {
          code: "REMOTE_FETCH_FAILED",
          status: 502,
          detail: { project: "private-project", token: "secret-token" },
        });
      }, () => Response.json({ error: { code: "REMOTE_FETCH_FAILED" } }, { status: 502 }));

      const log = info.mock.calls[0][0] as RequestLog;
      expect(Object.keys(log).sort()).toEqual([
        "dependency", "duration_ms", "error_code", "request_id", "route", "status",
      ]);
      expect(log).toMatchObject({
        route: "/v1/projects/:project/attachments/:attachment",
        status: 502,
        error_code: "REMOTE_FETCH_FAILED",
        dependency: "remote_https",
      });
      expect(log.request_id).toMatch(/^[0-9a-f-]{36}$/);
      expect(response.headers.get("X-Request-ID")).toBe(log.request_id);
      expect(JSON.stringify(log)).not.toMatch(/secret|private-project|owner@example\.com/i);
    } finally {
      info.mockRestore();
    }
  });

  it("records successful public routes without an error or dependency", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      await observeRequest("/health", () => ({ status: "ok" }));
      expect(info.mock.calls[0][0]).toMatchObject({
        route: "/health",
        status: 200,
        error_code: null,
        dependency: null,
      });
    } finally {
      info.mockRestore();
    }
  });
});
