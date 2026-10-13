import { defineHandler } from "nitro/h3";
import { observeRequest } from "../http/observability";

export default defineHandler((event) => observeRequest("/health", () => {
  if (event.req.method !== "GET") {
    return new Response(null, { status: 405, headers: { Allow: "GET" } });
  }
  return { status: "ok", version: "0.1.0" };
}));
