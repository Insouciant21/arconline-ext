import { requireSession } from "@/lib/auth";
import { errorResponse } from "@/lib/errors";
import { runSync } from "@/lib/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await requireSession();
    const snapshot = await runSync("cron");
    return Response.json({
      snapshot,
      message: "每日 B50 已获取并备份至 R2，潜力值图片与曲绘已进入后台媒体任务。",
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  return GET(request);
}
