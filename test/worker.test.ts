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
  expect(fetch).toHaveBeenCalledTimes(3);
});

it("reports the upstream login status without exposing credentials or its response body", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ success: false, error_code: 104, detail: "private upstream body" }, { status: 400 }));
  await expect(ArcaeaClient.login(env)).rejects.toMatchObject({
    code: "ARCAEA_LOGIN_FAILED", message: "Arcaea 登录失败（HTTP 400，错误码 104），请检查账号配置或账号状态。",
  });
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
    expect(upstream).toHaveBeenCalledTimes(3);
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
  it("keeps daily maximum and latest chronologically, writes stable snapshots",async()=>{
    const store=new Store(env),first=fixture();await store.writeSnapshot(first);
    const later={...fixture('later',12.1),fetchedAt:'2026-10-14T11:00:00.000Z'};await store.writeSnapshot(later);await store.writeSnapshot(first);
    await store.mergeOfficial([{timePlayed:Date.parse('2026-10-14T12:00:00Z'),potential:12.8}]);
    expect((await store.snapshots()).length).toBe(2);expect((await store.latest())!.id).toBe('later');expect((await store.history())[0].potential).toBe(12.8);
    await store.exportArchive();expect(await env.ARCHIVE.head('exports/b50-history.csv')).not.toBeNull();
  });
  it("serves history summaries and on-demand snapshot detail",async()=>{
    const store=new Store(env);await store.writeSnapshot(fixture());
    const later={...fixture('2026-10-15-second',12.9),fetchedAt:'2026-10-15T11:00:00.000Z'};await store.writeSnapshot(later);
    const summaries=await store.snapshotSummaries();
    expect(summaries.map(summary=>summary.id)).toEqual(['2026-10-15-second','2026-10-14-first']);
    expect(summaries[0]).toMatchObject({potential:12.9,weightedPotential:12.5,trigger:'manual',entries:50,mediaStatus:'complete'});
    expect(JSON.stringify(summaries)).not.toContain('best50');
    expect((await api(env,request(`/api/snapshots/${later.id}`))).status).toBe(401);
    const cookie=await login();
    expect((await api(env,request('/api/snapshots/missing','GET',cookie))).status).toBe(404);
    const response=await api(env,request(`/api/snapshots/${later.id}`,'GET',cookie));
    expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({id:'2026-10-15-second',potential:12.9,mediaStatus:'complete'});
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
  it("retains the B50 formula and comparisons",()=>{
    expect(calculateWeightedPotential(Array(50).fill(12))).toBe(12);
    const before=fixture(),after=structuredClone(before);after.best50[0].score+=100;
    expect(compareSnapshots(before,after).filter(row=>row.kind==='changed')).toHaveLength(1);
  });
});
describe("durable queue pipeline",()=>{
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
    await deliver(sent.shift()!);await deliver(sent.shift()!);const media=sent.shift()!;
    for(let i=0;i<4;i++)await deliver(media);
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
