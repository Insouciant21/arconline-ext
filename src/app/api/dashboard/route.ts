import { getDashboardPayload } from "@/lib/dashboard";
import { errorResponse } from "@/lib/errors";
import { requireSession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireSession();
    return Response.json(await getDashboardPayload(), {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
