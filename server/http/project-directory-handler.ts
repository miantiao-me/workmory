import { authenticatedServices } from "./authenticated";
import { jsonResponse } from "./errors";
import { handleRequest } from "./handler";
import { preflightResponse } from "./security";
import type { HandlerRuntime } from "./runtime";

export async function handleProjectDirectoryRequest(request: Request, runtime: HandlerRuntime): Promise<Response> {
  return handleRequest("/v1/projects", async () => {
    if (request.method === "OPTIONS") return preflightResponse("GET, OPTIONS");
    if (request.method !== "GET") {
      return new Response(null, { status: 405, headers: { Allow: "GET, OPTIONS" } });
    }
    const { services } = await authenticatedServices(request, runtime);
    return jsonResponse(await services.projectDirectory.list());
  });
}
