import { describe, expect, it } from "vitest";
import healthHandler from "../server/routes/health";
import infoHandler from "../server/routes/info";
import fallbackHandler from "../server/routes/v1/[...path]";

describe("health status", () => {
  it("contains only public service status", async () => {
    const healthStatus = await healthHandler({ req: new Request("https://example.com/health") } as never);
    expect(healthStatus).toEqual({ status: "ok", version: "0.1.0" });
    expect(healthStatus).not.toHaveProperty("env");
  });

  it("rejects non-GET methods instead of falling through to the SPA", async () => {
    const response = await healthHandler({ req: new Request("https://example.com/health", { method: "POST" }) } as never);
    expect(response).toBeInstanceOf(Response);
    expect((response as Response).status).toBe(405);
    expect((response as Response).headers.get("Allow")).toBe("GET");
  });
});

describe("service info", () => {
  it("exposes discovery at /info with the core API endpoints", async () => {
    const info = await infoHandler({ req: new Request("https://example.com/info") } as never);
    expect(info).toMatchObject({
      name: "workmory",
      endpoints: { mcp: "/mcp", health: "/health", info: "/info", agentSkills: "/.well-known/agent-skills/index.json" },
      authentication: { rootKey: { header: "X-API-Key: <root key>" } },
    });
  });

  it("rejects non-GET methods instead of falling through to the SPA", async () => {
    const response = await infoHandler({ req: new Request("https://example.com/info", { method: "POST" }) } as never);
    expect(response).toBeInstanceOf(Response);
    expect((response as Response).status).toBe(405);
    expect((response as Response).headers.get("Allow")).toBe("GET");
  });
});

describe("v1 fallback", () => {
  it.each(["GET", "POST", "DELETE"])("returns a JSON 404 for unknown %s routes", async (method) => {
    const response = await fallbackHandler({
      req: new Request("https://arbitrary.example/v1/unknown/path", { method }),
    } as never) as Response;
    expect(response.status).toBe(404);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(await response.json()).toEqual({ error: { code: "NOT_FOUND", message: "Route was not found" } });
  });
});
