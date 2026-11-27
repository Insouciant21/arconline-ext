import { constantTimeEqual, sha256Hex } from "./auth";
import { renderAndStoreCustomB50 } from "./b50-poster-renderer";
import { CHART_CONSTANTS_VERSION } from "./chart-constants";
import type { Env } from "./environment";
import { AppError } from "./errors";
import { computeSnapshotStats } from "./history-view";
import { Store } from "./store";
import type { StoredUser } from "./types";

const BIND_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const BIND_CODE_LENGTH = 8;
const BIND_CODE_TTL_MS = 10 * 60 * 1000;

function randomBindCode() {
  const result: string[] = [];
  const limit = Math.floor(256 / BIND_CODE_ALPHABET.length) * BIND_CODE_ALPHABET.length;
  while (result.length < BIND_CODE_LENGTH) {
    const bytes = crypto.getRandomValues(new Uint8Array(BIND_CODE_LENGTH * 2));
    for (const byte of bytes) {
      if (byte >= limit) continue;
      result.push(BIND_CODE_ALPHABET[byte % BIND_CODE_ALPHABET.length]);
      if (result.length === BIND_CODE_LENGTH) break;
    }
  }
  return result.join("");
}

async function readStoredUser(env: Env): Promise<StoredUser | null> {
  const store = new Store(env);
  const profiles = await store.cache<StoredUser>("score-export", ["profile"]);
  if (profiles.profile) return profiles.profile;
  const latest = await store.latest();
  return latest?.user ?? null;
}

/**
 * Verify machine-to-machine gateway bearer secret for /api/bot/* routes.
 */
export async function requireBotBridge(env: Env, request: Request) {
  const expected = env.BOT_BRIDGE_SECRET?.trim();
  if (!expected) throw new AppError("未启用 QQ Bot 桥接服务。", 503, "BOT_BRIDGE_DISABLED");
  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  const supplied = match?.[1]?.trim() ?? "";
  if (!supplied || !(await constantTimeEqual(supplied, expected))) {
    throw new AppError("Bot 桥接鉴权失败。", 401, "BOT_BRIDGE_UNAUTHORIZED");
  }
}

export async function getBotBindStatus(env: Env) {
  const user = await readStoredUser(env);
  return {
    enabled: Boolean(env.BOT_BRIDGE_SECRET?.trim()),
    userCode: user?.userCode ?? null,
  };
}

/**
 * Issue a 10-minute one-time QQ binding code from the authenticated web panel.
 */
export async function issueBotBindCode(env: Env) {
  const status = await getBotBindStatus(env);
  if (!status.enabled) throw new AppError("未配置 BOT_BRIDGE_SECRET，暂无法生成绑定码。", 503, "BOT_BRIDGE_DISABLED");

  const code = randomBindCode();
  const codeHash = await sha256Hex(code);
  const now = Date.now();
  const expiresAt = now + BIND_CODE_TTL_MS;

  await env.DB.batch([
    env.DB.prepare("DELETE FROM bot_bind_codes WHERE expires_at <= ? OR used_at IS NOT NULL").bind(now),
    env.DB.prepare("INSERT INTO bot_bind_codes(code_hash, created_at, expires_at) VALUES(?, ?, ?)").bind(codeHash, now, expiresAt),
  ]);

  return {
    code,
    expiresAt: new Date(expiresAt).toISOString(),
    userCode: status.userCode,
  };
}

/**
 * Return basic player identity (including Arcaea userCode) for gateway auto-registration.
 */
export async function getBotProfilePayload(env: Env) {
  const user = await readStoredUser(env);
  if (!user) throw new AppError("尚未同步玩家资料，请先同步一次 B50。", 404, "PROFILE_NOT_FOUND");
  return {
    userCode: user.userCode ?? null,
    name: user.name ?? null,
    rating: user.rating,
  };
}

/**
 * Atomically verify and consume a one-time QQ binding code submitted by the gateway.
 */
export async function verifyBotBindCode(env: Env, request: Request) {
  let body: { code?: unknown };
  try { body = await request.json(); } catch { throw new AppError("请求格式无效。", 400, "INVALID_BODY"); }
  const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
  if (!/^[A-Z0-9]{6,32}$/.test(code)) {
    throw new AppError("绑定码格式无效。", 400, "BOT_BIND_CODE_INVALID");
  }

  const now = Date.now();
  const codeHash = await sha256Hex(code);
  const consumed = await env.DB.prepare(
    "UPDATE bot_bind_codes SET used_at = ? WHERE code_hash = ? AND used_at IS NULL AND expires_at > ? RETURNING code_hash",
  ).bind(now, codeHash, now).first<{ code_hash: string }>();

  if (!consumed) {
    throw new AppError("绑定码无效、已过期或已被使用。", 400, "BOT_BIND_CODE_INVALID");
  }

  const user = await readStoredUser(env);

  return {
    verified: true,
    user: user ? { name: user.name ?? null, userCode: user.userCode ?? null, rating: user.rating } : null,
  };
}

/**
 * Return the latest cached B50 snapshot and computed stats for the QQ gateway.
 */
export async function getBotB50Payload(
  env: Env,
  options: { ensureCustom?: boolean; rerenderCustom?: boolean; backgroundId?: string } = {},
) {
  const store = new Store(env);
  const latest = await store.latest();
  if (!latest) throw new AppError("尚未同步任何 B50 快照。", 404, "SNAPSHOT_NOT_FOUND");

  if ((options.rerenderCustom || (options.ensureCustom && !latest.customImageKey)) && env.ASSETS) {
    const previousCustomKey = latest.customImageKey;
    await renderAndStoreCustomB50(env, latest, {
      backgroundId: options.backgroundId,
    });
    await store.writeSnapshot(latest);
    await store.backup(latest).catch(() => {});
    if (previousCustomKey && previousCustomKey !== latest.customImageKey) {
      await env.ARCHIVE.delete(previousCustomKey).catch(() => {});
    }
  }

  return {
    snapshotId: latest.id,
    fetchedAt: latest.fetchedAt,
    potential: latest.potential,
    weightedPotential: latest.weightedPotential,
    constantsVersion: CHART_CONSTANTS_VERSION,
    mediaStatus: latest.mediaStatus ?? "complete",
    potentialImageKey: latest.potentialImageKey ?? null,
    customImageKey: latest.customImageKey ?? null,
    customImageTheme: latest.customImageTheme ?? null,
    customBackgroundId: latest.customBackgroundId ?? null,
    user: {
      name: latest.user.name ?? null,
      userCode: latest.user.userCode ?? null,
      rating: latest.user.rating,
      avatarImageKey: latest.user.avatarImageKey ?? null,
    },
    stats: computeSnapshotStats(latest),
    best50: latest.best50,
  };
}
