const ALLOWED_HEADERS =
  "Authorization, Cf-Access-Jwt-Assertion, X-API-Key, Content-Type, Content-Length, Content-Disposition, Idempotency-Key, X-Content-SHA256, MCP-Protocol-Version, MCP-Method, MCP-Name";

export function preflightResponse(methods: string): Response {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": methods,
      "Access-Control-Allow-Headers": ALLOWED_HEADERS,
    },
  });
}

export function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.delete("Access-Control-Allow-Credentials");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
