import { ArcaeaClient } from "./arcaea-client";
import { appendLog, mergeOfficialPttHistory } from "./file-store";

export async function importOfficialHistory(client?: ArcaeaClient) {
  try {
    const api = client ?? await ArcaeaClient.login();
    const result = await mergeOfficialPttHistory(await api.getPotentialHistory());
    await appendLog({ scope: "b50", level: "success", action: "history-imported", message: `官网历史 PTT 同步成功，读取 ${result.received} 个点，本地累计 ${result.total} 个点。` });
    return result;
  } catch (error) {
    await appendLog({ scope: "b50", level: "error", action: "history-import-failed", message: "官网历史 PTT 同步失败，保留已有历史。" }).catch(() => undefined);
    throw error;
  }
}
