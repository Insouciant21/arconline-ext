import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env as bindings } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { api } from "../src/lib/api";
import { ArcaeaClient } from "../src/lib/arcaea-client";
import { sha256Hex } from "../src/lib/auth";
import type { Env, JobMessage } from "../src/lib/environment";
import type { B50Snapshot } from "../src/lib/types";
import { Store } from "../src/lib/store";

let env: Env;
let sent: JobMessage[];

function snapshotFixture(id = "2026-11-27-bot-test"): B50Snapshot {
  return {
    id,
    fetchedAt: "2026-11-27T01:00:00.000Z",
    trigger: "manual",
    potential: 12.654,
    weightedPotential: 12.654321,
    potentialImageKey: `potential/${id}.image`,
    user: { rating: 12.654, name: "Hikari", userCode: "123456789" },
    imageStats: { requested: 1, uploaded: 1, failed: 0, failures: [] },
    mediaStatus: "complete",
    best50: Array.from({ length: 50 }, (_, index) => ({
      songId: `song${index}`,
      difficulty: 2,
      modifier: 0,
      rating: 13 - index / 100,
      score: 9900000 - index * 1000,
      perfectCount: 1000,
      nearCount: 2,
      missCount: 1,
      clearType: 1,
      title: { en: `Song ${index}` },
      artist: "Tester",
      timePlayed: 1700000000000,
      bg: "a".repeat(32),
    })),
  };
}

function panelRequest(path: string, method = "GET", cookie = "", body?: unknown, origin = "https://arc.example") {
  return new Request(`https://arc.example${path}`, {
    method,
    headers: { origin, cookie, "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

function botRequest(path: string, method = "GET", secret?: string, body?: unknown) {
  return new Request(`https://arc.example${path}`, {
    method,
    headers: {
      ...(secret ? { authorization: `Bearer ${secret}` } : {}),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

async function loginPanel() {
  const response = await api(env, panelRequest("/api/auth/login", "POST", "", { token: "test-token" }));
  expect(response.status).toBe(200);
  return response.headers.get("set-cookie")!.split(";")[0];
}

beforeEach(async () => {
  const source = bindings as unknown as Env & { TEST_MIGRATIONS: D1Migration[] };
  await applyD1Migrations(source.DB, source.TEST_MIGRATIONS);
  sent = [];
  env = {
    ...source,
    ADMIN_TOKEN: "test-token",
    BOT_BRIDGE_SECRET: "bridge-secret-123",
    JOBS: { send: async (message: JobMessage) => { sent.push(message); } } as unknown as Queue<JobMessage>,
  };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("QQ bot bridge endpoints", () => {
  it("disables /api/bot/* and bind code issuing when BOT_BRIDGE_SECRET is unset", async () => {
    const disabledEnv: Env = { ...env, BOT_BRIDGE_SECRET: undefined };
    const cookie = await loginPanel();

    const statusRes = await api(disabledEnv, panelRequest("/api/bot-bind-codes", "GET", cookie));
    expect(statusRes.status).toBe(200);
    expect(await statusRes.json()).toEqual({ enabled: false, userCode: null });

    const issueRes = await api(disabledEnv, panelRequest("/api/bot-bind-codes", "POST", cookie));
    expect(issueRes.status).toBe(503);

    const botRes = await api(disabledEnv, botRequest("/api/bot/b50", "GET", "bridge-secret-123"));
    expect(botRes.status).toBe(503);
  });

  it("rejects unauthorized /api/bot/* requests without valid bearer secret", async () => {
    const missing = await api(env, botRequest("/api/bot/b50", "GET"));
    expect(missing.status).toBe(401);

    const wrong = await api(env, botRequest("/api/bot/b50", "GET", "wrong-secret"));
    expect(wrong.status).toBe(401);

    const adminTokenAttempt = await api(env, botRequest("/api/bot/b50", "GET", "test-token"));
    expect(adminTokenAttempt.status).toBe(401);
  });

  it("issues and atomically consumes one-time bind codes and rejects expired codes", async () => {
    const cookie = await loginPanel();
    const store = new Store(env);
    await store.writeSnapshot(snapshotFixture());

    const issueRes = await api(env, panelRequest("/api/bot-bind-codes", "POST", cookie));
    expect(issueRes.status).toBe(200);
    const issued = await issueRes.json() as { code: string; expiresAt: string; userCode: string };
    expect(issued.code).toMatch(/^[A-Z0-9]{8}$/);
    expect(issued.userCode).toBe("123456789");

    const profileRes = await api(env, botRequest("/api/bot/profile", "GET", "bridge-secret-123"));
    expect(profileRes.status).toBe(200);
    expect(await profileRes.json()).toEqual({ userCode: "123456789", name: "Hikari", rating: 12.654 });

    const verifyRes = await api(env, botRequest("/api/bot/bind/verify", "POST", "bridge-secret-123", { code: issued.code.toLowerCase() }));
    expect(verifyRes.status).toBe(200);
    const verified = await verifyRes.json() as { verified: boolean; user: { name: string; userCode: string; rating: number } };
    expect(verified.verified).toBe(true);
    expect(verified.user).toEqual({ name: "Hikari", userCode: "123456789", rating: 12.654 });

    const reuseRes = await api(env, botRequest("/api/bot/bind/verify", "POST", "bridge-secret-123", { code: issued.code }));
    expect(reuseRes.status).toBe(400);

    const expiredHash = await sha256Hex("EXPIRED1");
    await env.DB.prepare("INSERT INTO bot_bind_codes(code_hash, created_at, expires_at) VALUES(?, ?, ?)")
      .bind(expiredHash, Date.now() - 20_000, Date.now() - 10_000).run();
    const expiredRes = await api(env, botRequest("/api/bot/bind/verify", "POST", "bridge-secret-123", { code: "EXPIRED1" }));
    expect(expiredRes.status).toBe(400);
  });

  it("returns B50 payload, streams R2 media, and enqueues sync jobs", async () => {
    const snapshot = snapshotFixture();
    await new Store(env).writeSnapshot(snapshot);
    await env.ARCHIVE.put(snapshot.potentialImageKey!, new Uint8Array([137, 80, 78, 71]), {
      httpMetadata: { contentType: "image/png" },
    });

    const b50Res = await api(env, botRequest("/api/bot/b50", "GET", "bridge-secret-123"));
    expect(b50Res.status).toBe(200);
    const b50 = await b50Res.json() as { snapshotId: string; potentialImageKey: string; best50: unknown[]; stats: { top10Avg: number } };
    expect(b50.snapshotId).toBe(snapshot.id);
    expect(b50.potentialImageKey).toBe(snapshot.potentialImageKey);
    expect(b50.best50).toHaveLength(50);
    expect(b50.stats.top10Avg).toBeGreaterThan(12);

    const mediaRes = await api(env, botRequest(`/api/bot/media/${snapshot.potentialImageKey}`, "GET", "bridge-secret-123"));
    expect(mediaRes.status).toBe(200);
    expect(mediaRes.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await mediaRes.arrayBuffer())).toEqual(new Uint8Array([137, 80, 78, 71]));

    const badMediaRes = await api(env, botRequest("/api/bot/media/..%2Fsecret", "GET", "bridge-secret-123"));
    expect(badMediaRes.status).toBe(400);

    const syncRes = await api(env, botRequest("/api/bot/sync", "POST", "bridge-secret-123"));
    expect(syncRes.status).toBe(202);
    const syncBody = await syncRes.json() as { jobId: string; status: string };
    expect(sent).toHaveLength(1);
    expect(sent[0].jobId).toBe(syncBody.jobId);

    const jobRes = await api(env, botRequest(`/api/bot/jobs/${syncBody.jobId}`, "GET", "bridge-secret-123"));
    expect(jobRes.status).toBe(200);
    expect((await jobRes.json() as { id: string }).id).toBe(syncBody.jobId);
  });

  it("exposes custom B50 metadata, streams custom/ R2 media, and enforces rerender guards", async () => {
    const snapshot: B50Snapshot = {
      ...snapshotFixture("2026-11-27-custom-test"),
      customImageKey: "custom/2026-11-27-custom-test-bg-04-abc123.jpg",
      customImageTheme: "dark",
      customBackgroundId: "bg-04",
    };
    const store = new Store(env);
    await store.writeSnapshot(snapshot);
    await env.ARCHIVE.put(snapshot.customImageKey!, new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), {
      httpMetadata: { contentType: "image/jpeg" },
    });

    const enriched = await store.latest();
    expect(enriched?.customImageUrl).toBe(`/api/media/custom/${encodeURIComponent("2026-11-27-custom-test-bg-04-abc123.jpg")}`);

    const b50Res = await api(env, botRequest("/api/bot/b50", "GET", "bridge-secret-123"));
    expect(b50Res.status).toBe(200);
    const b50 = await b50Res.json() as {
      customImageKey: string | null;
      customImageTheme: string | null;
      customBackgroundId: string | null;
    };
    expect(b50.customImageKey).toBe(snapshot.customImageKey);
    expect(b50.customImageTheme).toBe("dark");
    expect(b50.customBackgroundId).toBe("bg-04");

    const customMediaRes = await api(env, botRequest(`/api/bot/media/${snapshot.customImageKey}`, "GET", "bridge-secret-123"));
    expect(customMediaRes.status).toBe(200);
    expect(customMediaRes.headers.get("content-type")).toBe("image/jpeg");
    expect(new Uint8Array(await customMediaRes.arrayBuffer())).toEqual(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]));

    const traversalRes = await api(env, botRequest("/api/bot/media/custom/..%2Fsecret.jpg", "GET", "bridge-secret-123"));
    expect(traversalRes.status).toBe(400);

    const invalidBgRes = await api(env, botRequest("/api/bot/b50/rerender?bg=../../bad", "POST", "bridge-secret-123"));
    expect(invalidBgRes.status).toBe(400);

    const maintenanceEnv: Env = { ...env, MUTATIONS_ENABLED: "false" };
    const maintRes = await api(maintenanceEnv, botRequest("/api/bot/b50/rerender", "POST", "bridge-secret-123"));
    expect(maintRes.status).toBe(503);
  });

  it("executes /api/bot/sync inline inside waitUntil without queueing when unchanged B50 finishes fast", async () => {
    await env.DB.batch([env.DB.prepare("DELETE FROM outbox"), env.DB.prepare("DELETE FROM jobs")]);
    const snapshot = snapshotFixture("2026-11-27-inline-test");
    await new Store(env).writeSnapshot(snapshot);
    vi.spyOn(ArcaeaClient, "login").mockResolvedValue({
      fetchB50Snapshot: async () => ({ user: snapshot.user, best50: snapshot.best50 }),
      getPotentialHistory: async () => [],
    } as unknown as ArcaeaClient);

    const pending: Promise<unknown>[] = [];
    const syncRes = await api(env, botRequest("/api/bot/sync", "POST", "bridge-secret-123"), {
      waitUntil: (promise) => { pending.push(promise); },
    });
    expect(syncRes.status).toBe(202);
    const { jobId } = await syncRes.json() as { jobId: string };
    expect(pending).toHaveLength(1);
    await Promise.all(pending);

    expect(sent).toHaveLength(0);
    const jobRes = await api(env, botRequest(`/api/bot/jobs/${jobId}`, "GET", "bridge-secret-123"));
    expect(jobRes.status).toBe(200);
    const job = await jobRes.json() as { status: string; result?: { recorded: boolean } };
    expect(job.status).toBe("succeeded");
    expect(job.result?.recorded).toBe(false);
  });
});
