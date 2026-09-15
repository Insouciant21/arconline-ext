import { requireSession } from "@/lib/auth";
import { errorResponse } from "@/lib/errors";
import { retryMediaSync } from "@/lib/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    await requireSession();
    return Response.json(await retryMediaSync());
  } catch (error) {
    return errorResponse(error);
  }
}
