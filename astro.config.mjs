import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";

export default defineConfig({
  output: "server",
  session: false,
  adapter: cloudflare({ imageService: "passthrough" }),
  integrations: [react()],
  vite: { resolve: { alias: { "@": new URL("./src", import.meta.url).pathname } } },
});
