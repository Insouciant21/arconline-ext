import { requireSession } from "@/lib/auth";
import { errorResponse } from "@/lib/errors";
import { runSync } from "@/lib/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    await requireSession();
    return Response.json(await runSync("manual"));
  } catch (error) {
    return errorResponse(error);
  }
}
