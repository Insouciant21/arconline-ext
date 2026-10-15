import { ArcaeaClient } from "./arcaea-client";
import { Store } from "./store";
import type { Best50Score } from "./types";
export async function importOfficialHistory(store: Store, client: ArcaeaClient, scores?: Best50Score[]) {
  const result = await store.mergeOfficial(await client.getPotentialHistory());
  await store.aliases(scores ?? await client.getBest50());
  await store.log({ scope: "b50", level: "success", action: "history-imported", message: `官网历史 PTT 同步成功，读取 ${result.received} 个点，累计 ${result.total} 个点。` });
  return result;
}
