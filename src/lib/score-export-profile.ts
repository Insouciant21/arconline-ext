import { ArcaeaClient } from "./arcaea-client";
import { AppError } from "./errors";
import type { Env } from "./environment";
import { publicAssetUrl, putAsset } from "./r2";
import { Store } from "./store";
import type { ScoreExportProfile, StoredUser } from "./types";
import { measure, type Profiler } from "./profiling";
import { characterAssetId } from "./score-result-character";
export { characterAssetId } from "./score-result-character";

const resourcePattern = /^[a-f0-9]{32}$/i;

// B50 sync and export refreshes share this cache, independently of score
// snapshot deduplication, using the caller's already-authenticated client.
export async function cacheScoreExportProfile(store: Store, source: StoredUser, getClient: () => Promise<ArcaeaClient>, profiling?: Profiler) {
  const user = { ...source };
  async function cacheAvatar() {
    if (!user.characterIcon || !resourcePattern.test(user.characterIcon)) return;
    const key = `characters/${user.characterIcon}.png`;
    try {
      if (user.avatarImageKey !== key && !await measure(profiling, "r2.avatar.head", () => store.env.ARCHIVE.head(key))) {
        const image = await (await getClient()).getCharacterIconImage(user.characterIcon);
        await measure(profiling, "r2.avatar.put", () => putAsset(store.env, key, image.body, image.contentType, { kind: "character" }));
      }
      user.avatarImageKey = key;
      user.avatarImageUrl = publicAssetUrl(store.env, key);
    } catch {
      delete user.avatarImageKey;
      delete user.avatarImageUrl;
      // The APK contains the matching partner icon as an offline fallback.
      console.warn("Export avatar could not be cached; using the game icon.");
    }
  }
  async function cacheBanner() {
    delete user.bannerImageKey;
    if (!user.bannerResource || !resourcePattern.test(user.bannerResource)) return;
    const key = `banners/${user.bannerResource}.png`;
    try {
      if (!await measure(profiling, "r2.banner.head", () => store.env.ARCHIVE.head(key))) {
        const image = await (await getClient()).getBannerImage(user.bannerResource);
        await measure(profiling, "r2.banner.put", () => putAsset(store.env, key, image.body, image.contentType, { kind: "banner" }));
      }
      user.bannerImageKey = key;
    } catch {
      throw new AppError("名片同步失败，请稍后重试。", 502, "EXPORT_BANNER_UNAVAILABLE");
    }
  }
  // Settle all uploads before allowing the durable job to retry.
  const results = await Promise.allSettled([cacheAvatar(), cacheBanner()]);
  const failure = results.find(result => result.status === "rejected");
  if (failure?.status === "rejected") throw failure.reason;
  await measure(profiling, "d1.profile.write", () => store.putCache("score-export", "profile", user));
  return user;
}

export async function refreshScoreExportProfile(env: Env, profiling?: Profiler): Promise<ScoreExportProfile> {
  const client = await ArcaeaClient.login(env, profiling);
  const user = await client.getUser();
  if (!user.name || user.characterId === undefined || !Number.isFinite(user.rating)) {
    throw new AppError("官网返回的用户资料不完整，请稍后重试。", 502, "EXPORT_PROFILE_INVALID");
  }
  const stored = await cacheScoreExportProfile(new Store(env), user, async () => client, profiling);
  return exportProfile(env, stored);
}

export async function getScoreExportProfile(env: Env): Promise<ScoreExportProfile> {
  const store = new Store(env);
  let stored = (await store.cache<StoredUser>("score-export", ["profile"])).profile;
  if (!stored) {
    // Older installations already have user data in their latest snapshot.
    // Read only that field, without loading or enriching all 50 score rows.
    const row = await store.sql("SELECT json_extract(body,'$.user') AS user FROM snapshots ORDER BY fetched_at DESC,id DESC LIMIT 1").first<{ user: string }>();
    if (row?.user) stored = JSON.parse(row.user) as StoredUser;
  }
  return exportProfile(env, stored);
}

async function exportProfile(env: Env, stored: StoredUser | undefined): Promise<ScoreExportProfile> {
  if (!stored?.name || stored.characterId === undefined || !Number.isFinite(stored.rating)) {
    throw new AppError("请先获取一次 B50，同步导出所需的用户资料。", 409, "EXPORT_PROFILE_MISSING");
  }
  const user = { ...stored }, id = characterAssetId(user);
  if (!id) throw new AppError("当前搭档的立绘未收录，请更新结算素材。", 502, "CHARACTER_ART_UNAVAILABLE");
  // Export canvases always use authenticated same-origin media, independently
  // of the public image domain stored for the rest of the dashboard.
  delete user.avatarImageUrl;
  if (user.avatarImageKey && /^characters\/[a-f0-9]{32}\.png$/i.test(user.avatarImageKey)) {
    user.avatarImageUrl = `/api/media/${user.avatarImageKey}`;
  }
  let bannerImageUrl: string | undefined;
  if (user.bannerResource && resourcePattern.test(user.bannerResource)) {
    const key = `banners/${user.bannerResource}.png`;
    if (user.bannerImageKey !== key && !await env.ARCHIVE.head(key)) {
      throw new AppError("请先获取一次 B50，同步导出所需的名片。", 409, "EXPORT_PROFILE_MISSING");
    }
    bannerImageUrl = `/api/media/${key}`;
  }
  return { user, characterAssetId: id, ...(bannerImageUrl ? { bannerImageUrl } : {}) };
}
