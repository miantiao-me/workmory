import { describe, expect, it } from "vitest";
import { handleProjectDirectoryRequest } from "../server/http/project-directory-handler";
import { withCors } from "../server/http/security";
import { runtime } from "./fixtures/http";

describe("open request transport security", () => {
  it.each([
    "http://localhost:3000",
    "http://0.0.0.0:8787",
    "http://external.example",
    "https://external.example",
  ])("returns an origin-independent preflight for %s", async (origin) => {
    const request = new Request("https://api.example.com/v1/projects", { method: "OPTIONS", headers: { Origin: origin } });
    const response = await handleProjectDirectoryRequest(request, runtime());
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("access-control-allow-methods")).toBe("GET, OPTIONS");
    expect(response.headers.get("access-control-allow-headers")).toContain("MCP-Protocol-Version");
    expect(response.headers.has("access-control-allow-credentials")).toBe(false);
  });

  it("adds wildcard CORS to success and error responses without credentials", () => {
    for (const response of [new Response("ok"), Response.json({ error: true }, { status: 401 })]) {
      const cors = withCors(response);
      expect(cors.headers.get("access-control-allow-origin")).toBe("*");
      expect(cors.headers.has("access-control-allow-credentials")).toBe(false);
    }
  });
});
