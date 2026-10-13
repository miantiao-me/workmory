import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));
const browserEvents = fileURLToPath(new URL("./node_modules/events/events.js", import.meta.url));
const browserEventAliases = [
  { find: /^events$/, replacement: browserEvents },
  { find: /^node:events$/, replacement: browserEvents },
];

export default defineConfig({
  root: fileURLToPath(new URL("./web", import.meta.url)),
  plugins: [
    react(),
    tailwindcss(),
    nitro({ rootDir: projectRoot }),
    {
      name: "browser-events-alias",
      enforce: "post",
      configResolved(config) {
        config.resolve.alias.unshift(...browserEventAliases);
      },
    },
  ],
  resolve: {
    alias: [
      ...browserEventAliases,
      { find: "@", replacement: fileURLToPath(new URL("./web", import.meta.url)) },
    ],
  },
});
