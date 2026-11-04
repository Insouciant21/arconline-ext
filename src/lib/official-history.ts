import { ArcaeaClient } from "./arcaea-client";
import { Store } from "./store";
import { measure, type Profiler } from "./profiling";
export async function importOfficialHistory(store: Store, client: ArcaeaClient, { refreshAliases = true, profiling }: { refreshAliases?: boolean; profiling?: Profiler } = {}) {
  const points = await client.getPotentialHistory();
  const result = await measure(profiling, "d1.history.merge", () => store.mergeOfficial(points));
  if (refreshAliases) await store.aliases(await client.getBest50());
  await measure(profiling, "d1.history.log", () => store.log({ scope: "b50", level: "success", action: "history-imported", message: `官网历史 PTT 同步成功，读取 ${result.received} 个点，累计 ${result.total} 个点。` }));
  return result;
}
