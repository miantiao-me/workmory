import assert from "node:assert/strict";

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
  const module = await import(new URL("../.output/server/index.mjs", import.meta.url));
  const worker = module.default;
  assert.equal(typeof worker?.fetch, "function", "built worker must export a default fetch handler");

  assert.equal((await request(worker, "/health", { method: "GET" })).status, 200);
  assert.equal((await request(worker, "/v1/projects", { method: "OPTIONS" })).status, 204);
  assert.equal((await request(worker, "/mcp", { method: "OPTIONS" })).status, 204);

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
