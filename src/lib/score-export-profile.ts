import { ArcaeaClient } from "./arcaea-client";
import { AppError } from "./errors";
import type { Env } from "./environment";
import { putAsset } from "./r2";
import type { ScoreExportProfile, StoredUser } from "./types";
import variants from "./score-result-characters.json";

const available = new Set(variants);

export function characterAssetId(user: StoredUser) {
  if (!Number.isSafeInteger(user.characterId) || (user.characterId ?? -1) < 0) return null;
  const suffix = user.characterUncapped && !user.characterUncappedOverride ? "u" : "";
  const id = `${user.characterId}${suffix}`;
  // Some partners have no separate awakened artwork. Reuse their own base art.
  return available.has(id) ? id : available.has(String(user.characterId)) ? String(user.characterId) : null;
}

export async function getScoreExportProfile(env: Env): Promise<ScoreExportProfile> {
  const client = await ArcaeaClient.login(env);
  const user = await client.getUser();
  const id = characterAssetId(user);
  if (!id) throw new AppError("当前搭档的立绘未收录，请更新结算素材。", 502, "CHARACTER_ART_UNAVAILABLE");
  if (!user.name) throw new AppError("未能取得当前用户名，请稍后重试。", 502, "EXPORT_PROFILE_INCOMPLETE");

  if (user.characterIcon && /^[a-f0-9]{32}$/i.test(user.characterIcon)) {
    const key = `characters/${user.characterIcon}.png`;
    try {
      if (!await env.ARCHIVE.head(key)) {
        const image = await client.getCharacterIconImage(user.characterIcon);
        await putAsset(env, key, image.body, image.contentType, { kind: "character" });
      }
      user.avatarImageKey = key;
      // Export canvases require same-origin media, independently of R2_PUBLIC_URL.
      user.avatarImageUrl = `/api/media/${key}`;
    } catch {
      // The APK contains the matching partner icon as an offline fallback.
      console.warn("Export avatar could not be cached; using the game icon.");
    }
  }
  return { user, characterAssetId: id };
}
