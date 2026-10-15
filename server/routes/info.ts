import { defineHandler } from "nitro/h3";
import { observeRequest } from "../http/observability";

export default defineHandler((event) => observeRequest("/info", () => {
  if (event.req.method !== "GET") {
    return new Response(null, { status: 405, headers: { Allow: "GET" } });
  }
  return {
    name: "workmory",
    version: "0.1.0",
    description: "Stateless OKF-compatible memory and retrieval service for agents.",
    endpoints: {
      mcp: "/mcp",
      health: "/health",
      info: "/info",
      agentSkills: "/.well-known/agent-skills/index.json",
    },
    authentication: {
      requirement: "Use exactly one credential source.",
      accessJwt: {
        headers: ["Authorization: Bearer <Access application JWT>", "Cf-Access-Jwt-Assertion: <Access application JWT>"],
      },
      rootKey: {
        header: "X-API-Key: <root key>",
        path: "/mcp/<root key>",
      },
    },
    usage: "Use stateless POST /mcp. Prefer MCP 2026-07-28; MCP 2025-11-25 is available only as a stateless POST fallback. Workmory verifies Access JWTs but does not issue OAuth or Access tokens. Sessions, SSE GET/DELETE, and resume are not supported.",
  };
}));
