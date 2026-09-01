import { ArcaeaClient } from "./arcaea-client";
import { config, requireR2 } from "./config";
import {
  getLocalDate,
  mergeCharacterImageMap,
  mergeChartImageMap,
  readCharacterImageMap,
  readChartImageMap,
  withFileLock,
  writeSnapshot,
} from "./file-store";
import { putAsset, putSnapshot, publicAssetUrl } from "./r2";
import { calculateWeightedPotential, formatPotential } from "./potential";
import type {
  B50Snapshot,
  Best50Score,
  CharacterImageCache,
  CharacterImageCacheEntry,
  ChartImageCache,
  ChartImageCacheEntry,
  ImageStats,
  StoredUser,
} from "./types";

export type SyncTrigger = "manual" | "daily" | "cron";

interface MediaSyncJob {
  client: ArcaeaClient;
  snapshot: B50Snapshot;
}

export async function runSync(trigger: SyncTrigger): Promise<B50Snapshot> {
  const job = await withFileLock("sync", async (): Promise<MediaSyncJob> => {
    requireR2();
    const client = await ArcaeaClient.login();
    const remote = await client.fetchB50Snapshot();
    const [chartImageMap, characterImageMap] = await Promise.all([
      readChartImageMap(),
      readCharacterImageMap(),
    ]);
    const fetchedAt = new Date().toISOString();
    const id = snapshotId(new Date(fetchedAt));
    const best50 = remote.best50.map((score) => enrichScoreFromCache(score, chartImageMap));
    const user = enrichUserFromCache(remote.user, characterImageMap);
    const uniqueScores = dedupeByBackground(best50);
    const imageStats: ImageStats = {
      requested: uniqueScores.length,
      uploaded: 0,
      failed: 0,
      failures: [],
      cached: uniqueScores.filter((score) => Boolean(cachedChartImageForScore(score, chartImageMap))).length,
    };
    const snapshot: B50Snapshot = {
      id,
      fetchedAt,
      trigger,
      potential: formatPotential(remote.user.rating),
      weightedPotential: formatPotential(calculateWeightedPotential(best50.map((score) => score.rating))),
      user,
      best50,
      imageStats,
      mediaStatus: "processing",
    };

    // Persist the score data before any media request. The API can now return
    // the B50 while the image pipeline continues in the background.
    await persistSnapshot(snapshot);
    return { client, snapshot };
  });

  // The self-hosted Docker process remains alive after the response. Keep the
  // media work detached so the B50 response is not held by Lowiro/R2 latency.
  void finishMediaSync(job);
  return job.snapshot;
}

async function finishMediaSync({ client, snapshot }: MediaSyncJob) {
  try {
    requireR2();
    const [potentialResult, chartResult, characterResult] = await Promise.all([
      uploadPotentialImage(client, snapshot),
      uploadChartImages(client, snapshot.best50),
      uploadCharacterImage(client, snapshot.user),
    ]);
    const best50 = snapshot.best50.map((score) => enrichScore(score, chartResult.imagesByBackground));
    const failures = [...chartResult.failures];
    if (potentialResult.error) {
      failures.push({ songId: "__potential__", reason: potentialResult.error });
    }
    if (characterResult.error) {
      failures.push({ songId: "__avatar__", reason: characterResult.error });
    }
    const mediaError = failures.length > 0
      ? potentialResult.error || `${failures.length} 个媒体资源上传失败。`
      : undefined;
    const updatedSnapshot: B50Snapshot = {
      ...snapshot,
      user: characterResult.user,
      best50,
      ...(potentialResult.key
        ? {
            potentialImageKey: potentialResult.key,
            potentialImageUrl: publicAssetUrl(potentialResult.key),
          }
        : {}),
      imageStats: {
        ...snapshot.imageStats,
        uploaded: chartResult.uploaded,
        failed: failures.length,
        failures,
        cached: chartResult.cached,
      },
      mediaStatus: failures.length > 0 ? "failed" : "complete",
      ...(mediaError ? { mediaError } : {}),
    };
    await persistSnapshot(updatedSnapshot);
  } catch (error) {
    const mediaError = error instanceof Error ? error.message : "媒体同步失败。";
    const failedSnapshot = { ...snapshot, mediaStatus: "failed" as const, mediaError };
    try {
      await persistSnapshot(failedSnapshot);
    } catch (persistError) {
      console.error("[sync] failed to persist media error", persistError);
    }
    console.error(`[sync] background media sync failed for ${snapshot.id}`, error);
  }
}

async function persistSnapshot(snapshot: B50Snapshot) {
  await writeSnapshot(snapshot);
  await putSnapshot(snapshot);
}

async function uploadPotentialImage(client: ArcaeaClient, snapshot: B50Snapshot) {
  try {
    const image = await client.getOnlineImage();
    const extension = extensionForContentType(image.contentType);
    const key = `potential/${snapshot.id}${extension}`;
    await putAsset(key, image.body, image.contentType, {
      kind: "potential",
      snapshotId: snapshot.id,
    });
    return { key };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "潜力值图片同步失败。" };
  }
}

async function uploadChartImages(client: ArcaeaClient, scores: Best50Score[]) {
  const chartImageMap = await readChartImageMap();
  const imagesByBackground = new Map<string, ChartImageCacheEntry>();
  const failures: Array<{ songId: string; reason: string }> = [];
  let uploaded = 0;
  let cached = 0;
  const uniqueScores = dedupeByBackground(scores);
  const missingScores = uniqueScores.filter((score) => {
    const cachedImage = cachedChartImageForScore(score, chartImageMap);
    if (!cachedImage || !score.bg) return true;
    imagesByBackground.set(score.bg, normalizeChartImage(cachedImage));
    cached += 1;
    return false;
  });

  await mapWithConcurrency(missingScores, 6, async (score) => {
    if (!score.bg) return;
    const key = `charts/${score.bg}.jpg`;
    try {
      const image = await client.getChartImage(score.bg);
      await putAsset(key, image.body, image.contentType, {
        kind: "chart",
        songId: score.songId,
        difficulty: String(score.difficulty),
      });
      imagesByBackground.set(score.bg, {
        songId: score.songId,
        bg: score.bg,
        imageKey: key,
        imageUrl: publicAssetUrl(key),
        updatedAt: new Date().toISOString(),
      });
      uploaded += 1;
    } catch (error) {
      failures.push({
        songId: score.songId,
        reason: error instanceof Error ? error.message : "曲绘同步失败。",
      });
    }
  });

  const cacheEntries: ChartImageCache = {};
  const updatedAt = new Date().toISOString();
  for (const score of scores) {
    if (!score.bg) continue;
    const image = imagesByBackground.get(score.bg);
    if (!image || !score.songId) continue;
    cacheEntries[score.songId] = { ...image, songId: score.songId, bg: score.bg, updatedAt };
  }
  await mergeChartImageMap(cacheEntries);
  return { imagesByBackground, uploaded, cached, failures };
}

async function uploadCharacterImage(client: ArcaeaClient, user: StoredUser) {
  const characterId = user.characterId;
  const characterIcon = user.characterIcon;
  if (characterId === undefined || !characterIcon) {
    return { user };
  }

  return withFileLock(`character-upload-${characterId}`, async () => {
    const characterImageMap = await readCharacterImageMap();
    const cachedImage = cachedCharacterImageForUser(user, characterImageMap);
    if (cachedImage) {
      return { user: enrichUserFromCache(user, characterImageMap) };
    }

    const key = `characters/${characterIcon}.png`;
    try {
      const image = await client.getCharacterIconImage(characterIcon);
      await putAsset(key, image.body, image.contentType, {
        kind: "character",
        characterId: String(characterId),
        icon: characterIcon,
      });
      const entry: CharacterImageCacheEntry = {
        characterId,
        icon: characterIcon,
        imageKey: key,
        imageUrl: publicAssetUrl(key),
        updatedAt: new Date().toISOString(),
      };
      await mergeCharacterImageMap({ [String(characterId)]: entry });
      return {
        user: {
          ...user,
          avatarImageKey: key,
          avatarImageUrl: publicAssetUrl(key),
        },
      };
    } catch (error) {
      return {
        user,
        error: error instanceof Error ? error.message : "角色头像同步失败。",
      };
    }
  });
}

function enrichScoreFromCache(score: Best50Score, chartImageMap: ChartImageCache) {
  const cachedImage = cachedChartImageForScore(score, chartImageMap);
  return cachedImage ? enrichScore(score, new Map([[score.bg || score.songId, normalizeChartImage(cachedImage)]])) : score;
}

function enrichUserFromCache(user: StoredUser, characterImageMap: CharacterImageCache) {
  const cachedImage = cachedCharacterImageForUser(user, characterImageMap);
  if (!cachedImage) return user;
  const imageUrl = cachedImage.imageKey
    ? publicAssetUrl(cachedImage.imageKey)
    : cachedImage.imageUrl;
  return {
    ...user,
    ...(cachedImage.imageKey ? { avatarImageKey: cachedImage.imageKey } : {}),
    ...(imageUrl ? { avatarImageUrl: imageUrl } : {}),
  };
}

function enrichScore(
  score: Best50Score,
  imagesByBackground: Map<string, ChartImageCacheEntry>,
): Best50Score {
  const image = score.bg ? imagesByBackground.get(score.bg) : undefined;
  return {
    ...score,
    ...(image
      ? {
          ...(image.imageKey ? { imageKey: image.imageKey } : {}),
          ...(image.imageUrl ? { imageUrl: image.imageUrl } : {}),
        }
      : {}),
  };
}

function cachedChartImageForScore(score: Best50Score, chartImageMap: ChartImageCache) {
  const direct = chartImageMap[score.songId];
  if (direct && sameBackground(score, direct)) return direct;
  if (!score.bg) return undefined;
  return Object.values(chartImageMap).find((entry) => entry.bg === score.bg);
}

function cachedCharacterImageForUser(
  user: StoredUser,
  characterImageMap: CharacterImageCache,
) {
  if (user.characterId === undefined || !user.characterIcon) return undefined;
  const direct = characterImageMap[String(user.characterId)];
  if (direct && sameCharacter(user, direct) && (direct.imageKey || direct.imageUrl)) {
    return direct;
  }
  return Object.values(characterImageMap).find(
    (entry) => sameCharacter(user, entry) && Boolean(entry.imageKey || entry.imageUrl),
  );
}

function sameCharacter(user: StoredUser, entry: CharacterImageCacheEntry) {
  return (
    user.characterId === entry.characterId &&
    (!entry.icon || !user.characterIcon || entry.icon === user.characterIcon)
  );
}

function sameBackground(score: Best50Score, entry: ChartImageCacheEntry) {
  return !score.bg || !entry.bg || score.bg === entry.bg;
}

function normalizeChartImage(entry: ChartImageCacheEntry): ChartImageCacheEntry {
  return {
    ...entry,
    ...(entry.imageKey ? { imageUrl: publicAssetUrl(entry.imageKey) } : {}),
  };
}

function dedupeByBackground(scores: Best50Score[]) {
  const seen = new Set<string>();
  return scores.filter((score) => {
    if (!score.bg || seen.has(score.bg)) return false;
    seen.add(score.bg);
    return true;
  });
}

async function mapWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const current = items[cursor];
      cursor += 1;
      await worker(current);
    }
  });
  await Promise.all(workers);
}

function extensionForContentType(contentType: string) {
  if (contentType.includes("png")) return ".png";
  if (contentType.includes("webp")) return ".webp";
  return ".jpg";
}

function snapshotId(date: Date) {
  return `${getLocalDate(date)}-${date
    .toISOString()
    .slice(11, 23)
    .replaceAll(":", "")}`;
}

export function schedulerDescription() {
  return { timezone: config.timezone, cron: config.cronExpression };
}
