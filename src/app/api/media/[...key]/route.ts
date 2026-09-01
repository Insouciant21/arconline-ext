import { getAsset } from "@/lib/r2";
import { errorResponse } from "@/lib/errors";
import { requireSession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ key: string[] }> },
) {
  try {
    await requireSession();
    const { key: parts } = await params;
    const key = parts.join("/");
    if (!key || key.includes("..") || key.startsWith("/") || key.includes("\\")) {
      return Response.json({ error: "Invalid asset key" }, { status: 400 });
    }
    const asset = await getAsset(key);
    const headers = new Headers({
      "cache-control": asset.cacheControl || "public, max-age=31536000, immutable",
      "content-type": asset.contentType,
    });
    if (asset.etag) headers.set("etag", asset.etag);
    return new Response(asset.body, { headers });
  } catch (error) {
    return errorResponse(error);
  }
}
