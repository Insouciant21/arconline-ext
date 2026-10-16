import type { Env } from "./environment";
import { AppError } from "./errors";

const TTL = 3600;
type Background = Pick<ExecutionContext, "waitUntil">;

// Call only after authenticating the request. Cached bytes are shared internally;
// the response sent to the browser is always private and varies by login cookie.
export async function serveMedia(env: Env, request: Request, background?: Background): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD")
    throw new AppError("GET, HEAD", 405, "METHOD_NOT_ALLOWED");
  let key: string;
  try { key = decodeURIComponent(new URL(request.url).pathname.slice("/api/media/".length)); }
  catch { throw new AppError("无效的媒体路径。", 400, "INVALID_ASSET_KEY"); }
  if (!key || key.includes("..") || key.startsWith("/") || key.includes("\\") || !/^(charts|characters|potential)\//.test(key))
    throw new AppError("无效的媒体路径。", 400, "INVALID_ASSET_KEY");

  const url = new URL(request.url);
  url.pathname = `/api/media/${key.split("/").map(encodeURIComponent).join("/")}`;
  url.search = "";
  const cacheKey = new Request(url, { method: "GET" });
  let cache: Cache | undefined;
  let response: Response | undefined;
  try {
    cache = await caches.open("arcaea-media-v1");
    response = await cache.match(cacheKey);
  } catch { console.warn("Media cache lookup failed; falling back to R2."); }
  const hit = Boolean(response);
  if (!response) {
    const bodyObject = request.method === "HEAD" ? null : await env.ARCHIVE.get(key);
    const object = request.method === "HEAD" ? await env.ARCHIVE.head(key) : bodyObject;
    if (!object) throw new AppError("资源不存在。", 404, "ASSET_NOT_FOUND");
    response = new Response(bodyObject?.body ?? null, { headers: {
      "content-type": object.httpMetadata?.contentType || "application/octet-stream",
      "content-length": String(object.size),
      etag: object.httpEtag,
      "last-modified": object.uploaded.toUTCString(),
      "cache-control": `public, max-age=${TTL}`,
    } });
    if (cache && request.method === "GET") {
      const write = cache.put(cacheKey, response.clone()).catch(() => {
        console.warn("Media cache write failed; serving R2 response.");
      });
      if (background) background.waitUntil(write);
      else await write;
    }
  }

  const headers = new Headers(response.headers);
  headers.set("cache-control", `private, max-age=${TTL}`);
  headers.set("cdn-cache-control", "no-store");
  headers.set("vary", "Cookie");
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-media-cache", hit ? "HIT" : "MISS");
  const condition = request.headers.get("if-none-match");
  const etag = headers.get("etag");
  const unchanged = condition && etag && condition.split(",").some(value => {
    const tag = value.trim();
    return tag === "*" || tag.replace(/^W\//, "") === etag;
  });
  if (unchanged || request.method === "HEAD") {
    if (response.body) {
      const cancel = response.body.cancel().catch(() => {});
      if (background) background.waitUntil(cancel);
    }
    if (unchanged) headers.delete("content-length");
    return new Response(null, { status: unchanged ? 304 : 200, headers });
  }
  return new Response(response.body, { headers });
}
