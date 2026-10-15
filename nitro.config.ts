import { fileURLToPath } from "node:url";
import { defineNitroConfig } from "nitro/config";

export default defineNitroConfig({
  preset: "cloudflare_module",
  renderer: {
    template: "web/index.html",
    static: true,
  },
  alias: {
    yaml: fileURLToPath(new URL("./browser/index.js", import.meta.resolve("yaml/package.json"))),
  },
  rollupConfig: {
    output: {
      inlineDynamicImports: true,
    },
  },
  serverDir: "server",
  handlers: [
    { route: "/.well-known/agent-skills/**", handler: "./server/http/agent-skills-handler" },
  ],
  experimental: {
    tasks: true,
  },
  scheduledTasks: {
    "*/5 * * * *": "maintenance:process",
  },
});
