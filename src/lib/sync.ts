import { ArcaeaClient } from "./arcaea-client";
import { sameB50, scoreMediaKey } from "./b50";
import { getConfig, getLocalDate } from "./config";
import type { Env } from "./environment";
import { AppError } from "./errors";
import type { JobRow } from "./jobs";
import { importOfficialHistory } from "./official-history";
import { calculateWeightedPotential, formatPotential } from "./potential";
import { publicAssetUrl, putAsset } from "./r2";
import { Store } from "./store";
import type { B50Snapshot, CharacterImageCacheEntry, ChartImageCacheEntry, JobView } from "./types";

type MediaItem = { kind: "potential" | "chart" | "character"; key: string; bg?: string; icon?: string; characterId?: number; songId?: string; done?: boolean; cached?: boolean };
export interface SyncState { snapshotId?: string; media?: MediaItem[]; preview?: B50Snapshot; duplicateOf?: string; historyMessage?: string; }
type StepResult = { stage: string; state: SyncState; result?: NonNullable<JobView["result"]> };

export async function runStep(env: Env, job: JobRow, checkpoint: (state: SyncState) => Promise<void>): Promise<StepResult> {
  const store = new Store(env), state = JSON.parse(job.state) as SyncState;
  if (job.stage === "fetch") {
    if (job.kind === "retry") {
      const snapshot = state.snapshotId ? await store.snapshot(state.snapshotId) : await store.latest();
      if (!snapshot) throw new AppError("没有可重试的快照。", 404, "SNAPSHOT_MISSING");
      state.snapshotId = snapshot.id;
      snapshot.mediaStatus = "processing"; delete snapshot.mediaError;
      await store.writeSnapshot(snapshot);
      state.media = mediaItems(snapshot);
      await checkpoint(state);
      return { stage: "media", state };
    }
    const client = await ArcaeaClient.login(env);
    if (job.kind === "import") {
      const imported = await importOfficialHistory(store, client);
      state.historyMessage = `已同步官网历史 PTT，共保存 ${imported.total} 个原始数据点。`;
      return { stage: "archive", state };
    }
    // Reuse a checkpoint if the worker stopped after the score write.
    const snapshotId = state.snapshotId || `${getLocalDate(job.created_at, getConfig(env).timezone)}-${job.id}`;
    const saved = await store.snapshot(snapshotId);
    if (saved) {
      state.snapshotId = saved.id; state.media = mediaItems(saved);
      await checkpoint(state);
      return { stage: "history", state };
    }
    const remote = await client.fetchB50Snapshot();
    await store.aliases(remote.best50);
    const previous = await store.latest();
    const snapshot: B50Snapshot = {
      id: snapshotId, fetchedAt: new Date().toISOString(), trigger: job.trigger,
      potential: formatPotential(remote.user.rating), weightedPotential: formatPotential(calculateWeightedPotential(remote.best50.map(score => score.rating))),
      user: remote.user, best50: remote.best50,
      imageStats: { requested: new Set(remote.best50.map(score => score.bg).filter(Boolean)).size, uploaded: 0, failed: 0, failures: [], cached: 0 }, mediaStatus: "processing",
    };
    await enrichCached(store, snapshot);
    if (previous && sameB50(previous, snapshot)) {
      const scores = new Map(previous.best50.map(score => [scoreMediaKey(score), score]));
      snapshot.best50 = snapshot.best50.map(score => ({ ...scores.get(scoreMediaKey(score)), ...score }));
      snapshot.potentialImageKey = previous.potentialImageKey;
      snapshot.potentialImageUrl = previous.potentialImageKey ? publicAssetUrl(env, previous.potentialImageKey) : previous.potentialImageUrl;
      snapshot.mediaStatus = previous.mediaStatus || "complete";
      snapshot.mediaError = previous.mediaError;
      state.preview = snapshot; state.duplicateOf = previous.id;
    } else {
      state.snapshotId = snapshot.id;
      await store.writeSnapshot(snapshot);
      state.media = mediaItems(snapshot);
    }
    await checkpoint(state);
    await store.log({ scope: "b50", level: state.duplicateOf ? "warning" : "success", action: state.duplicateOf ? "skipped" : "recorded", message: state.duplicateOf ? "B50 未变化，跳过快照和媒体归档。" : "B50 已保存，继续处理历史和媒体。", snapshotId: snapshot.id });
    return { stage: "history", state };
  }
  if (job.stage === "history") {
    // History failure must not discard a successfully fetched B50.
    try {
      const client = await ArcaeaClient.login(env);
      const scores = state.preview?.best50 || (state.snapshotId ? (await store.snapshot(state.snapshotId))?.best50 : undefined);
      await importOfficialHistory(store, client, scores);
    } catch (error) {
      await store.log({ scope: "b50", level: "warning", action: "history-import-failed", message: `官网历史导入失败，保留已有数据：${error instanceof Error ? error.message : "未知错误"}` });
    }
    if (state.preview) return { stage: "archive", state };
    return { stage: "media", state };
  }
  if (job.stage === "media") {
    const snapshot = state.snapshotId ? await store.snapshot(state.snapshotId) : null;
    if (!snapshot) throw new AppError("任务快照不存在。", 404, "SNAPSHOT_MISSING");
    snapshot.mediaStatus = "processing"; delete snapshot.mediaError;
    const items = state.media || (state.media = mediaItems(snapshot));
    const pending = items.filter(item => !item.done).slice(0, 8);
    const client = pending.length ? await ArcaeaClient.login(env) : null;
    // Checkpoint after each pair: a redelivery can HEAD deterministic R2 keys
    // and recover an upload that finished before its database checkpoint.
    for (let i = 0; i < pending.length; i += 2) {
      const pair = pending.slice(i, i + 2);
      const results = await Promise.allSettled(pair.map(async item => {
        const exists = await env.ARCHIVE.head(item.key);
        if (!exists) {
          const image = item.kind === "potential" ? await client!.getOnlineImage() : item.kind === "chart" ? await client!.getChartImage(item.bg!) : await client!.getCharacterIconImage(item.icon!);
          await putAsset(env, item.key, image.body, image.contentType, { kind: item.kind, snapshotId: snapshot.id });
        }
        item.cached = Boolean(exists);
        await applyMedia(store, snapshot, item);
        item.done = true;
      }));
      snapshot.imageStats = mediaStats(items);
      await store.writeSnapshot(snapshot);
      await checkpoint(state);
      const failure = results.find(result => result.status === "rejected");
      if (failure?.status === "rejected") throw failure.reason;
    }
    return { stage: items.some(item => !item.done) ? "media" : "archive", state };
  }
  if (job.stage === "archive") {
    let snapshot: B50Snapshot | null = null;
    if (state.snapshotId) {
      snapshot = await store.snapshot(state.snapshotId);
      if (!snapshot) throw new Error("Snapshot missing during archive");
      snapshot.mediaStatus = "complete"; delete snapshot.mediaError;
      await store.writeSnapshot(snapshot);
      await store.backup(snapshot);
    }
    await store.exportArchive();
    if (state.preview) return { stage: "done", state, result: { snapshot: state.preview, recorded: false, duplicateOf: state.duplicateOf, message: "B50 未变化，仅显示当前结果，未新增快照或上传媒体。" } };
    await store.log({ scope: job.kind === "import" ? "b50" : "media", level: "success", action: "completed", message: state.historyMessage || "媒体处理和 R2 归档已完成。", ...(snapshot ? { snapshotId: snapshot.id } : {}) });
    return { stage: "done", state, result: { ...(snapshot ? { snapshot, recorded: true } : {}), message: state.historyMessage || "B50、媒体和归档已同步完成。" } };
  }
  throw new Error(`Unknown task stage: ${job.stage}`);
}
function mediaItems(snapshot: B50Snapshot): MediaItem[] {
  const items: MediaItem[] = [{ kind: "potential", key: snapshot.potentialImageKey || `potential/${snapshot.id}.image`, done: Boolean(snapshot.potentialImageKey), cached: Boolean(snapshot.potentialImageKey) }];
  const seen = new Set<string>();
  for (const score of snapshot.best50) {
    if (!score.bg || seen.has(score.bg)) continue;
    seen.add(score.bg);
    items.push({ kind: "chart", key: score.imageKey || `charts/${score.bg}.jpg`, bg: score.bg, songId: score.songId, done: Boolean(score.imageKey), cached: Boolean(score.imageKey) });
  }
  if (snapshot.user.characterIcon && snapshot.user.characterId !== undefined) items.push({ kind: "character", key: snapshot.user.avatarImageKey || `characters/${snapshot.user.characterIcon}.png`, icon: snapshot.user.characterIcon, characterId: snapshot.user.characterId, done: Boolean(snapshot.user.avatarImageKey), cached: Boolean(snapshot.user.avatarImageKey) });
  return items;
}
function mediaStats(items: MediaItem[]) {
  const charts = items.filter(item => item.kind === "chart");
  return { requested: charts.length, uploaded: charts.filter(item => item.done && !item.cached).length, cached: charts.filter(item => item.done && item.cached).length, failed: 0, failures: [] };
}
async function applyMedia(store: Store, snapshot: B50Snapshot, item: MediaItem) {
  const url = publicAssetUrl(store.env, item.key), updatedAt = new Date().toISOString();
  if (item.kind === "potential") { snapshot.potentialImageKey = item.key; snapshot.potentialImageUrl = url; }
  if (item.kind === "chart") {
    for (const score of snapshot.best50.filter(score => score.bg === item.bg)) { score.imageKey = item.key; score.imageUrl = url; }
    await store.putCache("chart", item.bg!, { songId: item.songId, bg: item.bg, imageKey: item.key, imageUrl: url, updatedAt });
  }
  if (item.kind === "character") {
    snapshot.user.avatarImageKey = item.key; snapshot.user.avatarImageUrl = url;
    await store.putCache("character", `${item.characterId}:${item.icon}`, { characterId: item.characterId, icon: item.icon, imageKey: item.key, imageUrl: url, updatedAt });
  }
}
async function enrichCached(store: Store, snapshot: B50Snapshot) {
  const [charts, characters] = await Promise.all([store.cache<ChartImageCacheEntry>("chart"), store.cache<CharacterImageCacheEntry>("character")]);
  for (const score of snapshot.best50) {
    const entry = Object.values(charts).find(item => item.bg === score.bg && item.imageKey);
    if (score.bg && entry?.imageKey) { score.imageKey = entry.imageKey; score.imageUrl = publicAssetUrl(store.env, entry.imageKey); }
  }
  const character = Object.values(characters).find(item => item.characterId === snapshot.user.characterId && item.icon === snapshot.user.characterIcon && item.imageKey);
  if (character?.imageKey) { snapshot.user.avatarImageKey = character.imageKey; snapshot.user.avatarImageUrl = publicAssetUrl(store.env, character.imageKey); }
}
