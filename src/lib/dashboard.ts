import type { Env } from "./environment";
import { Store } from "./store";
import { getConfig } from "./config";
import { activeJob } from "./jobs";
import type { DashboardPayload } from "./types";
export async function getDashboardPayload(env: Env): Promise<DashboardPayload> {
  const store = new Store(env);
  const [latest, history, job] = await Promise.all([store.latest(), store.history(), activeJob(env)]);
  return { latest, history, activeJob: job, scheduler: { timezone: getConfig(env).timezone, cron: "59 15 * * *" } };
}
