import { authenticateRequest } from "../auth/authenticate";
import type { ActorContext } from "../domain/identity";
import { parseEnv } from "../env";
import { createRequestServices, type RequestServices } from "./services";
import { HttpError } from "./errors";
import type { HandlerRuntime } from "./runtime";

export async function authenticatedServices(request: Request, runtime: HandlerRuntime): Promise<{
  actor: ActorContext;
  services: RequestServices;
}> {
  const config = validatedRuntimeEnv(runtime);
  const actor = await authenticateRequest(request, config, runtime.accessVerifier);
  const services = runtime.createServices?.(actor) ?? createRequestServices(runtime.env, actor, runtime.defer);
  return { actor, services };
}

function validatedRuntimeEnv(runtime: HandlerRuntime): ReturnType<typeof parseEnv> {
  try {
    return parseEnv(runtime.env);
  } catch {
    throw new HttpError(503, "CONFIG_INVALID", "Service configuration is invalid");
  }
}
