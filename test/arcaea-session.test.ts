import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env as bindings } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { ArcaeaClient } from "../src/lib/arcaea-client";
import { ArcaeaSessionCache, sessionFromHeaders } from "../src/lib/arcaea-session";
import { getArcaeaCredentials, getConfig } from "../src/lib/config";
import type { Env } from "../src/lib/environment";
import { getSongScores } from "../src/lib/song-scores";
import { Store } from "../src/lib/store";
import { refreshScoreExportProfile } from "../src/lib/score-export-profile";

let env: Env;
const query = { term: "Aegleseeker", difficulty: 2, page: 1, sort: "title" } as const;
const score = { song_id: "aegleseeker", difficulty: 2, score: 9960014, rating: 13.2,
  perfect_count: 1559, shiny_perfect_count: 1469, near_count: 5, miss_count: 4,
  clear_type: 1, best_clear_type: 5, modifier: 0, time_played: 1777211741898, yearly_play_count: 8,
  title: { en: "Aegleseeker" }, artist: "Silentroom vs Frums" };

function loginResponse(value = "private-sid", attributes = "Max-Age=2592000") {
  const headers = new Headers();
  headers.append("set-cookie", `sid=${value}; Path=/; HttpOnly; Secure; ${attributes}`);
  headers.append("set-cookie", "ctrcode=private-country; Domain=lowiro.com");
  return Response.json({ isLoggedIn: true }, { headers });
}

function mockUpstream() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = new Request(input, init), path = new URL(request.url).pathname;
    if (path === "/auth/login") return loginResponse();
    expect(request.headers.get("cookie")).toBe("sid=private-sid; ctrcode=private-country");
    if (path === "/webapi/user/me") return Response.json({ success: true, value: { rating: 12500, name: "Player", character: 23 } });
    if (path === "/webapi/score/rating/me") return Response.json({ success: true, value: { best_rated_scores: [score] } });
    if (path === "/webapi/score/rating_progression/me") return Response.json({ success: true, value: [] });
    if (path === "/webapi/score/song/me/all") return Response.json({ success: true, value: { scores: [score], count: 1 } });
    throw new Error("Unexpected upstream request");
  });
}

function loginCalls(upstream: ReturnType<typeof mockUpstream>) {
  return upstream.mock.calls.filter(([input, init]) => new URL(new Request(input, init).url).pathname === "/auth/login");
}

async function storedSession() {
  return env.DB.prepare("SELECT body FROM cache WHERE kind='lowiro-session' AND key='current'").first<string>("body");
}

beforeEach(async () => {
  const b = bindings as unknown as Env & { TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1] };
  await applyD1Migrations(b.DB, b.TEST_MIGRATIONS);
  await b.DB.batch(["outbox", "jobs", "snapshots", "ptt_points", "cache", "logs", "sessions", "login_attempts"]
    .map(table => b.DB.prepare(`DELETE FROM ${table}`)));
  env = { ...b, ADMIN_TOKEN: "site-private-token", USERNAME: "private@example.com", PASSWD: "lowiro-private-password" };
});
afterEach(() => vi.restoreAllMocks());

describe("persistent Lowiro sessions", () => {
  it("reuses cookies across independent B50, history, song and export tasks without a validation request", async () => {
    const upstream = mockUpstream();
    const b50 = await ArcaeaClient.login(env);
    expect(await b50.fetchB50Snapshot()).toMatchObject({ user: { name: "Player" }, best50: [{ songId: "aegleseeker" }] });
    const history = await ArcaeaClient.login({ ...env });
    expect(await history.getPotentialHistory()).toEqual([]);
    expect(await getSongScores({ ...env }, new URLSearchParams({ term: query.term })))
      .toMatchObject({ count: 1, scores: [{ songId: "aegleseeker" }] });
    expect(await refreshScoreExportProfile({ ...env })).toMatchObject({ characterAssetId: "23", user: { name: "Player" } });
    expect(loginCalls(upstream)).toHaveLength(1);
    expect(upstream).toHaveBeenCalledTimes(6);
  });

  it("persists authenticated ciphertext and keeps it out of archive exports", async () => {
    mockUpstream();
    await ArcaeaClient.login(env);
    const body = (await storedSession())!;
    expect(JSON.parse(body)).toMatchObject({ version: 1, iv: expect.any(String), data: expect.any(String) });
    for (const secret of ["private-sid", "private-country", env.USERNAME!, env.PASSWD!, env.ADMIN_TOKEN!]) {
      expect(body).not.toContain(secret);
    }
    await new Store(env).exportArchive();
    const objects = await env.ARCHIVE.list({ prefix: "exports/" });
    expect(objects.objects).toHaveLength(4);
    for (const object of objects.objects) {
      const text = await (await env.ARCHIVE.get(object.key))!.text();
      expect(text).not.toContain("private-sid");
      expect(text).not.toContain("lowiro-session");
    }
  });

  it.each([
    { PASSWD: "changed-password" }, { USERNAME: "other@example.com" }, { ADMIN_TOKEN: "rotated-token" },
    { ARCAEA_API_BASE: "https://api.lowiro.com" }, { ARCAEA_USER_AGENT: "new-user-agent" },
  ])("invalidates cached authentication when credentials or configuration change: %j", async change => {
    const upstream = mockUpstream();
    await ArcaeaClient.login(env);
    const previous = await storedSession();
    await ArcaeaClient.login({ ...env, ...change });
    expect(loginCalls(upstream)).toHaveLength(2);
    expect(await storedSession()).not.toBe(previous);
  });

  it("uses the declared expiry with a safety margin, without extending it on reads", async () => {
    const now = Date.now(), clock = vi.spyOn(Date, "now").mockReturnValue(now);
    const upstream = vi.spyOn(globalThis, "fetch").mockImplementation(async () => loginResponse("private-sid", "Max-Age=300"));
    await ArcaeaClient.login(env);
    const original = await storedSession();
    clock.mockReturnValue(now + 200_000);
    await ArcaeaClient.login({ ...env });
    expect(loginCalls(upstream)).toHaveLength(1);
    expect(await storedSession()).toBe(original);
    clock.mockReturnValue(now + 240_001);
    await ArcaeaClient.login({ ...env });
    expect(loginCalls(upstream)).toHaveLength(2);
  });

  it.each(["", "Expires=invalid"])("does not persist a cookie with no usable expiry (%s)", async attributes => {
    const upstream = vi.spyOn(globalThis, "fetch").mockImplementation(async () => loginResponse("private-sid", attributes));
    await ArcaeaClient.login(env);
    await ArcaeaClient.login({ ...env });
    expect(loginCalls(upstream)).toHaveLength(2);
    expect(await storedSession()).toBeNull();
  });

  it("recovers from corrupted ciphertext without leaking it or failing the task", async () => {
    const upstream = mockUpstream();
    await ArcaeaClient.login(env);
    await env.DB.prepare("UPDATE cache SET body=? WHERE kind='lowiro-session' AND key='current'")
      .bind(JSON.stringify({ version: 1, iv: "corrupt", data: "corrupt" })).run();
    expect(await (await ArcaeaClient.login({ ...env })).getUser()).toMatchObject({ name: "Player" });
    expect(loginCalls(upstream)).toHaveLength(2);
  });

  it("coalesces simultaneous first logins across independent clients through D1", async () => {
    const upstream = mockUpstream();
    const clients = await Promise.all(Array.from({ length: 4 }, () => ArcaeaClient.login({ ...env })));
    expect(clients).toHaveLength(4);
    expect(loginCalls(upstream)).toHaveLength(1);
    expect(await env.DB.prepare("SELECT 1 FROM cache WHERE kind='lowiro-session' AND key='login-lock'").first()).toBeNull();
  });

  it("takes over an expired login lease and releases it after a failed login", async () => {
    await env.DB.prepare("INSERT INTO cache(kind,key,body) VALUES('lowiro-session','login-lock',?)")
      .bind(JSON.stringify({ id: "abandoned", until: Date.now() - 1 })).run();
    const upstream = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ isLoggedIn: false, message: "private error" }, { status: 400 }))
      .mockResolvedValueOnce(loginResponse());
    await expect(ArcaeaClient.login(env)).rejects.toMatchObject({ code: "ARCAEA_LOGIN_FAILED" });
    expect(await storedSession()).toBeNull();
    expect(await env.DB.prepare("SELECT 1 FROM cache WHERE kind='lowiro-session' AND key='login-lock'").first()).toBeNull();
    await ArcaeaClient.login(env);
    expect(loginCalls(upstream)).toHaveLength(2);
  });

  it("refreshes a revoked session once for concurrent profile and B50 requests", async () => {
    let logins = 0, expired = false;
    const upstream = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const request = new Request(input, init), path = new URL(request.url).pathname;
      if (path === "/auth/login") return loginResponse(`sid-${++logins}`);
      if (expired && request.headers.get("cookie")?.includes("sid=sid-1;")) {
        return Response.json({ success: false, error_code: 203 }, { status: 400 });
      }
      expect(request.headers.get("cookie")).toBe("sid=sid-2; ctrcode=private-country");
      return path === "/webapi/user/me" ? Response.json({ value: { name: "Player", rating: 12500 } }) :
        Response.json({ value: { best_rated_scores: [score] } });
    });
    await ArcaeaClient.login(env);
    const otherTask = await ArcaeaClient.login({ ...env });
    expired = true;
    expect(await otherTask.fetchB50Snapshot()).toMatchObject({ user: { name: "Player" }, best50: [{ songId: "aegleseeker" }] });
    await (await ArcaeaClient.login({ ...env })).getUser();
    expect(loginCalls(upstream)).toHaveLength(2);
  });

  it("coalesces revoked-session refreshes between independent clients", async () => {
    let logins = 0;
    const upstream = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const request = new Request(input, init);
      if (new URL(request.url).pathname === "/auth/login") return loginResponse(`sid-${++logins}`);
      if (request.headers.get("cookie")?.includes("sid=sid-1;")) return Response.json({ success: false, error_code: 203 }, { status: 400 });
      return Response.json({ value: { name: "Player", rating: 12500 } });
    });
    const clients = await Promise.all([ArcaeaClient.login(env), ArcaeaClient.login({ ...env })]);
    expect(await Promise.all(clients.map(client => client.getUser()))).toHaveLength(2);
    expect(loginCalls(upstream)).toHaveLength(2);
  });

  it.each([
    () => new Response("login required", { status: 401 }),
    () => Response.json({ isLoggedIn: false }),
    () => Response.json({ success: false, error_code: 203 }, { status: 400 }),
  ])("retries an explicit auth rejection only once, then removes the rejected session (%#)", async rejection => {
    const upstream = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) =>
      new URL(new Request(input, init).url).pathname === "/auth/login" ? loginResponse() : rejection());
    const client = await ArcaeaClient.login(env);
    await expect(client.getUser()).rejects.toMatchObject({ code: "ARCAEA_SESSION_EXPIRED" });
    expect(loginCalls(upstream)).toHaveLength(2);
    expect(upstream).toHaveBeenCalledTimes(4);
    expect(await storedSession()).toBeNull();
  });

  it.each([403, 429, 500])("does not relogin for unrelated HTTP %s failures", async status => {
    const upstream = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) =>
      new URL(new Request(input, init).url).pathname === "/auth/login" ? loginResponse() :
        Response.json({ success: false, error_code: 999 }, { status }));
    const client = await ArcaeaClient.login(env);
    await expect(client.getSongScores(query)).rejects.toMatchObject({ code: "ARCAEA_API_FAILED" });
    expect(loginCalls(upstream)).toHaveLength(1);
    expect(await storedSession()).not.toBeNull();
  });

  it("does not repeat a failed refresh for parallel requests in the same client", async () => {
    let logins = 0;
    const upstream = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (new URL(new Request(input, init).url).pathname === "/auth/login") {
        return ++logins === 1 ? loginResponse() : Response.json({ isLoggedIn: false }, { status: 400 });
      }
      return Response.json({ success: false, error_code: 203 }, { status: 400 });
    });
    const client = await ArcaeaClient.login(env);
    const results = await Promise.allSettled([client.getUser(), client.getBest50()]);
    expect(results.every(result => result.status === "rejected")).toBe(true);
    expect(loginCalls(upstream)).toHaveLength(2);
    expect(await storedSession()).toBeNull();
  });

  it("does not invalidate a newer login when a late request rejects an older session", async () => {
    const cache = await ArcaeaSessionCache.create(env, getConfig(env), getArcaeaCredentials(env));
    const first = await cache.get(async () => sessionFromHeaders(loginResponse("first").headers)!);
    const second = await cache.get(async () => sessionFromHeaders(loginResponse("second").headers)!, first);
    await cache.invalidate(first);
    const unexpected = vi.fn(async () => { throw new Error("Unexpected login"); });
    expect(await cache.get(unexpected)).toEqual(second);
    expect(unexpected).not.toHaveBeenCalled();
  });
});

describe("Lowiro cookie expiry", () => {
  it("reads Expires despite its comma, includes companion cookies and compensates server clock skew", () => {
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);
    const serverNow = Date.parse("Tue, 03 Nov 2026 17:10:53 GMT");
    const session = sessionFromHeaders(new Headers({
      date: new Date(serverNow).toUTCString(),
      "set-cookie": "sid=private; Expires=Thu, 03 Dec 2026 17:10:53 GMT; Secure, ctrcode=JP; Domain=lowiro.com",
    }));
    expect(session).toMatchObject({ cookies: "sid=private; ctrcode=JP", expiresAt: now + 30 * 86400_000 });
  });

  it("gives Max-Age precedence and never borrows an auxiliary cookie's expiry", () => {
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);
    expect(sessionFromHeaders(loginResponse("private", "Max-Age=120; Expires=Thu, 01 Jan 1970 00:00:00 GMT").headers))
      .toMatchObject({ expiresAt: now + 120_000 });
    const headers = new Headers({ "set-cookie": "sid=private; Secure, ctrcode=JP; Max-Age=2592000" });
    expect(sessionFromHeaders(headers)).not.toHaveProperty("expiresAt");
    for (const attrs of ["Max-Age=0", "Max-Age=-1", "Expires=Thu, 01 Jan 1970 00:00:00 GMT"]) {
      expect(sessionFromHeaders(loginResponse("private", attrs).headers)).toBeUndefined();
    }
    expect(sessionFromHeaders(new Headers())).toBeUndefined();
  });
});
