import type { AccessTokenVerifier } from "../auth/types";
import type { RequestServices } from "./services";
import type { RuntimeBindings } from "../env";
import type { ActorContext } from "../domain/identity";

export interface HandlerRuntime {
  env: RuntimeBindings;
  defer: (promise: Promise<unknown>) => void;
  accessVerifier?: AccessTokenVerifier;
  createServices?: (actor: ActorContext) => RequestServices;
}

export interface NitroCloudflareRequest extends Request {
  runtime: {
    cloudflare: {
      env: RuntimeBindings;
      context: ExecutionContext;
    };
  };
}

export function runtimeFromNitroRequest(request: NitroCloudflareRequest): HandlerRuntime {
  const cloudflare = request.runtime.cloudflare;
  return {
    env: cloudflare.env,
    defer: (promise) => cloudflare.context.waitUntil(promise),
  };
}
