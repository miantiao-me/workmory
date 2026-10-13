import { describe, expect, it, vi } from "vitest";
import { ProjectDirectoryError } from "../server/application/project-directory";
import { handleProjectDirectoryRequest } from "../server/http/project-directory-handler";
import { headers, runtime } from "./fixtures/http";

describe("project directory HTTP route", () => {
  it("returns the authenticated owner's directory with private CORS headers", async () => {
    const list = vi.fn(async () => ({
      projects: [{
        project: "alpha",
        namespaces: ["default"],
        memoryCount: 2,
        statusCounts: { stable: 2 },
        lastMemoryUpdatedAt: "2026-01-01T00:00:00.000Z",
      }],
    }));
    const response = await handleProjectDirectoryRequest(new Request(
      "https://api.example.com/v1/projects?owner=other&project=ignored",
      { headers: headers({ Origin: "https://other.example" }) },
    ), runtime({ projectDirectory: { list } }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ projects: [{
      project: "alpha",
      namespaces: ["default"],
      memoryCount: 2,
      statusCounts: { stable: 2 },
      lastMemoryUpdatedAt: "2026-01-01T00:00:00.000Z",
    }] });
    expect(list).toHaveBeenCalledWith();
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.has("Access-Control-Allow-Credentials")).toBe(false);
  });

  it("supports preflight and rejects other methods with Allow", async () => {
    const options = await handleProjectDirectoryRequest(new Request("https://api.example.com/v1/projects", { method: "OPTIONS" }), runtime());
    expect(options.status).toBe(204);
    expect(options.headers.get("Access-Control-Allow-Methods")).toBe("GET, OPTIONS");
    expect(options.headers.get("Access-Control-Allow-Origin")).toBe("*");

    const post = await handleProjectDirectoryRequest(new Request("https://api.example.com/v1/projects", { method: "POST" }), runtime());
    expect(post.status).toBe(405);
    expect(post.headers.get("Allow")).toBe("GET, OPTIONS");
    expect(post.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("requires authentication", async () => {
    const response = await handleProjectDirectoryRequest(new Request("https://api.example.com/v1/projects"), runtime());
    expect(response.status).toBe(401);
  });

  it("maps directory size errors without exposing internals", async () => {
    const response = await handleProjectDirectoryRequest(
      new Request("https://api.example.com/v1/projects", { headers: headers() }),
      runtime({ projectDirectory: { list: async () => { throw new ProjectDirectoryError(); } } }),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: { code: "PROJECT_DIRECTORY_TOO_LARGE", message: "Project directory exceeds the supported size" },
    });
  });
});
