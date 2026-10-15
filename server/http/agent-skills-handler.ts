import { defineHandler } from "nitro/h3";
import { useStorage } from "nitro/storage";
import { parseDocument } from "yaml";
import { sha256Hex } from "../shared/crypto";

const BASE = "/.well-known/agent-skills";
const SKILL_URL = `${BASE}/workmory-memory/SKILL.md`;
const ALLOW = "GET, HEAD, OPTIONS";

export default defineHandler(async (event) => {
  const request = event.req;
  const path = new URL(request.url).pathname;
  const headers = new Headers({
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json;charset=UTF-8",
  });
  const error = (status: number, code: string, message: string) => {
    headers.set("Content-Type", "application/json;charset=UTF-8");
    headers.set("Cache-Control", "no-store");
    return new Response(
      request.method === "HEAD" ? null : JSON.stringify({ error: { code, message } }),
      { status, headers },
    );
  };
  if (path !== `${BASE}/index.json` && path !== SKILL_URL) {
    return error(404, "NOT_FOUND", "Route was not found");
  }
  headers.set("Allow", ALLOW);
  if (request.method === "OPTIONS") {
    headers.set("Access-Control-Allow-Methods", ALLOW);
    headers.set("Access-Control-Allow-Headers", "Content-Type");
    return new Response(null, { status: 204, headers });
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return error(405, "METHOD_NOT_ALLOWED", "Method is not allowed");
  }

  try {
    const raw = await useStorage("assets:server").getItemRaw<string | Uint8Array>(
      "agent-skills/workmory-memory/SKILL.md",
    );
    if (raw === null) {
      return error(404, "NOT_FOUND", "Route was not found");
    }
    // Nitro's filesystem and bundled asset drivers return different raw types.
    const bytes = typeof raw === "string" ? new TextEncoder().encode(raw) : new Uint8Array(raw);
    if (path === SKILL_URL) {
      headers.set("Content-Type", "text/markdown;charset=UTF-8");
      headers.set("Cache-Control", "public, max-age=300");
      return new Response(request.method === "HEAD" ? null : bytes, { headers });
    }

    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(new TextDecoder().decode(bytes));
    if (!frontmatter) throw new Error("Skill frontmatter is missing");
    const document = parseDocument(frontmatter[1], { schema: "core", customTags: [] });
    if (document.errors.length) throw new Error("Skill frontmatter is invalid");
    const metadata = document.toJS({ maxAliasCount: 0 });
    if (metadata?.name !== "workmory-memory" || typeof metadata.description !== "string"
      || !metadata.description.trim() || metadata.description.length > 1024) {
      throw new Error("Skill metadata is invalid");
    }
    const digest = `sha256:${await sha256Hex(bytes)}`;
    const body = JSON.stringify({
      $schema: "https://schemas.agentskills.io/discovery/0.2.0/schema.json",
      skills: [{ name: metadata.name, type: "skill-md", description: metadata.description, url: SKILL_URL, digest }],
    });
    headers.set("Cache-Control", "public, max-age=300");
    return new Response(request.method === "HEAD" ? null : body, { headers });
  } catch {
    return error(500, "INTERNAL_ERROR", "Skill is unavailable");
  }
});
