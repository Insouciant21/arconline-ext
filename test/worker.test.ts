import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { env as bindings } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { api } from "../src/lib/api";
import { authenticated, safeCallbackUrl } from "../src/lib/auth";
import { Store } from "../src/lib/store";
import { enqueue, consume, getJob, recover, retryJob, type JobRow } from "../src/lib/jobs";
import { ArcaeaClient } from "../src/lib/arcaea-client";
import { calculateWeightedPotential } from "../src/lib/potential";
import { compareSnapshots } from "../src/lib/history-diff";
import type { Env, JobMessage } from "../src/lib/environment";
import type { B50Snapshot } from "../src/lib/types";
import { publicAssetUrl } from "../src/lib/r2";

let env: Env, sent: JobMessage[];
function fixture(id = "2026-10-14-first", potential = 12.5): B50Snapshot {
  return { id, fetchedAt: "2026-10-14T10:00:00.000Z", trigger: "manual", potential, weightedPotential: 12.5,
    user: { rating: potential, name: "Test" }, imageStats: { requested: 1, uploaded: 0, failed: 0, failures: [] }, mediaStatus: "complete",
    best50: Array.from({length:50}, (_,i) => ({ songId:`song${i}`, difficulty:2, modifier:0, rating:13-i/100, score:9900000,perfectCount:100,nearCount:0,missCount:0,clearType:1,title:{en:`Song ${i}`},artist:"Test",timePlayed:1700000000000,bg:"a".repeat(32) })) };
}
function uncachedFixture() {
  const snapshot = fixture();
  snapshot.best50.forEach((score, index) => { score.bg = index.toString(16).padStart(32, "0"); });
  snapshot.user.characterId = 7;
  snapshot.user.characterIcon = "c".repeat(32);
  return snapshot;
}
function request(path: string, method = "GET", cookie = "", body?: unknown, origin = "https://arc.example") {
  return new Request(`https://arc.example${path}`, { method, headers: { origin, cookie, "content-type":"application/json" }, ...(body ? { body:JSON.stringify(body) } : {}) });
}
async function login() {
  const response=await api(env,request("/api/auth/login","POST","",{token:"test-token"}));
  expect(response.status).toBe(200);
  return response.headers.get("set-cookie")!.split(";")[0];
}
async function deliver(message:JobMessage) {
  const ack=vi.fn(), retry=vi.fn();
  await consume(env,{ queue:"test", messages:[{id:crypto.randomUUID(),timestamp:new Date(),attempts:1,body:message,ack,retry}],ackAll:vi.fn(),retryAll:vi.fn() } as unknown as MessageBatch<JobMessage>);
  return {ack,retry};
}
function mockLowiro(snapshot = fixture()) {
  const client={ fetchB50Snapshot:vi.fn(async()=>({user:snapshot.user,best50:snapshot.best50})), getPotentialHistory:vi.fn(async()=>[{timePlayed:Date.parse(snapshot.fetchedAt),potential:snapshot.potential}]), getBest50:vi.fn(async()=>snapshot.best50), getOnlineImage:vi.fn(async()=>({body:new Uint8Array([1,2,3]).buffer,contentType:"image/png"})), getChartImage:vi.fn(async()=>({body:new Uint8Array([1,2,3]).buffer,contentType:"image/jpeg"})), getCharacterIconImage:vi.fn(async()=>({body:new Uint8Array([1]).buffer,contentType:"image/png"})) };
  vi.spyOn(ArcaeaClient,"login").mockResolvedValue(client as unknown as ArcaeaClient);
  return client;
}
function songScoreFixture() {
  return { user_id: 123, song_id: "aegleseeker", difficulty: 2, score: 9960014,
    shiny_perfect_count: 1469, perfect_count: 1559, near_count: 5, miss_count: 4,
    clear_type: 1, best_clear_type: 5, modifier: 0, time_played: 1777211741898,
    yearly_play_count: 8, title: { en: "Aegleseeker" }, artist: "Silentroom vs Frums", bg: "b".repeat(32) };
}
function mockSongApi(payload: unknown) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const upstream = new Request(input, init);
    const path = new URL(upstream.url).pathname;
    if (path === "/auth/login") return Response.json({ isLoggedIn: true }, { headers: { "set-cookie": "lowiro=private-session; HttpOnly; Secure" } });
    expect(upstream.headers.get("cookie")).toBe("lowiro=private-session");
    if (path === "/webapi/user/me") return Response.json({ value: { rating: 12500, name: "Test" } });
    if (path === "/webapi/score/song/me/all") return Response.json(payload);
    throw new Error("Unexpected upstream request");
  });
}
beforeEach(async()=>{
  const b=bindings as unknown as Env & {TEST_MIGRATIONS:Parameters<typeof applyD1Migrations>[1]};
  await applyD1Migrations(b.DB,b.TEST_MIGRATIONS);
  await b.DB.batch(["outbox","jobs","snapshots","ptt_points","cache","logs","sessions","login_attempts"].map(table=>b.DB.prepare(`DELETE FROM ${table}`)));
  const objects=await b.ARCHIVE.list(); if(objects.objects.length)await b.ARCHIVE.delete(objects.objects.map(object=>object.key));
  sent=[];
  env={...b,ADMIN_TOKEN:"test-token",USERNAME:"test",PASSWD:"test",JOBS:{send:vi.fn(async(message:JobMessage)=>{sent.push(message);})} as unknown as Queue<JobMessage>};
});
afterEach(()=>vi.restoreAllMocks());

it("uses Workers-compatible fetch options for Lowiro login and images", async () => {
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    expect(request.redirect).toBe("manual");
    const path = new URL(request.url).pathname;
    if (path === "/auth/login") return Response.json({isLoggedIn:true}, {headers:{"set-cookie":"session=test; Secure; HttpOnly"}});
    expect(request.headers.get("cookie")).toBe("session=test");
    if (path === "/webapi/user/me") return Response.json({value:{rating:12500,name:"Test"}});
    return new Response("image",{headers:{"content-type":"image/jpeg"}});
  });
  const client = await ArcaeaClient.login(env);
  const image = await client.getChartImage("a".repeat(32));
  expect(image.contentType).toBe("image/jpeg"); expect(image.body.byteLength).toBe(5);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("reports the upstream login status without exposing credentials or its response body", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ success: false, error_code: 104, detail: "private upstream body" }, { status: 400 }));
  await expect(ArcaeaClient.login(env)).rejects.toMatchObject({
    code: "ARCAEA_LOGIN_FAILED", message: "Arcaea 登录失败（HTTP 400，错误码 104），请检查账号配置或账号状态。",
  });
});

it("fetches the profile and B50 together without an extra profile request during login", async () => {
  let resolveUser!: (response: Response) => void, resolveScores!: (response: Response) => void;
  const user = new Promise<Response>(resolve => { resolveUser = resolve; });
  const scores = new Promise<Response>(resolve => { resolveScores = resolve; });
  const upstream = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const path = new URL(new Request(input, init).url).pathname;
    if (path === "/auth/login") return Response.json({ isLoggedIn: true }, { headers: { "set-cookie": "session=private; Secure" } });
    if (path === "/webapi/user/me") return user;
    if (path === "/webapi/score/rating/me") return scores;
    throw new Error("Unexpected upstream request");
  });
  const client = await ArcaeaClient.login(env);
  expect(upstream).toHaveBeenCalledTimes(1);
  const pending = client.fetchB50Snapshot();
  await vi.waitFor(() => expect(upstream).toHaveBeenCalledTimes(3));
  resolveUser(Response.json({ value: { rating: 12500, name: "Test" } }));
  resolveScores(Response.json({ value: { best_rated_scores: [{ ...songScoreFixture(), rating: 13 }] } }));
  await expect(pending).resolves.toMatchObject({ user: { rating: 12.5 }, best50: [{ songId: "aegleseeker" }] });
});

describe("security headers",()=>{
  it("hardens browser and API responses without breaking redirects", async () => {
    const page = await api(env, request("/api/auth/session"));
    expect(page.status).toBe(401);
    expect(page.headers.get("x-content-type-options")).toBe("nosniff");
    const unauthorized = await api(env, request("/api/health"));
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get("x-content-type-options")).toBe("nosniff");
    const cookie = await login();
    const allowed = await api(env, request("/api/health", "GET", cookie));
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get("x-content-type-options")).toBe("nosniff");
    expect(allowed.headers.get("cache-control")).toBe("no-store");
  });
});

describe("authentication and API",()=>{
  it("requires login, rejects cross-origin mutations, expires and revokes sessions",async()=>{
    expect((await api(env,request('/api/dashboard'))).status).toBe(401);
    expect((await api(env,request('/api/auth/login','POST','',{token:'test-token'},'https://evil.example'))).status).toBe(403);
    const cookie=await login();
    expect(await authenticated(env,request('/', 'GET',cookie))).toBe(true);
    expect((await api(env,request('/api/sync','POST',cookie,undefined,'https://evil.example'))).status).toBe(403);
    expect((await api(env,request('/api/cron/daily','GET',cookie))).status).toBe(405);
    await api(env,request('/api/auth/logout','POST',cookie));
    expect(await authenticated(env,request('/','GET',cookie))).toBe(false);
    const second=await login();await env.DB.prepare('UPDATE sessions SET expires_at=0').run();
    expect(await authenticated(env,request('/','GET',second))).toBe(false);
  });
  it("rate limits bad passwords and sanitizes redirects",async()=>{
    for(let i=0;i<5;i++) expect((await api(env,request('/api/auth/login','POST','',{token:'wrong'}))).status).toBe(401);
    expect((await api(env,request('/api/auth/login','POST','',{token:'wrong'}))).status).toBe(429);
    for(const value of ['//evil.example','/\\evil.example','https://evil.example','/\n/evil.example'])expect(safeCallbackUrl(value)).toBe('/');
    expect(safeCallbackUrl('/history?x=1')).toBe('/history?x=1');
  });
  it("uses the Cloudflare rate limiter before accepting login attempts", async () => {
    const limit = vi.fn()
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: false });
    const limitedEnv = { ...env, LOGIN_RATE_LIMITER: { limit } };
    expect((await api(limitedEnv, request('/api/auth/login', 'POST', '', { token: 'test-token' }))).status).toBe(200);
    const response = await api(limitedEnv, request('/api/auth/login', 'POST', '', { token: 'test-token' }));
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ code: 'LOGIN_RATE_LIMITED' });
    expect(limit).toHaveBeenCalledTimes(2);
    expect(limit).toHaveBeenNthCalledWith(1, { key: 'local' });
  });
  it("serves authenticated media privately",async()=>{
    const cookie=await login();await env.ARCHIVE.put('charts/test.jpg','image',{httpMetadata:{contentType:'image/jpeg'}});
    const response=await api(env,request('/api/media/charts/test.jpg','GET',cookie));
    expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toContain('private');
    expect((await api(env,request('/api/media/snapshots/secret.json','GET',cookie))).status).toBe(400);
  });
  it("caches media bytes without bypassing authentication, and supports conditional GET and HEAD", async () => {
    const cookie = await login();
    const key = `charts/${crypto.randomUUID()}.jpg`, path = `/api/media/${key}`;
    expect(publicAssetUrl(env, key)).toBe(path);
    await env.ARCHIVE.put(key, 'cached-image', { httpMetadata: { contentType: 'image/jpeg' } });
    const get = vi.spyOn(env.ARCHIVE, 'get');
    const first = await api(env, request(path, 'GET', cookie));
    expect(first.headers.get('x-media-cache')).toBe('MISS');
    expect(first.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
    expect(first.headers.get('cdn-cache-control')).toBe('no-store');
    expect(first.headers.get('vary')).toBe('Cookie');
    expect(new TextDecoder().decode(await first.arrayBuffer())).toBe('cached-image');
    const second = await api(env, request(`${path}?ignored=1`, 'GET', cookie));
    expect(second.headers.get('x-media-cache')).toBe('HIT');
    expect(new TextDecoder().decode(await second.arrayBuffer())).toBe('cached-image');
    expect(get).toHaveBeenCalledTimes(1);
    const conditional = request(path, 'GET', cookie);
    conditional.headers.set('if-none-match', `"other", W/${first.headers.get('etag')}`);
    const unchanged = await api(env, conditional);
    expect(unchanged.status).toBe(304);
    expect(await unchanged.text()).toBe('');
    const changed = request(path, 'GET', cookie);
    changed.headers.set('if-none-match', '"old"');
    expect((await api(env, changed)).status).toBe(200);
    const head = await api(env, request(path, 'HEAD', cookie));
    expect(head.status).toBe(200);
    expect(head.headers.get('content-length')).toBe('12');
    expect(await head.text()).toBe('');
    expect(get).toHaveBeenCalledTimes(1);
    expect((await api(env, request(path))).status).toBe(401);
    await api(env, request('/api/auth/logout', 'POST', cookie));
    expect((await api(env, conditional)).status).toBe(401);
  });
  it("handles cold HEAD, cold conditional requests and rejects missing or invalid media", async () => {
    const cookie = await login(), key = `potential/${crypto.randomUUID()}.png`;
    const path = `/api/media/${key}`;
    const object = await env.ARCHIVE.put(key, 'image');
    const head = await api(env, request(path, 'HEAD', cookie));
    expect(head.status).toBe(200); expect(await head.text()).toBe('');
    const conditional = request(path, 'GET', cookie);
    conditional.headers.set('if-none-match', object!.httpEtag);
    expect((await api(env, conditional)).status).toBe(304);
    for (const invalid of ['snapshots/private.json', 'charts/%2E%2E%2Fsecret', 'charts/%ZZ', 'characters/a%5Cb']) {
      const response = await api(env, request(`/api/media/${invalid}`, 'GET', cookie));
      expect(response.status).toBe(400);
      expect(response.headers.get('cache-control')).toBe('no-store');
    }
    const missing = await api(env, request(`/api/media/charts/${crypto.randomUUID()}`, 'GET', cookie));
    expect(missing.status).toBe(404);
    expect(missing.headers.get('cache-control')).toBe('no-store');
  });
  it("serves R2 images even when edge cache is unavailable", async () => {
    const cookie = await login(), key = `characters/${crypto.randomUUID()}.png`;
    await env.ARCHIVE.put(key, 'image');
    vi.spyOn(caches, 'open').mockRejectedValue(new Error('cache unavailable'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const response = await api(env, request(`/api/media/${key}`, 'GET', cookie));
    expect(response.status).toBe(200);
    expect(new TextDecoder().decode(await response.arrayBuffer())).toBe('image');
  });
});
describe("single-song queries", () => {
  it("requires a panel session and validates queries before contacting Lowiro", async () => {
    const upstreamLogin = vi.spyOn(ArcaeaClient, "login").mockRejectedValue(new Error("Unexpected login"));
    expect((await api(env, request("/api/scores?term=Aegleseeker"))).status).toBe(401);
    const cookie = await login();
    expect((await api(env, request("/api/scores?term=Aegleseeker", "POST", cookie))).status).toBe(405);
    for (const query of ["", "term=%20", `term=${"a".repeat(101)}`, "term=abc%00def", "term=abc&difficulty=5", "term=abc&page=0", "term=abc&page=1.5", "term=abc&page=10000", "term=abc&sort=unknown"]) {
      const response = await api(env, request(`/api/scores?${query}`, "GET", cookie));
      expect(response.status).toBe(400);
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
    expect(upstreamLogin).not.toHaveBeenCalled();
  });

  it("encodes search terms, preserves official judgements and pagination, and strips private fields", async () => {
    const bg = "b".repeat(32);
    await env.ARCHIVE.put(`charts/${bg}.jpg`, "cached-art", { httpMetadata: { contentType: "image/jpeg" } });
    const upstream = mockSongApi({ success: true, value: { scores: [{ ...songScoreFixture(), difficulty: 3, difficulty_alias: 1 }], count: 11 } });
    const cookie = await login();
    const response = await api(env, request("/api/scores?term=%20Dread%20%26%20Area%20&difficulty=3&page=2&sort=score_below_max", "GET", cookie));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const payload = await response.json() as { scores: Array<Record<string, unknown>>; count: number };
    expect(payload.count).toBe(11);
    expect(payload.scores[0]).toMatchObject({ songId: "aegleseeker", difficulty: 3, difficultyAlias: 1,
      score: 9960014, perfectCount: 1559, shinyPerfectCount: 1469, nearCount: 5, missCount: 4,
      clearType: 1, bestClearType: 5, yearlyPlayCount: 8, imageUrl: `/api/media/charts/${bg}.jpg` });
    expect(payload.scores[0]).not.toHaveProperty("rating");
    expect(payload.scores[0]).not.toHaveProperty("user_id");
    expect(JSON.stringify(payload)).not.toContain("private-session");
    expect(upstream).toHaveBeenCalledTimes(2);
    const scoreRequest = upstream.mock.calls.find(([input]) => String(input).includes("/score/song/me/all"))!;
    const params = new URL(String(scoreRequest[0])).searchParams;
    expect(Object.fromEntries(params)).toEqual({ term: "Dread & Area", difficulty: "3", page: "2", sort: "score_below_max" });
    expect(await new Store(env).latest()).toBeNull();
  });

  it("returns an empty result for an unplayed or unmatched chart", async () => {
    const upstream = mockSongApi({ success: true, value: { scores: [], count: 0 } });
    const cookie = await login();
    const response = await api(env, request("/api/scores?term=not-played", "GET", cookie));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ scores: [], count: 0 });
    const scoreRequest = upstream.mock.calls.find(([input]) => String(input).includes("/score/song/me/all"))!;
    expect(Object.fromEntries(new URL(String(scoreRequest[0])).searchParams)).toEqual({ term: "not-played", difficulty: "2", page: "1", sort: "title" });
  });

  it.each([
    { success: false, error_code: 999 },
    { success: true, value: {} },
    { success: true, value: { scores: [], count: "1" } },
    { success: true, value: { scores: [songScoreFixture()], count: 0 } },
    { success: true, value: { scores: [{ ...songScoreFixture(), shiny_perfect_count: 2000 }], count: 1 } },
  ])("reports upstream failures and malformed scores instead of hiding them as empty results %#", async payload => {
    mockSongApi(payload);
    const cookie = await login();
    const response = await api(env, request("/api/scores?term=Aegleseeker", "GET", cookie));
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ code: expect.stringMatching(/^ARCAEA_SONG_/) });
  });

  it("caches new artwork in R2 and reuses it on subsequent searches", async () => {
    const raw = songScoreFixture();
    const getChartImage = vi.fn(async () => ({ body: new Uint8Array([1, 2, 3]).buffer, contentType: "image/jpeg" }));
    const client = { getSongScores: vi.fn(async () => ({ scores: [{ songId: raw.song_id, bg: raw.bg }], count: 1 })), getChartImage };
    vi.spyOn(ArcaeaClient, "login").mockResolvedValue(client as unknown as ArcaeaClient);
    const cookie = await login();
    for (let i = 0; i < 2; i++) {
      const response = await api(env, request("/api/scores?term=Aegleseeker", "GET", cookie));
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ scores: [{ imageUrl: `/api/media/charts/${raw.bg}.jpg` }] });
    }
    expect(getChartImage).toHaveBeenCalledExactlyOnceWith(raw.bg);
    expect(await env.ARCHIVE.head(`charts/${raw.bg}.jpg`)).not.toBeNull();
  });

  it("keeps scores available when an artwork fetch fails", async () => {
    const raw = songScoreFixture();
    mockSongApi({ success: true, value: { scores: [raw], count: 1 } });
    vi.spyOn(ArcaeaClient.prototype, "getChartImage").mockRejectedValue(new Error("Temporary artwork failure"));
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cookie = await login();
    const response = await api(env, request("/api/scores?term=Aegleseeker", "GET", cookie));
    expect(response.status).toBe(200);
    const payload = await response.json() as { scores: Array<Record<string, unknown>> };
    expect(payload.scores[0].score).toBe(raw.score);
    expect(payload.scores[0]).not.toHaveProperty("imageUrl");
    expect(warning).toHaveBeenCalledOnce();
  });
});

describe("D1 archives",()=>{
  it("reads only requested media cache keys within D1's parameter limit", async () => {
    const store = new Store(env);
    await store.putCaches([
      { kind: "chart", key: "cache0", value: "first" },
      { kind: "chart", key: "cache149", value: "last" },
      { kind: "chart", key: "unrelated", value: "ignored" },
      { kind: "character", key: "cache0", value: "wrong kind" },
    ]);
    const sql = vi.spyOn(store, "sql");
    const keys = Array.from({ length: 150 }, (_, index) => `cache${index}`);
    expect(await store.cache<string>("chart", [...keys, ...keys])).toEqual({ cache0: "first", cache149: "last" });
    expect(sql.mock.calls).toHaveLength(2);
    for (const [, ...values] of sql.mock.calls) expect(values.length).toBeLessThanOrEqual(100);
    sql.mockClear();
    expect(await store.cache("character", [])).toEqual({});
    expect(sql).not.toHaveBeenCalled();
  });
  it("does not rewrite unchanged official history and resolves repeated timestamps", async () => {
    const store = new Store(env);
    const points = Array.from({ length: 200 }, (_, index) => ({ timePlayed: Date.parse("2026-10-01T00:00:00Z") + index * 3_600_000, potential: 12 + index / 1000 }));
    expect(await store.mergeOfficial(points)).toEqual({ received: 200, total: 200 });
    const batch = vi.spyOn(env.DB, "batch");
    expect(await store.mergeOfficial([...points, points[0]])).toEqual({ received: 201, total: 200 });
    expect(batch).not.toHaveBeenCalled();
    const corrected = { ...points[0], potential: 13 };
    expect(await store.mergeOfficial([corrected, points[0]])).toEqual({ received: 2, total: 200 });
    expect(batch).not.toHaveBeenCalled();
    await store.mergeOfficial([points[0], corrected]);
    expect((await store.history())[0].potential).toBe(13);
  });
  it("enriches current snapshots without querying the alias table", async () => {
    const store = new Store(env), snapshot = fixture();
    snapshot.best50[0].difficulty = 3;
    snapshot.best50[0].difficultyAlias = 1;
    snapshot.best50[0].imageKey = "charts/current.jpg";
    const prepare = vi.spyOn(env.DB, "prepare");
    const [enriched] = await store.enrich([snapshot]);
    expect(enriched.best50[0]).toMatchObject({ difficultyAlias: 1, imageUrl: "/api/media/charts/current.jpg" });
    expect(enriched.best50[1].difficultyAlias).toBeUndefined();
    expect(prepare).not.toHaveBeenCalled();
  });
  it("loads only missing legacy aliases and stays within D1's parameter limit", async () => {
    const store = new Store(env);
    const snapshots = Array.from({ length: 3 }, (_, page) => {
      const snapshot = fixture(`legacy-${page}`);
      snapshot.best50.forEach((score, index) => { score.songId = `legacy${page * 50 + index}`; score.difficulty = 3; });
      return snapshot;
    });
    Object.assign(snapshots[0].best50[0], { difficultyAlias: null });
    await store.putCache("alias", "legacy0:3", 1);
    await store.putCache("alias", "legacy149:3", 1);
    await store.putCache("alias", "unrelated:3", 1);
    const sql = vi.spyOn(store, "sql");
    const enriched = await store.enrich(snapshots);
    expect(enriched[0].best50[0].difficultyAlias).toBe(1);
    expect(enriched[2].best50[49].difficultyAlias).toBe(1);
    expect(enriched[1].best50[0].difficultyAlias).toBeUndefined();
    expect(sql.mock.calls.length).toBeLessThanOrEqual(2);
    expect(sql.mock.calls.flatMap(([, ...keys]) => keys)).toHaveLength(150);
    for (const [, ...keys] of sql.mock.calls) expect(keys.length).toBeLessThanOrEqual(100);
  });
  it("keeps daily maximum and latest chronologically, writes stable snapshots",async()=>{
    const store=new Store(env),first=fixture();await store.writeSnapshot(first);
    const later={...fixture('later',12.1),fetchedAt:'2026-10-14T11:00:00.000Z'};await store.writeSnapshot(later);await store.writeSnapshot(first);
    await store.mergeOfficial([{timePlayed:Date.parse('2026-10-14T12:00:00Z'),potential:12.8}]);
    expect((await store.snapshots()).length).toBe(2);expect((await store.latest())!.id).toBe('later');expect((await store.history())[0].potential).toBe(12.8);
    await store.exportArchive();expect(await env.ARCHIVE.head('exports/b50-history.csv')).not.toBeNull();
  });
  it("serves history summaries and on-demand snapshot detail",async()=>{
    const store=new Store(env);await store.writeSnapshot(fixture());
    const legacy={...fixture('2026-09-19-154914.321',11.4),fetchedAt:'2026-09-19T15:49:14.321Z'};await store.writeSnapshot(legacy);
    const later={...fixture('2026-10-15-second',12.9),fetchedAt:'2026-10-15T11:00:00.000Z'};await store.writeSnapshot(later);
    const summaries=await store.snapshotSummaries();
    expect(summaries.map(summary=>summary.id)).toEqual(['2026-10-15-second','2026-10-14-first','2026-09-19-154914.321']);
    expect(summaries[2]).toMatchObject({potential:11.4,trigger:'manual',entries:50});
    const cookie=await login();
    expect((await api(env,request('/api/snapshots/missing','GET',cookie))).status).toBe(404);
    for(const id of [later.id,legacy.id]){
      const response=await api(env,request(`/api/snapshots/${id}`,'GET',cookie));
      expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('no-store');
      expect(await response.json()).toMatchObject({id,potential:id===legacy.id?11.4:12.9,mediaStatus:'complete'});
    }
    expect((await api(env,request('/api/snapshots/2026-09-19-154914.321'))).status).toBe(401);
  });
  it("skips redundant archive exports when nothing changed",async()=>{
    const store=new Store(env);await store.writeSnapshot(fixture());
    const put=vi.spyOn(env.ARCHIVE,'put');
    const exportWrites=()=>put.mock.calls.filter(([key])=>String(key).startsWith('exports/')).length;
    await store.exportArchive();const writes=exportWrites();expect(writes).toBeGreaterThan(0);
    await store.exportArchive();expect(exportWrites()).toBe(writes);
    await store.mergeOfficial([{timePlayed:Date.parse('2026-10-16T10:00:00Z'),potential:13}]);
    await store.exportArchive();expect(exportWrites()).toBeGreaterThan(writes);
  });
  it("refreshes exports after correcting existing snapshots or official PTT points", async () => {
    const store = new Store(env), snapshot = fixture();
    const point = { timePlayed: Date.parse("2026-10-16T10:00:00Z"), potential: 13 };
    await store.writeSnapshot(snapshot);await store.mergeOfficial([point]);await store.exportArchive();
    snapshot.best50[0].imageKey = "charts/updated.jpg";
    await store.writeSnapshot(snapshot);await store.exportArchive();
    const scores = await (await env.ARCHIVE.get("exports/b50-history.json"))!.json<B50Snapshot[]>();
    expect(scores[0].best50[0].imageUrl).toBe("/api/media/charts/updated.jpg");
    await store.mergeOfficial([{ ...point, potential: 13.1 }]);await store.exportArchive();
    const history = await (await env.ARCHIVE.get("exports/ptt-history.json"))!.json<Array<{ potential: number }>>();
    expect(history.at(-1)?.potential).toBe(13.1);
  });
  it("settles all archive writes before retrying a failed export", async () => {
    const store = new Store(env);await store.writeSnapshot(fixture());
    const original = env.ARCHIVE.put.bind(env.ARCHIVE), failure = new Error("R2 temporarily unavailable");
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const put = vi.spyOn(env.ARCHIVE, "put").mockImplementation(async (...args) => {
      if (args[0] === "exports/b50-history.json") throw failure;
      if (args[0] === "exports/ptt-history.json") await gate;
      return original(...args);
    });
    let settled = false;
    const exporting = store.exportArchive().then(() => { settled = true; return null; }, error => { settled = true; return error; });
    try {
      await vi.waitFor(() => expect(put).toHaveBeenCalledTimes(4));
      expect(settled).toBe(false);
    } finally { release(); }
    expect(await exporting).toBe(failure);
    expect((await store.cache("export")).fingerprint).toBeUndefined();
  });
  it("retains the B50 formula and comparisons",()=>{
    expect(calculateWeightedPotential(Array(50).fill(12))).toBe(12);
    const before=fixture(),after=structuredClone(before);after.best50[0].score+=100;
    expect(compareSnapshots(before,after).filter(row=>row.kind==='changed')).toHaveLength(1);
  });
});
describe("durable queue pipeline",()=>{
  it("reuses previous covers and avatar when scores change, downloading only the new cover", async () => {
    const previous = uncachedFixture(), store = new Store(env);
    previous.best50.forEach(score => { score.imageKey = `charts/${score.bg}.jpg`; });
    previous.user.avatarImageKey = `characters/${previous.user.characterIcon}.png`;
    previous.potentialImageKey = `potential/${previous.id}.image`;
    await store.writeSnapshot(previous);
    const remote = structuredClone(previous);
    for (const score of remote.best50) { delete score.imageKey;delete score.imageUrl; }
    delete remote.user.avatarImageKey;delete remote.user.avatarImageUrl;
    remote.best50[0].score += 100;
    remote.best50[1].bg = "f".repeat(32);
    const client = mockLowiro(remote), head = vi.spyOn(env.ARCHIVE, "head"), cache = vi.spyOn(Store.prototype, "cache");
    const job = await enqueue(env, "sync");await deliver(sent.shift()!);
    const result = (await getJob(env, job.jobId)).result!;
    expect(result.recorded).toBe(true);expect(result.snapshot?.mediaStatus).toBe("complete");
    expect(result.snapshot?.best50[0].score).toBe(remote.best50[0].score);
    expect(client.getChartImage).toHaveBeenCalledExactlyOnceWith("f".repeat(32));
    expect(client.getOnlineImage).toHaveBeenCalledTimes(1);expect(client.getCharacterIconImage).not.toHaveBeenCalled();
    expect(head.mock.calls.map(([key]) => key).filter(key => key.startsWith("charts/"))).toEqual([`charts/${"f".repeat(32)}.jpg`]);
    expect(cache.mock.calls.filter(([kind]) => kind === "chart").map(([, keys]) => keys)).toEqual([["f".repeat(32)]]);
    expect(result.snapshot?.imageStats).toMatchObject({ requested: 50, uploaded: 1, cached: 49 });
    expect(result.snapshot?.user.avatarImageKey).toBe(previous.user.avatarImageKey);
    expect(result.snapshot?.potentialImageKey).not.toBe(previous.potentialImageKey);
  });
  it("processes changed B50 media while official history is still loading", async () => {
    const client = mockLowiro();
    let releaseHistory!: () => void, releaseImage!: () => void;
    const history = new Promise<void>(resolve => { releaseHistory = resolve; });
    const image = new Promise<void>(resolve => { releaseImage = resolve; });
    client.getPotentialHistory.mockImplementation(async () => { await history;return []; });
    client.getOnlineImage.mockImplementation(async () => { await image;return { body: new Uint8Array([1]).buffer, contentType: "image/png" }; });
    const job = await enqueue(env, "sync"), running = deliver(sent.shift()!);
    try {
      await vi.waitFor(() => { expect(client.getPotentialHistory).toHaveBeenCalledTimes(1);expect(client.getOnlineImage).toHaveBeenCalledTimes(1); });
      expect((await getJob(env, job.jobId)).status).toBe("running");
    } finally { releaseHistory();releaseImage(); }
    await running;
    expect((await getJob(env, job.jobId)).status).toBe("succeeded");
  });
  it("keeps the second image slot working while potential-image generation is blocked", async () => {
    const client = mockLowiro(uncachedFixture());
    let release!: () => void, active = 0, maximum = 0;
    const gate = new Promise<void>(resolve => { release = resolve; });
    client.getOnlineImage.mockImplementation(async () => {
      maximum = Math.max(maximum, ++active);
      try { await gate;return { body: new Uint8Array([1]).buffer, contentType: "image/png" }; }
      finally { active--; }
    });
    client.getChartImage.mockImplementation(async () => {
      maximum = Math.max(maximum, ++active);
      try { await Promise.resolve();return { body: new Uint8Array([1]).buffer, contentType: "image/jpeg" }; }
      finally { active--; }
    });
    const job = await enqueue(env, "sync"), running = deliver(sent.shift()!);
    try { await vi.waitFor(() => expect(client.getChartImage.mock.calls.length).toBeGreaterThanOrEqual(3)); }
    finally { release(); }
    await running;
    expect(maximum).toBe(2);expect(client.getChartImage).toHaveBeenCalledTimes(50);
    expect((await getJob(env, job.jobId)).status).toBe("succeeded");
  });
  it("does not mark unpersisted uploads done when history finishes during a failed snapshot write", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const client = mockLowiro(uncachedFixture()), original = Store.prototype.writeSnapshot;
    let fail = true;
    vi.spyOn(Store.prototype, "writeSnapshot").mockImplementation(async function(snapshot) {
      if (fail && snapshot.imageStats.uploaded > 0) { fail = false;throw new Error("Temporary snapshot write failure"); }
      return original.call(this, snapshot);
    });
    const job = await enqueue(env, "sync");await deliver(sent.shift()!);
    expect((await getJob(env, job.jobId)).status).toBe("queued");
    const state = JSON.parse((await new Store(env).sql("SELECT state FROM jobs WHERE id=?", job.jobId).first<string>("state"))!);
    expect(state.historyPending).toBe(false);expect(state.media.every((item: { done?: boolean }) => !item.done)).toBe(true);
    await deliver(sent.shift()!);
    const result = await getJob(env, job.jobId);
    expect(result.status).toBe("succeeded");expect(result.result?.snapshot?.potentialImageKey).toBeTruthy();
    expect(result.result?.snapshot?.best50.every(score => score.imageKey)).toBe(true);
    expect(client.getPotentialHistory).toHaveBeenCalledTimes(1);expect(client.getOnlineImage).toHaveBeenCalledTimes(1);expect(client.getChartImage).toHaveBeenCalledTimes(50);
  });
  it("starts exports alongside snapshot backup and settles both before retrying", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockLowiro();
    const original = Store.prototype.backup;
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    vi.spyOn(Store.prototype, "backup").mockImplementation(async function(snapshot) { await gate;return original.call(this, snapshot); });
    const exporting = vi.spyOn(Store.prototype, "exportArchive").mockRejectedValueOnce(new Error("Temporary export failure"));
    const job = await enqueue(env, "sync"), running = deliver(sent.shift()!);
    try {
      await vi.waitFor(() => expect(exporting).toHaveBeenCalledTimes(1));
      expect((await getJob(env, job.jobId)).status).toBe("running");
    } finally { release(); }
    await running;
    expect((await getJob(env, job.jobId)).status).toBe("queued");
    await deliver(sent.shift()!);
    const result = await getJob(env, job.jobId);
    expect(result.status).toBe("succeeded");expect(result.result?.recorded).toBe(true);
    expect(await env.ARCHIVE.head(`snapshots/${result.result!.snapshot!.id}.json`)).not.toBeNull();
    expect(await env.ARCHIVE.head("exports/b50-history.json")).not.toBeNull();
  });
  it("resumes a previously queued history stage without fetching B50 again", async () => {
    const snapshot = fixture(), store = new Store(env), client = mockLowiro();
    await store.writeSnapshot(snapshot);
    const job = await enqueue(env, "sync");
    await store.sql("UPDATE jobs SET stage='history',state=? WHERE id=?", JSON.stringify({ snapshotId: snapshot.id }), job.jobId).run();
    await deliver(sent.shift()!);
    expect((await getJob(env, job.jobId)).status).toBe("succeeded");
    expect(client.fetchB50Snapshot).not.toHaveBeenCalled();expect(client.getPotentialHistory).toHaveBeenCalledTimes(1);
  });
  it("finishes an uncached B50 in one delivery and reuses one upstream session", async () => {
    const client = mockLowiro(uncachedFixture());
    const writes = vi.spyOn(Store.prototype, "writeSnapshot"), caches = vi.spyOn(Store.prototype, "cache");
    const job = await enqueue(env, "sync"), message = sent.shift()!;
    const delivered = await deliver(message), result = await getJob(env, job.jobId);
    expect(result.status).toBe("succeeded");expect(delivered.ack).toHaveBeenCalledOnce();
    expect(sent).toHaveLength(0);
    expect(ArcaeaClient.login).toHaveBeenCalledTimes(1);
    expect(client.fetchB50Snapshot).toHaveBeenCalledTimes(1);
    expect(client.getBest50).not.toHaveBeenCalled();
    expect(client.getOnlineImage).toHaveBeenCalledTimes(1);
    expect(client.getChartImage).toHaveBeenCalledTimes(50);
    expect(client.getCharacterIconImage).toHaveBeenCalledTimes(1);
    expect(writes.mock.calls.length).toBeLessThan(20);
    for (const [kind, keys] of caches.mock.calls.filter(([kind]) => kind === "chart" || kind === "character")) {
      expect(keys).toBeDefined();expect(keys!.length).toBe(kind === "chart" ? 50 : 1);
    }
    expect(result.result?.snapshot?.imageStats).toMatchObject({ requested: 50, uploaded: 50, cached: 0 });
    expect(result.result?.snapshot?.user.avatarImageUrl).toBe(`/api/media/characters/${"c".repeat(32)}.png`);
    expect(await env.ARCHIVE.head(`snapshots/${result.result!.snapshot!.id}.json`)).not.toBeNull();
  });
  it("yields within its time budget and resumes the durable step after an expired lease", async () => {
    const client = mockLowiro(uncachedFixture()), now = Date.now;
    let elapsed = 0;
    vi.spyOn(Date, "now").mockImplementation(() => now() + elapsed);
    client.getChartImage.mockImplementation(async () => { elapsed = 121_000;return { body: new Uint8Array([1]).buffer, contentType: "image/jpeg" }; });
    const job = await enqueue(env, "sync"), original = sent.shift()!;
    await deliver(original);
    const yielded = await getJob(env, job.jobId);
    expect(yielded.status).toBe("queued");expect(yielded.stage).toBe("media");
    expect(yielded.progress.completed).toBeGreaterThan(0);expect(yielded.progress.completed).toBeLessThan(yielded.progress.total);
    const step = await new Store(env).sql("SELECT step FROM jobs WHERE id=?", job.jobId).first<number>("step");
    expect(sent[0].step).toBe(step);expect(step).toBeGreaterThan(original.step);
    expect((await deliver(original)).ack).toHaveBeenCalledOnce();
    await env.DB.prepare("UPDATE jobs SET status='running',lease_token='abandoned',lease_until=0,attempts=1 WHERE id=?").bind(job.jobId).run();
    sent.length = 0;elapsed = 0;
    client.getChartImage.mockImplementation(async () => ({ body: new Uint8Array([1]).buffer, contentType: "image/jpeg" }));
    await recover(env);expect(sent[0].step).toBe(step);
    await deliver(sent.shift()!);
    expect((await getJob(env, job.jobId)).status).toBe("succeeded");
    expect(ArcaeaClient.login).toHaveBeenCalledTimes(2);
    expect(client.fetchB50Snapshot).toHaveBeenCalledTimes(1);
    expect(client.getChartImage).toHaveBeenCalledTimes(50);expect(client.getOnlineImage).toHaveBeenCalledTimes(1);
  });
  it("recovers uploaded media from R2 without logging in upstream", async () => {
    const store = new Store(env), snapshot = fixture();
    await store.writeSnapshot(snapshot);
    await env.ARCHIVE.put(`potential/${snapshot.id}.image`, "potential");
    await env.ARCHIVE.put(`charts/${snapshot.best50[0].bg}.jpg`, "chart");
    const login = vi.spyOn(ArcaeaClient, "login").mockRejectedValue(new Error("Upstream must not be needed"));
    const job = await enqueue(env, "retry", "manual", null, { snapshotId: snapshot.id });
    await deliver(sent.shift()!);
    expect((await getJob(env, job.jobId)).status).toBe("succeeded");expect(login).not.toHaveBeenCalled();
    expect((await store.latest())?.imageStats).toMatchObject({ cached: 1, uploaded: 0 });
  });
  it("keeps a fetched B50 when official history fails", async () => {
    const client = mockLowiro();client.getPotentialHistory.mockRejectedValue(new Error("History temporarily unavailable"));
    const job = await enqueue(env, "sync");await deliver(sent.shift()!);
    expect((await getJob(env, job.jobId)).status).toBe("succeeded");
    expect(ArcaeaClient.login).toHaveBeenCalledTimes(1);
    expect(await new Store(env).logs()).toEqual(expect.arrayContaining([expect.objectContaining({ action: "history-import-failed", level: "warning" })]));
  });
  it("recovers a failed continuation dispatch using a redelivered older message", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const client = mockLowiro();client.getChartImage.mockRejectedValueOnce(new Error("Temporary image failure"));
    const job = await enqueue(env, "sync"), original = sent.shift()!;
    (env.JOBS.send as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("Queue temporarily unavailable"));
    const first = await deliver(original);
    expect(first.retry).toHaveBeenCalledWith({ delaySeconds: 30 });
    expect((await getJob(env, job.jobId)).status).toBe("queued");expect(sent).toHaveLength(0);
    expect((await deliver(original)).ack).toHaveBeenCalledOnce();
    expect(sent[0].step).toBeGreaterThan(original.step);
    await deliver(sent.shift()!);
    expect((await getJob(env, job.jobId)).status).toBe("succeeded");
    expect(client.fetchB50Snapshot).toHaveBeenCalledTimes(1);expect(client.getOnlineImage).toHaveBeenCalledTimes(1);
  });
  it("does not remove another lease owner's recovery outbox", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const client = mockLowiro(), job = await enqueue(env, "sync");
    client.getPotentialHistory.mockImplementation(async () => {
      await env.DB.prepare("UPDATE jobs SET lease_token='replacement' WHERE id=?").bind(job.jobId).run();
      return [];
    });
    await deliver(sent.shift()!);
    const row = await new Store(env).sql("SELECT status,stage,step,lease_token FROM jobs WHERE id=?", job.jobId).first<JobRow>();
    expect(row).toMatchObject({ status: "running", lease_token: "replacement" });
    expect(await new Store(env).sql("SELECT step FROM outbox WHERE job_id=?", job.jobId).first<number>("step")).toBe(row!.step);
    expect(row!.stage).toBe("media");
  });
  it("deduplicates concurrent submits and cron dates, ignores repeated deliveries",async()=>{
    const [a,b]=await Promise.all([enqueue(env,'sync'),enqueue(env,'sync')]);expect(a.jobId).toBe(b.jobId);
    const [c,d]=await Promise.all([enqueue(env,'sync','daily','daily:2026-10-14'),enqueue(env,'sync','daily','daily:2026-10-14')]);expect(c.jobId).toBe(d.jobId);
    const client=mockLowiro();const message=sent[0];await deliver(message);await deliver(message);
    expect(client.fetchB50Snapshot).toHaveBeenCalledTimes(1);expect((await new Store(env).snapshots()).length).toBe(1);
  });
  it("finishes first sync and skips snapshot/media on identical B50",async()=>{
    const client=mockLowiro();const first=await enqueue(env,'sync');
    for(let i=0;i<30 && (await getJob(env,first.jobId)).status!=='succeeded';i++){const message=sent.shift();if(message)await deliver(message);}
    const result=await getJob(env,first.jobId);expect(result.status).toBe('succeeded');expect(result.result?.snapshot?.mediaStatus).toBe('complete');
    const snapshot=result.result!.snapshot!;expect(await env.ARCHIVE.head(`snapshots/${snapshot.id}.json`)).not.toBeNull();
    client.getPotentialHistory.mockResolvedValue([{timePlayed:Date.parse('2026-10-15T10:00:00Z'),potential:12.8}]);
    const before=client.getOnlineImage.mock.calls.length;const duplicate=await enqueue(env,'sync');
    for(let i=0;i<30 && (await getJob(env,duplicate.jobId)).status!=='succeeded';i++){const message=sent.shift();if(message)await deliver(message);}
    expect((await getJob(env,duplicate.jobId)).result?.recorded).toBe(false);expect(client.getOnlineImage.mock.calls.length).toBe(before);expect(await new Store(env).snapshots()).toHaveLength(1);
    const archive=await env.ARCHIVE.get('exports/ptt-history.json');
    expect(await archive!.json()).toEqual(expect.arrayContaining([expect.objectContaining({date:'2026-10-15',potential:12.8})]));
  });
  it("recovers an outbox send failure and a terminated lease",async()=>{
    const failure=new Error('queue offline');
    const errorLog=vi.spyOn(console,'error').mockImplementation(()=>{});
    const send=env.JOBS.send as ReturnType<typeof vi.fn>;send.mockRejectedValueOnce(failure);
    const job=await enqueue(env,'import');expect(sent).toHaveLength(0);
    expect(errorLog).toHaveBeenCalledTimes(1);
    expect(errorLog).toHaveBeenCalledWith('[outbox] deferred',failure);
    errorLog.mockRestore();
    await recover(env);expect(sent.some(item=>item.jobId===job.jobId)).toBe(true);
    await env.DB.prepare("UPDATE jobs SET status='running',lease_token='abandoned',lease_until=0,attempts=1 WHERE id=?").bind(job.jobId).run();
    await recover(env);expect((await getJob(env,job.jobId)).status).toBe('queued');
  });
  it("checkpoints completed uploads and resumes failed media without refetching successes",async()=>{
    const failure=new Error('temporary image failure');
    const errorLog=vi.spyOn(console,'error').mockImplementation(()=>{});
    const client=mockLowiro();client.getChartImage.mockRejectedValue(failure);
    const job=await enqueue(env,'sync');
    let media=sent.shift()!;
    for(let i=0;i<4;i++){
      await deliver(media);
      if(sent.length){
        const continuation=sent.shift()!;
        expect(continuation.step).toBeGreaterThan(media.step);
        expect((env.JOBS.send as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[1]).toEqual({delaySeconds:30});
        media=continuation;
      }
    }
    expect(errorLog.mock.calls).toEqual(Array.from({length:4},()=>['[job] step failed',job.jobId,'media',failure]));
    errorLog.mockRestore();
    expect((await getJob(env,job.jobId)).status).toBe('failed');expect(client.getOnlineImage).toHaveBeenCalledTimes(1);
    const state=await new Store(env).sql('SELECT state FROM jobs WHERE id=?',job.jobId).first<string>('state');
    expect((await new Store(env).snapshot(JSON.parse(state!).snapshotId))?.mediaStatus).toBe('failed');
    client.getChartImage.mockResolvedValue({body:new Uint8Array([1,2,3]).buffer,contentType:'image/jpeg'});
    await retryJob(env,job.jobId);
    for(let i=0;i<20 && (await getJob(env,job.jobId)).status!=='succeeded';i++){const message=sent.shift();if(message)await deliver(message);}
    expect((await getJob(env,job.jobId)).status).toBe('succeeded');expect(client.getOnlineImage).toHaveBeenCalledTimes(1);
  });
});
