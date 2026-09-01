import { isR2Configured } from "./config";
import { readB50History } from "./file-store";
import { readSnapshotBackups } from "./r2";
import type { B50Snapshot, HistoryPayload } from "./types";

export async function getHistoryPayload(): Promise<HistoryPayload> {
  const [localSnapshots, remoteResult] = await Promise.all([
    readB50History(),
    readSnapshotBackups(),
  ]);
  const snapshots = mergeSnapshots(localSnapshots, remoteResult.snapshots);

  return {
    snapshots,
    sources: {
      localCount: localSnapshots.length,
      r2Count: remoteResult.snapshots.length,
      r2Available: remoteResult.available && isR2Configured(),
    },
  };
}

function mergeSnapshots(localSnapshots: B50Snapshot[], remoteSnapshots: B50Snapshot[]) {
  const snapshotsById = new Map<string, B50Snapshot>();
  for (const snapshot of remoteSnapshots) snapshotsById.set(snapshot.id, snapshot);

  for (const snapshot of localSnapshots) {
    const remoteSnapshot = snapshotsById.get(snapshot.id);
    snapshotsById.set(snapshot.id, remoteSnapshot ? preferCompleteSnapshot(snapshot, remoteSnapshot) : snapshot);
  }

  return [...snapshotsById.values()].sort((a, b) => b.fetchedAt.localeCompare(a.fetchedAt));
}

function preferCompleteSnapshot(localSnapshot: B50Snapshot, remoteSnapshot: B50Snapshot) {
  if (localSnapshot.mediaStatus === "complete" && remoteSnapshot.mediaStatus !== "complete") {
    return localSnapshot;
  }
  if (remoteSnapshot.mediaStatus === "complete" && localSnapshot.mediaStatus !== "complete") {
    return remoteSnapshot;
  }

  const localRichness = snapshotRichness(localSnapshot);
  const remoteRichness = snapshotRichness(remoteSnapshot);
  return remoteRichness > localRichness ? remoteSnapshot : localSnapshot;
}

function snapshotRichness(snapshot: B50Snapshot) {
  return (
    (snapshot.potentialImageKey ? 1 : 0) +
    (snapshot.user.avatarImageKey ? 1 : 0) +
    snapshot.best50.reduce((total, score) => total + (score.imageKey ? 1 : 0), 0)
  );
}
