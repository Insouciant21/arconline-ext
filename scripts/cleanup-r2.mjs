import { withArchive, listArchiveObjects, deleteArchiveObjects } from "./lib/archive.mjs";

const apply = process.argv.includes("--apply");

async function main(archive) {
  const snapshotObjects = await listObjects(archive, "snapshots/");
  const snapshots = [];
  for (const object of snapshotObjects) {
    if (!object.key?.endsWith(".json")) continue;
    try {
      const snapshot = await readSnapshot(archive, object.key);
      if (snapshot) snapshots.push({ key: object.key, snapshot });
    } catch (error) {
      console.warn(`[r2-cleanup] skipped unreadable snapshot ${object.key}: ${errorMessage(error)}`);
    }
  }

  const groups = new Map();
  for (const record of snapshots) {
    const fingerprint = b50Fingerprint(record.snapshot);
    const group = groups.get(fingerprint) || [];
    group.push(record);
    groups.set(fingerprint, group);
  }

  const duplicateGroups = [...groups.values()].filter((group) => group.length > 1);
  const duplicateSnapshots = duplicateGroups.flatMap((group) => {
    group.sort(compareAge);
    return group.slice(1);
  });
  const duplicateSnapshotKeys = duplicateSnapshots.map((record) => record.key);

  const potentialObjects = await listObjects(archive, "potential/");
  const duplicateIds = new Set(duplicateSnapshots.map((record) => record.snapshot.id));
  const potentialKeys = potentialObjects
    .map((object) => object.key)
    .filter((key) => key && duplicateIds.has(snapshotIdFromPotentialKey(key)));

  const keysToDelete = [...new Set([...duplicateSnapshotKeys, ...potentialKeys])];
  const summary = {
    mode: apply ? "apply" : "dry-run",
    snapshots: {
      objects: snapshotObjects.length,
      valid: snapshots.length,
      duplicateGroups: duplicateGroups.length,
      keptOldest: duplicateGroups.reduce((count, group) => count + 1, 0),
      delete: duplicateSnapshotKeys.length,
      groups: duplicateGroups.map((group) => ({
        keep: { key: group[0].key, fetchedAt: group[0].snapshot.fetchedAt },
        delete: group.slice(1).map((record) => ({
          key: record.key,
          fetchedAt: record.snapshot.fetchedAt,
        })),
      })),
    },
    potential: {
      objects: potentialObjects.length,
      delete: potentialKeys.length,
    },
    totalDelete: keysToDelete.length,
    sampleDeleteKeys: keysToDelete.slice(0, 20),
  };
  console.log(JSON.stringify(summary, null, 2));

  if (!apply) {
    console.log("[r2-cleanup] dry-run only; use --apply to delete the listed duplicate objects.");
    return;
  }

  await deleteArchiveObjects(archive, keysToDelete);
  console.log(`[r2-cleanup] deleted ${keysToDelete.length} duplicate snapshot/potential objects.`);
}

async function listObjects(archive, prefix) {
  const objects = [];
  for await (const object of listArchiveObjects(archive, prefix)) objects.push(object);
  return objects;
}

async function readSnapshot(archive, key) {
  const object = await archive.get(key);
  if (!object) return null;
  const value = await object.json();
  return isSnapshot(value) ? value : null;
}

function isSnapshot(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof value.id === "string" &&
      typeof value.fetchedAt === "string" &&
      Array.isArray(value.best50),
  );
}

function b50Fingerprint(snapshot) {
  return JSON.stringify(
    snapshot.best50.map((score) => ({
      songId: score.songId,
      difficulty: score.difficulty,
      modifier: score.modifier,
      rating: score.rating,
      score: score.score,
      perfectCount: score.perfectCount,
      nearCount: score.nearCount,
      missCount: score.missCount,
      clearType: score.clearType,
      title: Object.fromEntries(
        Object.entries(score.title && typeof score.title === "object" ? score.title : {}).sort(
          ([left], [right]) => left.localeCompare(right),
        ),
      ),
      artist: score.artist,
      timePlayed: score.timePlayed,
      bg: score.bg || null,
    })),
  );
}

function compareAge(left, right) {
  const leftTime = Date.parse(left.snapshot.fetchedAt);
  const rightTime = Date.parse(right.snapshot.fetchedAt);
  const normalizedLeft = Number.isFinite(leftTime) ? leftTime : Number.MAX_SAFE_INTEGER;
  const normalizedRight = Number.isFinite(rightTime) ? rightTime : Number.MAX_SAFE_INTEGER;
  return normalizedLeft - normalizedRight || left.key.localeCompare(right.key);
}

function snapshotIdFromPotentialKey(key) {
  const name = key.slice("potential/".length);
  const extensionIndex = name.lastIndexOf(".");
  return extensionIndex > 0 ? name.slice(0, extensionIndex) : name;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

withArchive(main).catch((error) => {
  console.error(`[r2-cleanup] ${errorMessage(error)}`);
  process.exitCode = 1;
});
