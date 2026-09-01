import { config } from "./config";
import { readLatest, readPttHistory } from "./file-store";
import type { DashboardPayload } from "./types";

export async function getDashboardPayload(): Promise<DashboardPayload> {
  const [latest, history] = await Promise.all([
    readLatest(),
    readPttHistory(),
  ]);
  return {
    latest,
    history,
    scheduler: {
      timezone: config.timezone,
      cron: config.cronExpression,
    },
  };
}
