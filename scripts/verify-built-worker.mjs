import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const ROOT_API_KEY = "artifact-test-root-key-with-32-bytes";

function unusedBinding(name) {
  return new Proxy({}, {
    get() {
      throw new Error(`${name} binding was unexpectedly accessed`);
    },
  });
}

const env = {
  ROOT_API_KEY,
  EMBEDDING_MODEL: "artifact-test-embedding-model",
  EMBEDDING_DIMENSIONS: "768",
  VECTOR_INDEX_VERSION: "artifact-test-index-v1",
  DB: unusedBinding("DB"),
  BUCKET: unusedBinding("BUCKET"),
  VECTORIZE: unusedBinding("VECTORIZE"),
  AI: unusedBinding("AI"),
  ASSETS: unusedBinding("ASSETS"),
};

const context = {
  waitUntil() {},
  passThroughOnException() {},
};

async function request(worker, path, init) {
  return worker.fetch(new Request(`https://artifact.test${path}`, init), env, context);
}

async function assertAuthError(response, expectedCode) {
  assert.equal(response.status, 401);
  const body = await response.json();
  assert.equal(body?.error?.code, expectedCode);
}

async function verify() {
  for (const path of ["wrangler.jsonc", "wrangler.local.jsonc", "wrangler.production.jsonc", ".output/server/wrangler.json"]) {
    const config = JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), "utf8"));
    // Platform URL capture would expose credentials embedded in MCP paths.
    assert.equal(config.observability?.logs?.enabled, true, `${path} must retain application logs`);
    assert.equal(config.observability?.logs?.invocation_logs, false, `${path} must disable invocation URL logs`);
    assert.equal(config.observability?.traces?.enabled, false, `${path} must disable automatic URL traces`);
  }

  const module = await import(new URL("../.output/server/index.mjs", import.meta.url));
  const worker = module.default;
  assert.equal(typeof worker?.fetch, "function", "built worker must export a default fetch handler");

  assert.equal((await request(worker, "/health", { method: "GET" })).status, 200);
  for (const path of [
    "/.well-known/oauth-protected-resource",
    "/.well-known/oauth-protected-resource/mcp/fake-probe-key",
    "/.well-known/oauth-authorization-server",
    "/.well-known/oauth-authorization-server/mcp/fake-probe-key",
    "/.well-known/openid-configuration",
  ]) {
    for (const method of ["GET", "HEAD"]) {
      const response = await request(worker, path, { method });
      assert.equal(response.status, 404, `${method} discovery request must return 404`);
      assert.match(response.headers.get("Content-Type") ?? "", /^application\/json(?:;|$)/i);
      const body = await response.text();
      assert.equal(body.includes(path), false, "discovery response must not echo the request path");
      assert.equal(body.includes("fake-probe-key"), false, "discovery response must not echo a path credential");
      if (method === "GET") {
        assert.deepEqual(JSON.parse(body), {
          error: { code: "NOT_FOUND", message: "Route was not found" },
        });
      } else {
        assert.equal(body, "", "HEAD discovery response must not include a body");
      }
    }
  }
  assert.equal((await request(worker, "/v1/projects", { method: "OPTIONS" })).status, 204);
  assert.equal((await request(worker, "/mcp", { method: "OPTIONS" })).status, 204);
  assert.equal((await request(worker, `/mcp/${ROOT_API_KEY}`, { method: "OPTIONS" })).status, 204);
  for (const method of ["GET", "DELETE"]) {
    assert.equal((await request(worker, `/mcp/${ROOT_API_KEY}`, { method })).status, 405);
  }
  for (const path of ["/mcp/a/b", "/mcp//"]) {
    const response = await request(worker, path, { method: "POST" });
    assert.equal(response.status, 404);
    assert.equal((await response.json())?.error?.code, "NOT_FOUND");
  }
  for (const key of [ROOT_API_KEY, "artifact-test-encoded-root-key-32-bytes/+%2F"]) {
    env.ROOT_API_KEY = key;
    const response = await request(worker, `/mcp/${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "MCP-Protocol-Version": "2026-07-28", "MCP-Method": "tools/list" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1, method: "tools/list",
        params: { _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientInfo": { name: "artifact-test", version: "1" },
          "io.modelcontextprotocol/clientCapabilities": {},
        } },
      }),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json())?.result?.tools?.length, 14);
    assert.equal(response.headers.has("mcp-session-id"), false);
  }
  env.ROOT_API_KEY = ROOT_API_KEY;
  await assertAuthError(await request(worker, "/mcp/artifact-test-invalid-key", { method: "POST" }), "AUTH_INVALID");
  // Nitro rejects invalid URL encoding before the MCP handler runs.
  const malformed = await request(worker, "/mcp/%ZZ", { method: "POST" });
  assert.equal(malformed.status, 400);
  const malformedBody = await malformed.text();
  assert.equal(malformedBody.includes("%ZZ"), false);
  assert.equal(malformedBody.includes("https://artifact.test/mcp/%ZZ"), false);
  assert.equal(malformedBody.includes("stack"), false);

  await assertAuthError(await request(worker, "/v1/projects", { method: "GET" }), "AUTH_REQUIRED");
  await assertAuthError(await request(worker, "/v1/projects", {
    method: "GET",
    headers: { "X-API-Key": "artifact-test-invalid-key" },
  }), "AUTH_INVALID");
}

try {
  await verify();
  console.log("Built Worker artifact verification passed");
} catch (error) {
  const message = error instanceof Error ? error.message : "unknown failure";
  console.error(`Built Worker artifact verification failed: ${message}`);
  process.exitCode = 1;
}
