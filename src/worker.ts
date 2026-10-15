import { handle } from "@astrojs/cloudflare/handler";
import type { Env, JobMessage } from "./lib/environment";
import { consume, enqueue, recover } from "./lib/jobs";
import { getConfig, getLocalDate } from "./lib/config";

export default {
  fetch(request, env, ctx) { return handle(request, env, ctx); },
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
