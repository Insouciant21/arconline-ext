import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";
import { configPath } from "./scripts/lib/deployment-config.mjs";

export default defineConfig({
  output: "server",
  session: false,
  adapter: cloudflare({ imageService: "passthrough", configPath: configPath() }),
  integrations: [react()],
  vite: { resolve: { alias: { "@": new URL("./src", import.meta.url).pathname } } },
});
