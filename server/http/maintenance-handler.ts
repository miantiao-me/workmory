import { z } from "zod";
import { authenticatedServices } from "./authenticated";
import { HttpError, jsonResponse } from "./errors";
import { handleRequest } from "./handler";
import { readBoundedJson } from "./read-bounded-json";
import { preflightResponse } from "./security";
import type { HandlerRuntime } from "./runtime";
import type { MaintenanceAction } from "./services";

const MAX_MAINTENANCE_BODY_BYTES = 1024;

const maintenanceBodySchema = z.strictObject({ action: z.enum(["process", "reindex", "status"]) });

async function readMaintenanceBody(request: Request): Promise<unknown> {
  return readBoundedJson(request, {
    maxBytes: MAX_MAINTENANCE_BODY_BYTES,
    tooLarge: { status: 413, code: "MAINTENANCE_BODY_TOO_LARGE", message: "Maintenance request body exceeds 1 KiB" },
    parseError: { status: 400, code: "INVALID_MAINTENANCE_REQUEST", message: "Maintenance request body is not valid JSON" },
  });
}

export async function handleMaintenanceRequest(request: Request, runtime: HandlerRuntime): Promise<Response> {
  return handleRequest("/v1/maintenance", async () => {
    if (request.method === "OPTIONS") return preflightResponse("POST, OPTIONS");
    if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST, OPTIONS" } });
    const { actor, services } = await authenticatedServices(request, runtime);
    if (actor.authKind !== "root") throw new HttpError(403, "ROOT_REQUIRED", "Root authentication is required");
    let action: MaintenanceAction = "process";
    if (request.body) {
      const parsed = maintenanceBodySchema.safeParse(await readMaintenanceBody(request));
      if (!parsed.success) {
        throw new HttpError(400, "INVALID_MAINTENANCE_REQUEST", "Maintenance action must be process, reindex, or status");
      }
      action = parsed.data.action;
    }
    return jsonResponse(await services.maintenance(action));
  });
}
