import { defineTask } from "nitro/task";
import type { RuntimeBindings } from "../../env";

interface CloudflareTaskContext {
  cloudflare?: {
    env?: RuntimeBindings;
    context?: ExecutionContext;
  };
}

export default defineTask({
  meta: {
    name: "maintenance:process",
    description: "Process semantic outbox, clean up stale attachments, canonical objects, and graph index entries",
  },
  async run({ context }) {
    const cf = (context as CloudflareTaskContext | undefined)?.cloudflare;
    const env = cf?.env;
    if (!env?.DB) {
      return { result: "skipped: no DB binding" };
    }
    const { createMaintenanceService } = await import("../../maintenance/maintenance-service");
    const result = await createMaintenanceService(env)("process");
    return { result: JSON.stringify(result) };
  },
});
