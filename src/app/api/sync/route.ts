import { requireSession } from "@/lib/auth";
import { errorResponse } from "@/lib/errors";
import { runSync } from "@/lib/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    await requireSession();
    const snapshot = await runSync("manual");
    return Response.json({
      snapshot,
      message: "B50 已获取、备份至 R2 并显示，潜力值图片与曲绘正在后台抓取并上传 R2。",
    });
  } catch (error) {
    return errorResponse(error);
  }
}
