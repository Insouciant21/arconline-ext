import cron from "node-cron";
import { config } from "./config";
import { runSync } from "./sync";

const globalState = globalThis as typeof globalThis & {
  arcaeaB50Scheduler?: ReturnType<typeof cron.schedule>;
};

export function startDailyScheduler() {
  if (process.env.NODE_ENV === "test" || globalState.arcaeaB50Scheduler) return;
  globalState.arcaeaB50Scheduler = cron.schedule(
    config.cronExpression,
    async () => {
      try {
        console.info(`[scheduler] daily sync started (${config.timezone})`);
        await runSync("daily");
        console.info("[scheduler] daily sync completed");
      } catch (error) {
        console.error("[scheduler] daily sync failed", error);
      }
    },
    { timezone: config.timezone },
  );
  console.info(`[scheduler] registered ${config.cronExpression} ${config.timezone}`);
}
