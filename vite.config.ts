import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { cloudflare } from "@cloudflare/vite-plugin";

// The browser tests run a second server with their own data, so they can't touch your local groups.
const testState = process.env.E2E_STATE;

/** Link previews need a full URL, so index.html takes its domain from the route in wrangler.jsonc. */
function siteOrigin(): Plugin {
  const domain = /"pattern":\s*"([^"/*]+)"/.exec(readFileSync("wrangler.jsonc", "utf8"))?.[1];
  return {
    name: "site-origin",
    transformIndexHtml: (html) => html.replaceAll("%SITE_ORIGIN%", domain ? `https://${domain}` : ""),
  };
}

export default defineConfig({
  plugins: [siteOrigin(), react(), tailwindcss(), cloudflare(testState ? { persistState: { path: testState } } : {})],
  cacheDir: testState ? "node_modules/.vite-e2e" : undefined,
  resolve: { alias: { "@shared": "/src/shared" } },
  // A fixed port, because Google sign-in needs an exact redirect URI.
  server: { port: 5188, strictPort: true },
  preview: { port: 5188, strictPort: true },
});
