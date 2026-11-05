import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(import.meta.dirname, "migrations"));
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            SESSION_SECRET: "test-secret-test-secret-test-secret",
            TURNSTILE_SECRET_KEY: "test-turnstile-secret",
            TURNSTILE_SITE_KEY: "test-site-key",
            GOOGLE_CLIENT_ID: "test-client-id",
            GOOGLE_CLIENT_SECRET: "test-client-secret",
            DEV_LOGIN: "1",
          },
        },
      }),
    ],
    resolve: { alias: { "@shared": path.join(import.meta.dirname, "src/shared") } },
    test: { include: ["tests/**/*.test.ts"] },
  };
});
