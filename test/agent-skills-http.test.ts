import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { parse } from "yaml";

const { getItemRaw } = vi.hoisted(() => ({ getItemRaw: vi.fn() }));
vi.mock("nitro/storage", () => ({ useStorage: () => ({ getItemRaw }) }));
import handler from "../server/http/agent-skills-handler";

const base = "/.well-known/agent-skills";
const skillPath = `${base}/workmory-memory/SKILL.md`;
const source = await readFile(new URL("../server/assets/agent-skills/workmory-memory/SKILL.md", import.meta.url));
const metadata = parse(/^---\n([\s\S]*?)\n---\n/.exec(source.toString())![1]);
const request = (path: string, method = "GET") => handler({ req: new Request(`https://example.com${path}`, { method }) } as never) as Promise<Response>;

function expectCors(response: Response) {
  expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  expect(response.headers.has("Access-Control-Allow-Credentials")).toBe(false);
}

async function expectUnavailable(response: Response, method: string) {
  expect(response.status).toBe(500);
  expectCors(response);
  expect(response.headers.get("Content-Type")).toBe("application/json;charset=UTF-8");
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  if (method === "HEAD") {
    expect(await response.text()).toBe("");
  } else {
    expect(await response.json()).toEqual({ error: { code: "INTERNAL_ERROR", message: "Skill is unavailable" } });
  }
}

describe("public agent skill discovery", () => {
  it.each(["string", "bytes"])("serves unchanged source and matching discovery metadata from %s assets without business bindings", async (type) => {
    getItemRaw.mockResolvedValue(type === "string" ? source.toString() : new Uint8Array(source));
    const index = await request(`${base}/index.json`);
    const skill = await request(skillPath);
    for (const response of [index, skill]) {
      expect(response.status).toBe(200);
      expectCors(response);
      expect(response.headers.get("Cache-Control")).toBe("public, max-age=300");
    }
    expect(index.headers.get("Content-Type")).toBe("application/json;charset=UTF-8");
    expect(skill.headers.get("Content-Type")).toBe("text/markdown;charset=UTF-8");
    const bytes = Buffer.from(await skill.arrayBuffer());
    expect(bytes).toEqual(source);
    expect(await index.json()).toEqual({
      $schema: "https://schemas.agentskills.io/discovery/0.2.0/schema.json",
      skills: [{ name: metadata.name, type: "skill-md", description: metadata.description, url: skillPath,
        digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}` }],
    });
    expect(getItemRaw).toHaveBeenCalledWith("agent-skills/workmory-memory/SKILL.md");
  });

  it("returns bodyless HEAD responses with corresponding GET headers, including unknown files", async () => {
    getItemRaw.mockResolvedValue(source.toString());
    for (const path of [`${base}/index.json`, skillPath, `${base}/unknown/SKILL.md`]) {
      const get = await request(path);
      const head = await request(path, "HEAD");
      expect(head.status).toBe(get.status);
      expect(head.headers.get("Content-Type")).toBe(get.headers.get("Content-Type"));
      expect(head.headers.get("Cache-Control")).toBe(get.headers.get("Cache-Control"));
      expectCors(head);
      expect(await head.text()).toBe("");
    }
  });

  it("returns fixed JSON 404 without reflecting unknown paths or reading assets", async () => {
    getItemRaw.mockClear();
    for (const path of [`${base}/private-probe/SKILL.md`, `${skillPath}/extra`, `${base}/index.json/`]) {
      const response = await request(path);
      expect(response.status).toBe(404);
      expectCors(response);
      expect(response.headers.get("Content-Type")).toContain("application/json");
      expect(await response.json()).toEqual({ error: { code: "NOT_FOUND", message: "Route was not found" } });
    }
    expect(getItemRaw).not.toHaveBeenCalled();
  });

  it("returns fixed errors when asset loading rejects for GET and HEAD", async () => {
    getItemRaw.mockRejectedValue(new Error("private asset storage failure"));
    for (const path of [`${base}/index.json`, skillPath]) {
      for (const method of ["GET", "HEAD"]) {
        await expectUnavailable(await request(path, method), method);
      }
    }
  });

  it.each([
    ["missing frontmatter", "# Private skill content"],
    ["invalid YAML", "---\nname: [private-invalid\n---\n"],
    ["invalid name", "---\nname: private-skill\ndescription: valid\n---\n"],
    ["non-string description", "---\nname: workmory-memory\ndescription: 123\n---\n"],
    ["blank description", "---\nname: workmory-memory\ndescription: '   '\n---\n"],
    ["oversized description", `---\nname: workmory-memory\ndescription: ${"x".repeat(1025)}\n---\n`],
    ["null metadata", "---\nnull\n---\n"],
    ["YAML alias", "---\nname: workmory-memory\ndescription: &private valid\nextra: *private\n---\n"],
  ])("returns fixed errors for %s for GET and HEAD", async (_label, asset) => {
    getItemRaw.mockResolvedValue(asset);
    for (const method of ["GET", "HEAD"]) {
      await expectUnavailable(await request(`${base}/index.json`, method), method);
    }
  });

  it("returns fixed errors when digest computation rejects for GET and HEAD", async () => {
    getItemRaw.mockResolvedValue(source.toString());
    const digest = vi.spyOn(crypto.subtle, "digest").mockRejectedValue(new Error("private digest failure"));
    try {
      for (const method of ["GET", "HEAD"]) {
        await expectUnavailable(await request(`${base}/index.json`, method), method);
      }
    } finally {
      digest.mockRestore();
    }
  });

  it("returns fixed 404 for null assets for GET and HEAD", async () => {
    getItemRaw.mockResolvedValue(null);
    for (const path of [`${base}/index.json`, skillPath]) {
      for (const method of ["GET", "HEAD"]) {
        const response = await request(path, method);
        expect(response.status).toBe(404);
        expectCors(response);
        expect(response.headers.get("Content-Type")).toBe("application/json;charset=UTF-8");
        expect(response.headers.get("Cache-Control")).toBe("no-store");
        if (method === "HEAD") {
          expect(await response.text()).toBe("");
        } else {
          expect(await response.json()).toEqual({ error: { code: "NOT_FOUND", message: "Route was not found" } });
        }
      }
    }
  });

  it("handles unsupported methods and preflight without reading assets", async () => {
    getItemRaw.mockClear();
    for (const path of [`${base}/index.json`, skillPath]) {
      for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
        const response = await request(path, method);
        expect(response.status).toBe(405);
        expect(response.headers.get("Allow")).toBe("GET, HEAD, OPTIONS");
        expectCors(response);
        expect(await response.json()).toEqual({ error: { code: "METHOD_NOT_ALLOWED", message: "Method is not allowed" } });
      }
      const options = await request(path, "OPTIONS");
      expect(options.status).toBe(204);
      expect(options.headers.get("Allow")).toBe("GET, HEAD, OPTIONS");
      expect(options.headers.get("Access-Control-Allow-Methods")).toBe("GET, HEAD, OPTIONS");
      expect(options.headers.get("Access-Control-Allow-Headers")).toBe("Content-Type");
      expectCors(options);
      expect(await options.text()).toBe("");
    }
    expect(getItemRaw).not.toHaveBeenCalled();
  });
});
