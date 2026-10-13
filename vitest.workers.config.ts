import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

const migrations = await readD1Migrations("./drizzle");
const upgradeBaseMigrations = migrations.slice(0, 9);
const upgradeMigration = migrations.slice(9);

export default defineConfig({
  plugins: [
    cloudflareTest({
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: migrations,
          UPGRADE_BASE_MIGRATIONS: upgradeBaseMigrations,
          UPGRADE_MIGRATION: upgradeMigration,
        },
        d1Databases: ["DB", "MIGRATION_DB"],
        r2Buckets: ["BUCKET"],
        // Keep local tests on the newest date supported by the pinned Workerd runtime.
        compatibilityDate: "2026-08-18",
        compatibilityFlags: ["global_fetch_strictly_public"],
      },
    }),
  ],
  test: {
    include: ["test/workers/**/*.test.ts"],
  },
});
