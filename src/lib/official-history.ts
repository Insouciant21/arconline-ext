import { ArcaeaClient } from "./arcaea-client";
import { appendLog, mergeChartAliases, mergeOfficialPttHistory } from "./file-store";
import type { Best50Score } from "./types";

export async function importOfficialHistory(client?: ArcaeaClient, scores?: Best50Score[]) {
  try {
    const api = client ?? await ArcaeaClient.login();
    const result = await mergeOfficialPttHistory(await api.getPotentialHistory());
    await mergeChartAliases(scores ?? await api.getBest50());
    await appendLog({ scope: "b50", level: "success", action: "history-imported", message: `官网历史 PTT 同步成功，读取 ${result.received} 个点，本地累计 ${result.total} 个点。` });
    return result;
  } catch (error) {
    await appendLog({ scope: "b50", level: "error", action: "history-import-failed", message: "官网历史 PTT 同步失败，保留已有历史。" }).catch(() => undefined);
    throw error;
  }
}
