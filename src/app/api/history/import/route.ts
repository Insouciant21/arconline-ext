import { requireSession } from "@/lib/auth";
import { errorResponse } from "@/lib/errors";
import { importOfficialHistory } from "@/lib/official-history";
import { withFileLock } from "@/lib/file-store";

export const runtime = "nodejs";
export async function POST() {
  try {
    await requireSession();
    const result = await withFileLock("history-import", () => importOfficialHistory());
    return Response.json({ ...result, message: `已同步官网历史 PTT，共保存 ${result.total} 个原始数据点。` });
  } catch (error) { return errorResponse(error); }
}
