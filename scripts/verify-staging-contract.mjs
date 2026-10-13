const baseUrlValue = process.env.STAGING_BASE_URL;

if (!baseUrlValue) {
  console.error("Usage: STAGING_BASE_URL=https://staging.example.com pnpm test:staging-contract");
  process.exit(2);
}

let baseUrl;
try {
  baseUrl = new URL(baseUrlValue);
  if (baseUrl.protocol !== "https:" || baseUrl.username || baseUrl.password || baseUrl.pathname !== "/" || baseUrl.search || baseUrl.hash) throw new Error();
} catch {
  console.error("STAGING_BASE_URL must be an HTTPS origin without credentials, query, or fragment");
  process.exit(2);
}

const checks = [
  { path: "/health", method: "GET", status: 200, validate: (response, body) => body?.status === "ok" && response.headers.get("content-type")?.includes("application/json") },
  { path: "/info", method: "GET", status: 200, validate: (_response, body) => body?.name === "workmory" && body?.endpoints?.mcp === "/mcp" },
  { path: "/mcp", method: "OPTIONS", status: 204, validate: (response) => response.headers.get("access-control-allow-origin") === "*" },
  { path: "/v1/projects", method: "OPTIONS", status: 204, validate: (response) => response.headers.get("access-control-allow-origin") === "*" },
  { path: "/mcp", method: "POST", status: 401, errorCode: "AUTH_REQUIRED" },
  { path: "/v1/projects", method: "GET", status: 401, errorCode: "AUTH_REQUIRED" },
  { path: "/v1/maintenance", method: "POST", status: 401, errorCode: "AUTH_REQUIRED" },
  { path: `/v1/projects/contract/attachments/att_${"0".repeat(32)}`, method: "GET", status: 401, errorCode: "AUTH_REQUIRED" },
];

let failed = false;
for (const check of checks) {
  try {
    const response = await fetch(new URL(check.path, baseUrl), {
      method: check.method,
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
    let matches = response.status === check.status;
    const body = check.errorCode || check.validate ? await response.json().catch(() => null) : null;
    if (matches && check.errorCode) matches = body?.error?.code === check.errorCode;
    if (matches && check.validate) matches = Boolean(check.validate(response, body));
    if (!matches) {
      failed = true;
      console.log(`FAIL ${check.method} ${check.path} (status ${response.status}, expected ${check.status})`);
    } else {
      console.log(`PASS ${check.method} ${check.path}`);
    }
  } catch (error) {
    failed = true;
    const reason = error instanceof Error && error.name === "TimeoutError" ? "timeout" : "network error";
    console.log(`FAIL ${check.method} ${check.path} (${reason})`);
  }
}

if (failed) process.exit(1);
