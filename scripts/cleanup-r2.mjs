import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";

const apply = process.argv.includes("--apply");
const accountId = process.env.R2_ACCOUNT_ID?.trim();
const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
const bucket = (process.env.R2_BUCKET_NAME || process.env.R2_BUCKET)?.trim();

if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
  throw new Error(
    "Missing R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY or R2_BUCKET_NAME/R2_BUCKET.",
  );
}

const client = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT?.trim() || `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId, secretAccessKey },
});

async function main() {
  const snapshotObjects = await listObjects("snapshots/");
  const snapshots = [];
  for (const object of snapshotObjects) {
    if (!object.Key?.endsWith(".json")) continue;
    try {
      const snapshot = await readSnapshot(object.Key);
      if (snapshot) snapshots.push({ key: object.Key, snapshot });
    } catch (error) {
      console.warn(`[r2-cleanup] skipped unreadable snapshot ${object.Key}: ${errorMessage(error)}`);
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

  const potentialObjects = await listObjects("potential/");
  const duplicateIds = new Set(duplicateSnapshots.map((record) => record.snapshot.id));
  const potentialKeys = potentialObjects
    .map((object) => object.Key)
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

  await deleteObjects(keysToDelete);
  console.log(`[r2-cleanup] deleted ${keysToDelete.length} duplicate snapshot/potential objects.`);
}

async function listObjects(prefix) {
  const objects = [];
  let continuationToken;
  do {
    const output = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        MaxKeys: 1000,
        ContinuationToken: continuationToken,
      }),
    );
    objects.push(...(output.Contents || []));
    continuationToken = output.IsTruncated ? output.NextContinuationToken : undefined;
  } while (continuationToken);
  return objects;
}

async function readSnapshot(key) {
  const output = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!output.Body) return null;
  const value = JSON.parse(Buffer.from(await output.Body.transformToByteArray()).toString("utf8"));
  if (!isSnapshot(value)) return null;
  return value;
}

async function deleteObjects(keys) {
  for (let index = 0; index < keys.length; index += 1000) {
    const batch = keys.slice(index, index + 1000);
    if (batch.length === 0) continue;
    const output = await client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
      }),
    );
    if (output.Errors?.length) {
      throw new Error(`R2 rejected ${output.Errors.length} delete operations.`);
    }
  }
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

main().catch((error) => {
  console.error(`[r2-cleanup] ${errorMessage(error)}`);
  process.exitCode = 1;
});
