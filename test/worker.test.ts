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
    expect(first.headers.get('cache-control')).toBe('private, max-age=3600');
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
describe("D1 archives",()=>{
  it("keeps daily maximum and latest chronologically, writes stable snapshots",async()=>{
    const store=new Store(env),first=fixture();await store.writeSnapshot(first);
    const later={...fixture('later',12.1),fetchedAt:'2026-10-14T11:00:00.000Z'};await store.writeSnapshot(later);await store.writeSnapshot(first);
    await store.mergeOfficial([{timePlayed:Date.parse('2026-10-14T12:00:00Z'),potential:12.8}]);
    expect((await store.snapshots()).length).toBe(2);expect((await store.latest())!.id).toBe('later');expect((await store.history())[0].potential).toBe(12.8);
    await store.exportArchive();expect(await env.ARCHIVE.head('exports/b50-history.csv')).not.toBeNull();
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
