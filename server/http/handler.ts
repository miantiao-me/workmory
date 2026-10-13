import { errorResponse } from "./errors";
import { observeRequest } from "./observability";
import { withCors } from "./security";

/**
 * Wraps a route handler with request observability, CORS, and error-to-HTTP
 * translation. Handlers return a plain Response; the wrapper adds CORS.
 * OPTIONS preflight stays caller-owned so each route keeps its method set.
 */
export async function handleRequest(route: string, handler: () => Promise<Response>): Promise<Response> {
  return observeRequest(route, async () => withCors(await handler()), (error) => withCors(errorResponse(error)));
}
