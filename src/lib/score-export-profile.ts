import type { ArcaeaClient } from "./arcaea-client";
import { AppError } from "./errors";
import type { Env } from "./environment";
import { publicAssetUrl, putAsset } from "./r2";
import { Store } from "./store";
import type { ScoreExportProfile, StoredUser } from "./types";
import variants from "./score-result-characters.json";

const available = new Set(variants);
const resourcePattern = /^[a-f0-9]{32}$/i;

export function characterAssetId(user: StoredUser) {
  if (!Number.isSafeInteger(user.characterId) || (user.characterId ?? -1) < 0) return null;
  const suffix = user.characterUncapped && !user.characterUncappedOverride ? "u" : "";
  const id = `${user.characterId}${suffix}`;
  // Some partners have no separate awakened artwork. Reuse their own base art.
  return available.has(id) ? id : available.has(String(user.characterId)) ? String(user.characterId) : null;
}

// Run only during B50 synchronization, using the same already-authenticated
// client and user response. Persist independently of score snapshot deduplication.
export async function cacheScoreExportProfile(store: Store, source: StoredUser, getClient: () => Promise<ArcaeaClient>) {
  const user = { ...source };
  async function cacheAvatar() {
    if (!user.characterIcon || !resourcePattern.test(user.characterIcon)) return;
    const key = `characters/${user.characterIcon}.png`;
    try {
      if (user.avatarImageKey !== key && !await store.env.ARCHIVE.head(key)) {
        const image = await (await getClient()).getCharacterIconImage(user.characterIcon);
        await putAsset(store.env, key, image.body, image.contentType, { kind: "character" });
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
      if (!await store.env.ARCHIVE.head(key)) {
        const image = await (await getClient()).getBannerImage(user.bannerResource);
        await putAsset(store.env, key, image.body, image.contentType, { kind: "banner" });
      }
      user.bannerImageKey = key;
    } catch {
      throw new AppError("名片同步失败，请重试获取 B50。", 502, "EXPORT_BANNER_UNAVAILABLE");
    }
  }
  // Settle all uploads before allowing the durable job to retry.
  const results = await Promise.allSettled([cacheAvatar(), cacheBanner()]);
  const failure = results.find(result => result.status === "rejected");
  if (failure?.status === "rejected") throw failure.reason;
  await store.putCache("score-export", "profile", user);
  return user;
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
