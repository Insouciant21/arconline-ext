import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "./config";
import { AppError } from "./errors";
import { publicAssetUrl } from "./r2";
import type {
  B50Snapshot,
  CharacterImageCache,
  CharacterImageCacheEntry,
  ChartImageCache,
  ChartImageCacheEntry,
  LogEntry,
  PotentialHistoryPoint,
} from "./types";

const paths = {
  latest: path.join(config.dataDir, "latest.json"),
  b50History: path.join(config.dataDir, "b50-history.json"),
  b50HistoryCsv: path.join(config.dataDir, "b50-history.csv"),
  pttHistory: path.join(config.dataDir, "ptt-history.json"),
  pttHistoryCsv: path.join(config.dataDir, "ptt-history.csv"),
  chartImages: path.join(config.dataDir, "chart-images.json"),
  characterImages: path.join(config.dataDir, "character-images.json"),
  logs: path.join(config.dataDir, "logs.json"),
};

const runtimeStartedAt = Date.now() - process.uptime() * 1000;
const MAX_LOG_ENTRIES = 500;

export async function ensureDataStore() {
  await mkdir(config.dataDir, { recursive: true });
  await mkdir(path.join(config.dataDir, "snapshots"), { recursive: true });
}

export async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const content = await readFile(filePath, "utf8");
    return JSON.parse(content) as T;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || error instanceof SyntaxError) return fallback;
    throw error;
  }
}

export async function atomicWrite(filePath: string, content: string) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, content, "utf8");
  await rename(temporaryPath, filePath);
}

export async function readLatest() {
  await ensureDataStore();
  return readJson<B50Snapshot | null>(paths.latest, null);
}

export async function readB50History() {
  await ensureDataStore();
  return readJson<B50Snapshot[]>(paths.b50History, []);
}

export async function readPttHistory() {
  await ensureDataStore();
  const [stored, snapshots] = await Promise.all([
    readJson<PotentialHistoryPoint[]>(paths.pttHistory, []),
    readJson<B50Snapshot[]>(paths.b50History, []),
  ]);
  return aggregateDailyPttHistory(snapshots, stored);
}

export async function readLogs(limit = 200) {
  await ensureDataStore();
  const logs = await readJson<LogEntry[]>(paths.logs, []);
  return logs
    .filter(isLogEntry)
    .sort((left, right) => right.timestamp.localeCompare(left.timestamp))
    .slice(0, limit);
}

export async function appendLog(
  input: Omit<LogEntry, "id" | "timestamp"> & { timestamp?: string },
) {
  return withFileLock("logs", async () => {
    const timestamp = input.timestamp || new Date().toISOString();
    const entry: LogEntry = {
      ...input,
      id: `${timestamp}-${randomUUID()}`,
      timestamp,
    };
    const current = (await readJson<LogEntry[]>(paths.logs, [])).filter(isLogEntry);
    const next = [entry, ...current]
      .sort((left, right) => right.timestamp.localeCompare(left.timestamp))
      .slice(0, MAX_LOG_ENTRIES);
    await atomicWrite(paths.logs, `${JSON.stringify(next, null, 2)}\n`);
    return entry;
  });
}

export async function readChartImageMap(): Promise<ChartImageCache> {
  await ensureDataStore();
  return withFileLock("chart-images", async () => {
    const cache = await readJson<ChartImageCache>(paths.chartImages, {});
    const migrated = await migrateLegacyChartImageMap(cache);
    if (migrated.changed) {
      await atomicWrite(paths.chartImages, `${JSON.stringify(migrated.cache, null, 2)}\n`);
    }
    return migrated.cache;
  });
}

export async function mergeChartImageMap(entries: ChartImageCache) {
  if (Object.keys(entries).length === 0) return;
  await withFileLock("chart-images", async () => {
    const current = await readJson<ChartImageCache>(paths.chartImages, {});
    const next = { ...current, ...entries };
    await atomicWrite(paths.chartImages, `${JSON.stringify(next, null, 2)}\n`);
  });
}

export async function readCharacterImageMap(): Promise<CharacterImageCache> {
  await ensureDataStore();
  return withFileLock("character-images", async () => {
    const cache = await readJson<CharacterImageCache>(paths.characterImages, {});
    const migrated = await migrateLegacyCharacterImageMap(cache);
    if (migrated.changed) {
      await atomicWrite(paths.characterImages, `${JSON.stringify(migrated.cache, null, 2)}\n`);
    }
    return migrated.cache;
  });
}

export async function mergeCharacterImageMap(entries: CharacterImageCache) {
  if (Object.keys(entries).length === 0) return;
  await withFileLock("character-images", async () => {
    const current = await readJson<CharacterImageCache>(paths.characterImages, {});
    const next = { ...current, ...entries };
    await atomicWrite(paths.characterImages, `${JSON.stringify(next, null, 2)}\n`);
  });
}

export async function writeSnapshot(snapshot: B50Snapshot) {
  await ensureDataStore();
  const currentLatest = await readJson<B50Snapshot | null>(paths.latest, null);
  const history = await readB50History();
  const nextHistory = [...history.filter((item) => item.id !== snapshot.id), snapshot].sort(
    (a, b) => a.fetchedAt.localeCompare(b.fetchedAt),
  );
  const pttHistory = await readPttHistory();
  const point = {
    date: getLocalDate(snapshot.fetchedAt),
    potential: snapshot.potential,
    snapshotId: snapshot.id,
    fetchedAt: snapshot.fetchedAt,
  };
  const nextPttHistory = aggregateDailyPttHistory(
    nextHistory,
    [...pttHistory.filter((item) => item.date !== point.date), point],
  );

  const currentTimestamp = currentLatest ? Date.parse(currentLatest.fetchedAt) : Number.NEGATIVE_INFINITY;
  const snapshotTimestamp = Date.parse(snapshot.fetchedAt);
  if (
    !currentLatest ||
    snapshot.id === currentLatest.id ||
    (Number.isFinite(snapshotTimestamp) && snapshotTimestamp >= currentTimestamp)
  ) {
    await atomicWrite(paths.latest, `${JSON.stringify(snapshot, null, 2)}\n`);
  }
  await atomicWrite(paths.b50History, `${JSON.stringify(nextHistory, null, 2)}\n`);
  await atomicWrite(paths.pttHistory, `${JSON.stringify(nextPttHistory, null, 2)}\n`);
  await atomicWrite(paths.b50HistoryCsv, buildB50HistoryCsv(nextHistory));
  await atomicWrite(paths.pttHistoryCsv, buildPttHistoryCsv(nextPttHistory));
  await atomicWrite(
    path.join(config.dataDir, "snapshots", `${snapshot.id}.json`),
    `${JSON.stringify(snapshot, null, 2)}\n`,
  );
}

export function getLocalDate(value: string | number | Date) {
  const date = new Date(value);
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: config.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(date);
}

function aggregateDailyPttHistory(
  snapshots: B50Snapshot[],
  existing: PotentialHistoryPoint[],
) {
  const highestByDate = new Map(existing.map((point) => [point.date, point]));
  for (const snapshot of snapshots) {
    const point: PotentialHistoryPoint = {
      date: getLocalDate(snapshot.fetchedAt),
      potential: snapshot.potential,
      snapshotId: snapshot.id,
      fetchedAt: snapshot.fetchedAt,
    };
    const previous = highestByDate.get(point.date);
    if (
      !previous ||
      point.potential > previous.potential ||
      (point.potential === previous.potential && point.fetchedAt > previous.fetchedAt)
    ) {
      highestByDate.set(point.date, point);
    }
  }
  return [...highestByDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export async function withFileLock<T>(name: string, callback: () => Promise<T>) {
  await ensureDataStore();
  const lockPath = path.join(config.dataDir, `${name}.lock`);
  let handle;
  try {
    handle = await open(lockPath, "wx");
    await writeLockOwner(handle);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      try {
        const lockInfo = await stat(lockPath);
        const owner = await readLockOwner(lockPath);
        if (shouldReclaimLock(lockInfo.mtimeMs, owner)) {
          await unlink(lockPath);
          handle = await open(lockPath, "wx");
          await writeLockOwner(handle);
        }
      } catch {
        // A concurrent owner may have removed the lock while it was inspected.
      }
    }
    if (!handle) {
      throw new AppError("已有同步事务正在执行，请稍后再试。", 409, "SYNC_IN_PROGRESS");
    }
  }

  try {
    return await callback();
  } finally {
    await handle.close().catch(() => undefined);
    await unlink(lockPath).catch(() => undefined);
  }
}

async function migrateLegacyChartImageMap(cache: ChartImageCache) {
  const history = await readB50History();
  const nextCache: ChartImageCache = { ...cache };
  let changed = false;
  for (const snapshot of history) {
    for (const score of snapshot.best50) {
      if (!score.songId || (!score.imageKey && !score.imageUrl)) continue;
      if (nextCache[score.songId]) continue;
      const entry: ChartImageCacheEntry = {
        songId: score.songId,
        ...(score.bg ? { bg: score.bg } : {}),
        ...(score.imageKey ? { imageKey: score.imageKey } : {}),
        ...(score.imageUrl
          ? { imageUrl: score.imageUrl }
          : score.imageKey
            ? { imageUrl: publicAssetUrl(score.imageKey) }
            : {}),
        updatedAt: snapshot.fetchedAt,
      };
      nextCache[score.songId] = entry;
      changed = true;
    }
  }
  return { cache: nextCache, changed };
}

async function migrateLegacyCharacterImageMap(cache: CharacterImageCache) {
  const history = await readB50History();
  const nextCache: CharacterImageCache = { ...cache };
  let changed = false;
  for (const snapshot of history) {
    const user = snapshot.user;
    const characterId = user.characterId;
    const characterIcon = user.characterIcon;
    if (
      typeof characterId !== "number" ||
      !Number.isInteger(characterId) ||
      !characterIcon ||
      (!user.avatarImageKey && !user.avatarImageUrl)
    ) {
      continue;
    }
    const cacheKey = String(characterId);
    if (nextCache[cacheKey]) continue;
    const entry: CharacterImageCacheEntry = {
      characterId,
      icon: characterIcon,
      ...(user.avatarImageKey ? { imageKey: user.avatarImageKey } : {}),
      ...(user.avatarImageUrl
        ? { imageUrl: user.avatarImageUrl }
        : user.avatarImageKey
          ? { imageUrl: publicAssetUrl(user.avatarImageKey) }
          : {}),
      updatedAt: snapshot.fetchedAt,
    };
    nextCache[cacheKey] = entry;
    changed = true;
  }
  return { cache: nextCache, changed };
}

interface LockOwner {
  pid: number;
  startedAt: number;
}

async function writeLockOwner(handle: Awaited<ReturnType<typeof open>>) {
  await handle.writeFile(JSON.stringify({ pid: process.pid, startedAt: runtimeStartedAt } satisfies LockOwner));
}

async function readLockOwner(lockPath: string): Promise<LockOwner | null> {
  try {
    const value = JSON.parse(await readFile(lockPath, "utf8")) as Partial<LockOwner>;
    if (typeof value.pid !== "number" || typeof value.startedAt !== "number") return null;
    return value as LockOwner;
  } catch {
    return null;
  }
}

function shouldReclaimLock(mtimeMs: number, owner: LockOwner | null) {
  if (owner && owner.pid === process.pid && owner.startedAt === runtimeStartedAt) return false;
  if (owner && owner.pid === process.pid && owner.startedAt < runtimeStartedAt) return true;
  if (owner && !isProcessAlive(owner.pid)) return true;
  if (owner) return false;
  if (!owner && mtimeMs < runtimeStartedAt) return true;
  return Date.now() - mtimeMs > 2 * 60 * 60 * 1000;
}

function isProcessAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

function isLogEntry(value: unknown): value is LogEntry {
  if (!value || typeof value !== "object") return false;
  const log = value as Partial<LogEntry>;
  return (
    typeof log.id === "string" &&
    typeof log.timestamp === "string" &&
    (log.scope === "b50" || log.scope === "media") &&
    (log.level === "info" ||
      log.level === "success" ||
      log.level === "warning" ||
      log.level === "error") &&
    typeof log.action === "string" &&
    typeof log.message === "string"
  );
}

function csvEscape(value: string | number | boolean) {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function buildB50HistoryCsv(history: B50Snapshot[]) {
  const rows = [
    "snapshot_id,fetched_at,trigger,potential,weighted_potential,rank,song_id,difficulty,rating,score,clear_type",
  ];
  for (const snapshot of history) {
    for (const [index, score] of snapshot.best50.entries()) {
      rows.push(
        [
          snapshot.id,
          snapshot.fetchedAt,
          snapshot.trigger,
          snapshot.potential,
          snapshot.weightedPotential,
          index + 1,
          score.songId,
          score.difficulty,
          score.rating,
          score.score,
          score.clearType,
        ]
          .map(csvEscape)
          .join(","),
      );
    }
  }
  return `${rows.join("\n")}\n`;
}

function buildPttHistoryCsv(history: PotentialHistoryPoint[]) {
  return (
    ["date,potential,snapshot_id,fetched_at", ...history.map((point) =>
      [point.date, point.potential, point.snapshotId, point.fetchedAt].map(csvEscape).join(","),
    )].join("\n") + "\n"
  );
}

export const storePaths = paths;
