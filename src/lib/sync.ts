import { ArcaeaClient } from "./arcaea-client";
import { sameB50, scoreMediaKey } from "./b50";
import { getConfig, getLocalDate } from "./config";
import type { Env } from "./environment";
import { AppError } from "./errors";
import type { JobRow } from "./jobs";
import { importOfficialHistory } from "./official-history";
import { calculateWeightedPotential, formatPotential } from "./potential";
import { publicAssetUrl, putAsset } from "./r2";
import { cacheScoreExportProfile, prepareScoreExportProfile } from "./score-export-profile";
import { Store, type CacheWrite } from "./store";
import type { B50Snapshot, CharacterImageCacheEntry, ChartImageCacheEntry, JobView, StoredUser } from "./types";
import { measure, type Profiler, type TimingSpan } from "./profiling";

type MediaItem = { kind: "potential" | "chart" | "character"; key: string; bg?: string; icon?: string; characterId?: number; songId?: string; done?: boolean; cached?: boolean };
export interface SyncState { snapshotId?: string; media?: MediaItem[]; preview?: B50Snapshot; duplicateOf?: string; historyMessage?: string; historyPending?: boolean; profilePending?: boolean; timings?: TimingSpan[]; }
type StepResult = { stage: string; state: SyncState; result?: NonNullable<JobView["result"]> };
export interface SyncExecution {
  getClient: () => Promise<ArcaeaClient>;
  shouldYield: () => boolean;
  profiling?: Profiler;
  // Reuse only within this queue invocation. A redelivery always reloads D1.
  snapshot?: B50Snapshot;
}

export async function runStep(env: Env, job: JobRow, checkpoint: (state: SyncState) => Promise<void>, execution?: SyncExecution): Promise<StepResult> {
  const store = new Store(env), state = JSON.parse(job.state) as SyncState;
  const profiling = execution?.profiling;
  let client: Promise<ArcaeaClient> | undefined;
  const getClient = execution?.getClient ?? (() => client ??= ArcaeaClient.login(env));
  const loadSnapshot = async (id: string) => {
    if (execution?.snapshot?.id === id) return execution.snapshot;
    const snapshot = await store.snapshot(id);
    if (execution && snapshot) execution.snapshot = snapshot;
    return snapshot;
  };
  const saveSnapshot = async (snapshot: B50Snapshot) => {
    await store.writeSnapshot(snapshot);
    if (execution) execution.snapshot = snapshot;
  };
  if (job.stage === "fetch") {
    if (job.kind === "retry") {
      const snapshot = state.snapshotId ? await loadSnapshot(state.snapshotId) : await store.latest();
      if (!snapshot) throw new AppError("没有可重试的快照。", 404, "SNAPSHOT_MISSING");
      state.snapshotId = snapshot.id;
      snapshot.mediaStatus = "processing"; delete snapshot.mediaError;
      await saveSnapshot(snapshot);
      state.media = mediaItems(snapshot);
      await checkpoint(state);
      return { stage: "media", state };
    }
    if (job.kind === "import") {
      const imported = await importOfficialHistory(store, await getClient());
      state.historyMessage = `已同步官网历史 PTT，共保存 ${imported.total} 个原始数据点。`;
      return { stage: "archive", state };
    }
    // Reuse a checkpoint if the worker stopped after the score write.
    const snapshotId = state.snapshotId || `${getLocalDate(job.created_at, getConfig(env).timezone)}-${job.id}`;
    const saved = await loadSnapshot(snapshotId);
    if (saved) {
      state.snapshotId = saved.id; state.media = mediaItems(saved); state.historyPending = true; state.profilePending = true;
      await checkpoint(state);
      return { stage: "media", state };
    }
    const [remote, previous] = await Promise.all([getClient().then(client => client.fetchB50Snapshot()), measure(profiling, "d1.latest", () => store.latest())]);
    const snapshot: B50Snapshot = {
      id: snapshotId, fetchedAt: new Date().toISOString(), trigger: job.trigger,
      potential: formatPotential(remote.user.rating), weightedPotential: formatPotential(calculateWeightedPotential(remote.best50.map(score => score.rating))),
      user: remote.user, best50: remote.best50,
      imageStats: { requested: new Set(remote.best50.map(score => score.bg).filter(Boolean)).size, uploaded: 0, failed: 0, failures: [], cached: 0 }, mediaStatus: "processing",
    };
    await Promise.all([
      measure(profiling, "d1.aliases", () => store.aliases(remote.best50)),
      measure(profiling, "d1.media.cache", () => enrichCached(store, snapshot, previous)),
    ]);
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
      await saveSnapshot(snapshot);
      state.media = mediaItems(snapshot);
      state.historyPending = true;
      state.profilePending = true;
    }
    await checkpoint(state);
    await store.log({ scope: "b50", level: state.duplicateOf ? "warning" : "success", action: state.duplicateOf ? "skipped" : "recorded", message: state.duplicateOf ? "B50 未变化，跳过成绩快照并更新导出资料。" : "B50 已保存，继续处理用户资料、历史和媒体。", snapshotId: snapshot.id });
    return { stage: state.preview ? "profile" : "media", state };
  }
  if (job.stage === "profile") {
    const snapshot = state.preview ?? (state.snapshotId ? await loadSnapshot(state.snapshotId) : null);
    if (!snapshot) throw new AppError("任务快照不存在。", 404, "SNAPSHOT_MISSING");
    // For unchanged scores these operations are independent. Settle both before
    // retrying, so no upload or history write can escape the durable invocation.
    const results = await Promise.allSettled([
      cacheScoreExportProfile(store, snapshot.user, getClient, profiling),
      state.preview ? syncHistory(store, getClient, profiling) : Promise.resolve(),
    ]);
    if (results[0].status === "rejected") throw results[0].reason;
    if (results[1].status === "rejected") throw results[1].reason;
    snapshot.user = results[0].value;
    if (state.preview) state.preview = snapshot;
    else await saveSnapshot(snapshot);
    // The caller commits this state and the next stage atomically. An additional
    // checkpoint here would write the same complete B50 twice in succession.
    if (state.preview) state.historyPending = false;
    return { stage: state.preview ? "archive" : "media", state };
  }
  if (job.stage === "history") {
    // History failure must not discard a successfully fetched B50.
    await syncHistory(store, getClient, profiling);
    state.historyPending = false;
    if (state.preview) return { stage: "archive", state };
    return { stage: "media", state };
  }
  if (job.stage === "media") {
    const snapshot = state.snapshotId ? await loadSnapshot(state.snapshotId) : null;
    if (!snapshot) throw new AppError("任务快照不存在。", 404, "SNAPSHOT_MISSING");
    const mediaExecution = { getClient, shouldYield: execution?.shouldYield ?? (() => false) };
    const profile = state.profilePending
      ? measure(profiling, "sync.profile", () => prepareScoreExportProfile(store, snapshot.user, getClient, profiling))
      : undefined;
    const historyPending = state.historyPending;
    let persisted = structuredClone(state);
    // All branches settle before a retry or continuation. Only processMedia
    // writes the snapshot, after merging the independently prepared user.
    const results = await Promise.allSettled([
      processMedia(store, snapshot, state, async progress => {
        await checkpoint(progress);
        persisted = structuredClone(progress);
      }, mediaExecution, profile),
      historyPending ? syncHistory(store, getClient, profiling) : Promise.resolve(),
      profile ?? Promise.resolve(),
    ]);
    if (historyPending && results[1].status === "fulfilled") {
      // Uploads ahead of the last durable checkpoint are recovered by R2 keys.
      const progress = results[0].status === "fulfilled" ? state : persisted;
      progress.historyPending = false;
      if (results[0].status === "rejected") await checkpoint(progress);
    }
    const failure = results.find(result => result.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
    return { stage: state.media!.some(item => !item.done) ? "media" : "archive", state };
  }
  if (job.stage === "archive") {
    let snapshot: B50Snapshot | null = null;
    const finalizers: Promise<unknown>[] = [];
    if (state.snapshotId) {
      snapshot = await loadSnapshot(state.snapshotId);
      if (!snapshot) throw new Error("Snapshot missing during archive");
      if (snapshot.mediaStatus !== "complete" || snapshot.mediaError) {
        snapshot.mediaStatus = "complete"; delete snapshot.mediaError;
        await saveSnapshot(snapshot);
      }
      finalizers.push(store.backup(snapshot));
    }
    finalizers.push(measure(profiling, "archive.export", () => store.exportArchive()));
    const results = await Promise.allSettled(finalizers);
    const failure = results.find(result => result.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
    if (state.preview) return { stage: "done", state, result: { snapshot: state.preview, recorded: false, duplicateOf: state.duplicateOf, message: "B50 未变化，已更新用户资料，未新增成绩快照。" } };
    await store.log({ scope: job.kind === "import" ? "b50" : "media", level: "success", action: "completed", message: state.historyMessage || "媒体处理和 R2 归档已完成。", ...(snapshot ? { snapshotId: snapshot.id } : {}) });
    return { stage: "done", state, result: { ...(snapshot ? { snapshot, recorded: true } : {}), message: state.historyMessage || "B50、媒体和归档已同步完成。" } };
  }
  throw new Error(`Unknown task stage: ${job.stage}`);
}
async function syncHistory(store: Store, getClient: SyncExecution["getClient"], profiling?: Profiler) {
  // History failure must not discard a successfully fetched B50.
  try {
    await importOfficialHistory(store, await getClient(), { refreshAliases: false, profiling });
  } catch (error) {
    await store.log({ scope: "b50", level: "warning", action: "history-import-failed", message: `官网历史导入失败，保留已有数据：${error instanceof Error ? error.message : "未知错误"}` });
  }
}
async function processMedia(store: Store, snapshot: B50Snapshot, state: SyncState, checkpoint: (state: SyncState) => Promise<void>, execution: SyncExecution, profile?: Promise<StoredUser>) {
  snapshot.mediaStatus = "processing"; delete snapshot.mediaError;
  const items = state.media || (state.media = mediaItems(snapshot));
  // The profile branch owns the avatar download; never request it twice. If it
  // falls back to bundled art, the media branch can still retry that one image.
  const pending = items.filter(item => !item.done && !(profile && item.kind === "character")).slice(0, 24);
  // Keep two buffered images in flight. A free slot immediately takes the
  // next image, so slow potential-image generation cannot stall another slot.
  for (let i = 0; i < pending.length || profile;) {
    const group = pending.slice(i, i + 4), writes: CacheWrite[] = [];
    i += group.length;
    let cursor = 0, failed = false;
    const results = await Promise.allSettled(Array.from({ length: Math.min(2, group.length) }, async () => {
      while (!failed && cursor < group.length) {
        const item = group[cursor++];
        try {
          const exists = await store.env.ARCHIVE.head(item.key);
          if (!exists) {
            const client = await execution.getClient();
            const image = item.kind === "potential" ? await client.getOnlineImage() : item.kind === "chart" ? await client.getChartImage(item.bg!) : await client.getCharacterIconImage(item.icon!);
            await putAsset(store.env, item.key, image.body, image.contentType, { kind: item.kind, snapshotId: snapshot.id });
          }
          item.cached = Boolean(exists);
          const write = applyMedia(store, snapshot, item);
          if (write) writes.push(write);
          item.done = true;
        } catch (error) { failed = true; throw error; }
      }
    }));
    if (profile) {
      snapshot.user = await profile;
      for (const item of items.filter(item => item.kind === "character" && !item.done)) {
        if (snapshot.user.avatarImageKey === item.key) {
          item.done = true; item.cached = true;
          const write = applyMedia(store, snapshot, item);
          if (write) writes.push(write);
        } else if (pending.length < 24) pending.push(item);
      }
      writes.push({ kind: "score-export", key: "profile", value: snapshot.user });
    }
    snapshot.imageStats = mediaStats(items);
    const failure = results.find(result => result.status === "rejected");
    snapshot.mediaStatus = items.every(item => item.done) ? "complete" : "processing";
    // Cache entries and their owning snapshot advance together in one D1 batch.
    await store.writeSnapshot(snapshot, writes);
    if (profile) { state.profilePending = false; profile = undefined; }
    // Partial and failed groups retain checkpoints. The final successful group
    // is persisted by the caller's atomic stage transition; R2 keys also allow
    // recovery if the invocation stops between the snapshot and that commit.
    if (failure || i < pending.length) await checkpoint(state);
    if (failure?.status === "rejected") throw failure.reason;
    if (execution.shouldYield()) break;
  }
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
function applyMedia(store: Store, snapshot: B50Snapshot, item: MediaItem): CacheWrite | undefined {
  const url = publicAssetUrl(store.env, item.key), updatedAt = new Date().toISOString();
  if (item.kind === "potential") { snapshot.potentialImageKey = item.key; snapshot.potentialImageUrl = url; }
  if (item.kind === "chart") {
    for (const score of snapshot.best50.filter(score => score.bg === item.bg)) { score.imageKey = item.key; score.imageUrl = url; }
    return { kind: "chart", key: item.bg!, value: { songId: item.songId, bg: item.bg, imageKey: item.key, imageUrl: url, updatedAt } };
  }
  if (item.kind === "character") {
    snapshot.user.avatarImageKey = item.key; snapshot.user.avatarImageUrl = url;
    return { kind: "character", key: `${item.characterId}:${item.icon}`, value: { characterId: item.characterId, icon: item.icon, imageKey: item.key, imageUrl: url, updatedAt } };
  }
}
async function enrichCached(store: Store, snapshot: B50Snapshot, previous: B50Snapshot | null) {
  const previousCharts = new Map(previous?.best50.filter(score => score.bg && score.imageKey).map(score => [score.bg, score.imageKey]));
  for (const score of snapshot.best50) {
    const key = score.bg ? previousCharts.get(score.bg) : undefined;
    if (key) { score.imageKey = key; score.imageUrl = publicAssetUrl(store.env, key); }
  }
  if (snapshot.user.characterIcon && snapshot.user.characterId !== undefined && previous?.user.avatarImageKey && previous.user.characterId === snapshot.user.characterId && previous.user.characterIcon === snapshot.user.characterIcon) {
    snapshot.user.avatarImageKey = previous.user.avatarImageKey;
    snapshot.user.avatarImageUrl = publicAssetUrl(store.env, previous.user.avatarImageKey);
  }
  const chartKeys = snapshot.best50.filter(score => !score.imageKey).map(score => score.bg).filter((bg): bg is string => Boolean(bg));
  const characterKey = `${snapshot.user.characterId}:${snapshot.user.characterIcon}`;
  const [charts, characters] = await Promise.all([
    store.cache<ChartImageCacheEntry>("chart", chartKeys),
    store.cache<CharacterImageCacheEntry>("character", !snapshot.user.avatarImageKey && snapshot.user.characterIcon && snapshot.user.characterId !== undefined ? [characterKey] : []),
  ]);
  for (const score of snapshot.best50) {
    const entry = score.bg ? charts[score.bg] : undefined;
    if (score.bg && entry?.imageKey) { score.imageKey = entry.imageKey; score.imageUrl = publicAssetUrl(store.env, entry.imageKey); }
  }
  const character = characters[characterKey];
  if (character?.imageKey) { snapshot.user.avatarImageKey = character.imageKey; snapshot.user.avatarImageUrl = publicAssetUrl(store.env, character.imageKey); }
}
