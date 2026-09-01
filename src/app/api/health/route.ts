import { isR2Configured } from "@/lib/config";
import { requireSession } from "@/lib/auth";
import { errorResponse } from "@/lib/errors";

export const runtime = "nodejs";

export async function GET() {
  try {
    await requireSession();
    return Response.json({
      ok: true,
      r2Configured: isR2Configured(),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
