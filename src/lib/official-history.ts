import { ArcaeaClient } from "./arcaea-client";
import { Store } from "./store";
export async function importOfficialHistory(store: Store, client: ArcaeaClient, { refreshAliases = true } = {}) {
  const result = await store.mergeOfficial(await client.getPotentialHistory());
  if (refreshAliases) await store.aliases(await client.getBest50());
  await store.log({ scope: "b50", level: "success", action: "history-imported", message: `官网历史 PTT 同步成功，读取 ${result.received} 个点，累计 ${result.total} 个点。` });
  return result;
}
