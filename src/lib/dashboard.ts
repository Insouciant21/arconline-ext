import type { Env } from "./environment";
import { Store } from "./store";
import { getConfig } from "./config";
import { activeJob } from "./jobs";
import { publicAssetUrl } from "./r2";
import { readCachedGameVersion } from "./arcaea-version";
import type { DashboardPayload, StoredUser } from "./types";
export async function getDashboardPayload(env: Env): Promise<DashboardPayload> {
  const store = new Store(env);
  const [latest, history, job, profiles, version] = await Promise.all([
    store.latest(), store.history(), activeJob(env), store.cache<StoredUser>("score-export", ["profile"]), readCachedGameVersion(env),
  ]);
  const stored = profiles.profile ?? latest?.user;
  const user = stored ? { ...stored, ...(stored.avatarImageKey ? { avatarImageUrl: publicAssetUrl(env, stored.avatarImageKey) } : {}) } : null;
  const { timezone, cronExpression } = getConfig(env);
  return { user, latest, history, activeJob: job, version, scheduler: { timezone, cron: cronExpression } };
}
