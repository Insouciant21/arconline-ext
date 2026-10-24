import type { Env } from "./environment";
import { authenticated, login, logout, requireSameOrigin } from "./auth";
import { AppError, errorResponse } from "./errors";
import { getDashboardPayload } from "./dashboard";
import { enqueue, getJob, retryJob } from "./jobs";
import { serveMedia } from "./media";
import { Store } from "./store";
import { getSongScores } from "./song-scores";

export async function api(env: Env, request: Request, background?: Pick<ExecutionContext, "waitUntil">): Promise<Response> {
  try {
    const path = new URL(request.url).pathname;
    if (path === "/api/auth/login") { method(request, "POST"); return await login(env, request); }
    if (path === "/api/auth/logout") { method(request, "POST"); return await logout(env, request); }
    if (!await authenticated(env, request)) throw new AppError("需要登录后才能访问。", 401, "AUTH_REQUIRED");
    if (request.method !== "GET" && request.method !== "HEAD") {
      requireSameOrigin(request);
      if (env.MUTATIONS_ENABLED === "false") throw new AppError("维护中，暂时停止同步。", 503, "MAINTENANCE");
    }
    if (path === "/api/auth/session") { method(request, "GET"); return json({ authenticated: true }); }
    if (path === "/api/dashboard") { method(request, "GET"); return json(await getDashboardPayload(env)); }
    if (path === "/api/scores") { method(request, "GET"); return json(await getSongScores(env, new URL(request.url).searchParams)); }
    if (path === "/api/health") { method(request, "GET"); await env.DB.prepare("SELECT 1").first(); return json({ ok: true, r2Configured: Boolean(env.ARCHIVE), runtime: "cloudflare", timestamp: new Date().toISOString() }); }
    if (path === "/api/sync" || path === "/api/cron/daily") { method(request, "POST"); return json(await enqueue(env, "sync", path.endsWith("daily") ? "cron" : "manual"), 202); }
    if (path === "/api/history/import") { method(request, "POST"); return json(await enqueue(env, "import"), 202); }
    if (path === "/api/media/retry") {
      method(request, "POST");
      const snapshot = await new Store(env).latest();
      if (!snapshot || snapshot.mediaStatus !== "failed") throw new AppError("当前快照没有可重试的媒体任务。", 409, "MEDIA_RETRY_NOT_AVAILABLE");
      return json(await enqueue(env, "retry", "manual", null, { snapshotId: snapshot.id }), 202);
    }
    const match = path.match(/^\/api\/jobs\/([a-f0-9-]+)(\/retry)?$/);
    if (match) {
      method(request, match[2] ? "POST" : "GET");
      return json(match[2] ? await retryJob(env, match[1]) : await getJob(env, match[1]), match[2] ? 202 : 200);
    }
    const snapshotMatch = path.match(/^\/api\/snapshots\/([0-9a-z-]+)$/i);
    if (snapshotMatch) {
      method(request, "GET");
      const store = new Store(env);
      const snapshot = await store.snapshot(snapshotMatch[1]);
      if (!snapshot) throw new AppError("快照不存在。", 404, "SNAPSHOT_NOT_FOUND");
      return json((await store.enrich([snapshot]))[0]);
    }
    if (path.startsWith("/api/media/")) {
      return await serveMedia(env, request, background);
    }
    throw new AppError("接口不存在。", 404, "NOT_FOUND");
  } catch (error) {
    const response = errorResponse(error);
    response.headers.set("cache-control", "no-store");
    response.headers.set("x-content-type-options", "nosniff");
    if (error instanceof AppError && error.status === 405) response.headers.set("allow", error.message);
    return response;
  }
}
function method(request: Request, allowed: string) {
  if (request.method !== allowed) throw new AppError(allowed, 405, "METHOD_NOT_ALLOWED");
}
function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
}
