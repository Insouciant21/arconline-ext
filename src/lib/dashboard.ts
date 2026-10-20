import type { Env } from "./environment";
import { Store } from "./store";
import { getConfig } from "./config";
import { activeJob } from "./jobs";
import type { DashboardPayload } from "./types";
export async function getDashboardPayload(env: Env): Promise<DashboardPayload> {
  const store = new Store(env);
  const [latest, history, job] = await Promise.all([store.latest(), store.history(), activeJob(env)]);
  const { timezone, cronExpression } = getConfig(env);
  return { latest, history, activeJob: job, scheduler: { timezone, cron: cronExpression } };
}
