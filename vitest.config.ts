import { defineConfig } from "vitest/config";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
export default defineConfig({
  plugins: [cloudflareTest({ miniflare: {
    compatibilityDate: "2026-10-15", compatibilityFlags: ["nodejs_compat"],
    d1Databases: ["DB"], r2Buckets: ["ARCHIVE"],
    bindings: { TEST_MIGRATIONS: await readD1Migrations("./migrations") },
  } })],
  test: { include: ["test/**/*.test.ts"] },
});
