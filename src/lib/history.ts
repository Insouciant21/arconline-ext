import type { Env } from "./environment";
import type { HistoryPayload } from "./types";
import { Store } from "./store";
export async function getHistoryPayload(env: Env): Promise<HistoryPayload> {
  const store = new Store(env);
  const [snapshots, detail, backedUp] = await Promise.all([
    store.snapshotSummaries(),
    store.latest(),
    store.sql("SELECT COUNT(*) AS n FROM snapshots WHERE backed_up=1").first<number>("n"),
  ]);
  return { snapshots, detail, sources: { d1Count: snapshots.length, r2Count: backedUp || 0, r2Available: Boolean(env.ARCHIVE) } };
}
