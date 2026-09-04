import { requireSession } from "@/lib/auth";
import { errorResponse } from "@/lib/errors";
import { runSync } from "@/lib/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await requireSession();
    return Response.json(await runSync("cron"));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  return GET(request);
}
