import type { Env } from "./environment";
import { AppError } from "./errors";

const COOKIE = "arc_session";
const SEVEN_DAYS = 7 * 86400;
export async function digest(value: string) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
function token(request: Request) {
  return request.headers.get("cookie")?.split(";").map(value => value.trim()).find(value => value.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
}
export async function authenticated(env: Env, request: Request) {
  const value = token(request);
  if (!value || !/^[a-f0-9]{64}$/.test(value)) return false;
  return Boolean(await env.DB.prepare("SELECT 1 FROM sessions WHERE token_hash=? AND expires_at>?")
    .bind(await digest(value), Date.now()).first());
}
export function requireSameOrigin(request: Request) {
  const expected = new URL(request.url).origin;
  if (request.headers.get("origin") !== expected || request.headers.get("sec-fetch-site") === "cross-site")
    throw new AppError("请求来源无效。", 403, "ORIGIN_REJECTED");
}
export function safeCallbackUrl(value: string | null | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u0020]/.test(value)) return "/";
  return new URL(value, "https://local.invalid").origin === "https://local.invalid" ? value : "/";
}
function sessionCookie(value: string, request: Request, maxAge = SEVEN_DAYS) {
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`;
}
export async function login(env: Env, request: Request) {
  requireSameOrigin(request);
  const clientIp = request.headers.get("cf-connecting-ip") || "local";
  if (env.LOGIN_RATE_LIMITER && !(await env.LOGIN_RATE_LIMITER.limit({ key: clientIp })).success) {
    throw new AppError("登录请求过于频繁，请稍后再试。", 429, "LOGIN_RATE_LIMITED");
  }
  const now = Date.now();
  const key = await digest(clientIp);
  const attempts = await env.DB.prepare(`INSERT INTO login_attempts(key,count,expires_at) VALUES(?,1,?)
    ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires_at<=? THEN 1 ELSE count+1 END,
    expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END RETURNING count`)
    .bind(key, now + 60_000, now, now).first<number>("count");
  if ((attempts || 0) > 5) throw new AppError("尝试过于频繁，请一分钟后再试。", 429, "LOGIN_RATE_LIMITED");
  let body: { token?: unknown; callbackUrl?: string };
  try { body = await request.json(); } catch { throw new AppError("请求格式无效。", 400, "INVALID_BODY"); }
  const expected = env.ADMIN_TOKEN?.trim();
  const supplied = typeof body.token === "string" ? body.token.trim() : "";
  if (!expected) throw new AppError("管理口令尚未配置。", 503, "ADMIN_TOKEN_MISSING");
  const left = await digest(supplied), right = await digest(expected);
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left.charCodeAt(i) ^ right.charCodeAt(i);
  if (!supplied || difference) throw new AppError("访问口令无效，请重试。", 401, "INVALID_CREDENTIALS");
  const value = [...crypto.getRandomValues(new Uint8Array(32))].map(byte => byte.toString(16).padStart(2, "0")).join("");
  await env.DB.prepare("INSERT INTO sessions(token_hash,expires_at) VALUES(?,?)").bind(await digest(value), now + SEVEN_DAYS * 1000).run();
  return Response.json({ redirectTo: safeCallbackUrl(body.callbackUrl) }, { headers: { "set-cookie": sessionCookie(value, request), "cache-control": "no-store" } });
}
export async function logout(env: Env, request: Request) {
  requireSameOrigin(request);
  const value = token(request);
  if (value) await env.DB.prepare("DELETE FROM sessions WHERE token_hash=?").bind(await digest(value)).run();
  return Response.json({ ok: true }, { headers: { "set-cookie": sessionCookie("", request, 0), "cache-control": "no-store" } });
}
