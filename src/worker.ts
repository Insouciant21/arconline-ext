import { handle } from "@astrojs/cloudflare/handler";
import type { Env, JobMessage } from "./lib/environment";
import { consume, enqueue, recover } from "./lib/jobs";
import { getConfig, getLocalDate } from "./lib/config";

const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'none'",
  "connect-src 'self'",
  "script-src-elem 'self'",
  "font-src 'self' https://fonts.gstatic.com",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "img-src 'self' data:",
  "manifest-src 'self'",
  "object-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
].join('; ');

const securityHeaders = {
  "content-security-policy": contentSecurityPolicy,
  "permissions-policy": "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
  "referrer-policy": "strict-origin-when-cross-origin",
  "strict-transport-security": "max-age=31536000",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};

function withSecurityHeaders(response: Response) {
  const secured = new Response(response.body, response);
  for (const [name, value] of Object.entries(securityHeaders)) secured.headers.set(name, value);
  return secured;
}

export default {
  async fetch(request, env, ctx) {
    return withSecurityHeaders(await handle(request, env, ctx));
  },
  async queue(batch: MessageBatch<JobMessage>, env) { await consume(env, batch); },
  async scheduled(controller, env) {
    if (env.MUTATIONS_ENABLED === "false") return;
    if (controller.cron === "59 15 * * *" && env.DAILY_SYNC_ENABLED === "true") {
      const date = getLocalDate(controller.scheduledTime, getConfig(env).timezone);
      await enqueue(env, "sync", "daily", `daily:${date}`);
    }
    await recover(env);
  },
} satisfies ExportedHandler<Env, JobMessage>;
