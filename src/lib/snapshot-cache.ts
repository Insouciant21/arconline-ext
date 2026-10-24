import type { B50Snapshot } from "./types";

// Full snapshots are immutable (write-once per id), so an in-session cache is
// safe forever: the history detail view, the A/B comparison and re-selection
// all reuse what was already fetched. Failures are not cached — re-selecting
// a snapshot retries it.
const snapshotCache = new Map<string, B50Snapshot>();
const inflight = new Map<string, Promise<B50Snapshot>>();

export function cachedSnapshot(id: string) {
  return snapshotCache.get(id);
}

// Register an already-loaded snapshot, e.g. the newest one embedded by SSR.
export function cacheSnapshot(snapshot: B50Snapshot) {
  snapshotCache.set(snapshot.id, snapshot);
}

export function loadSnapshot(id: string): Promise<B50Snapshot> {
  const cached = snapshotCache.get(id);
  if (cached) return Promise.resolve(cached);
  let pending = inflight.get(id);
  if (!pending) {
    pending = fetch(`/api/snapshots/${encodeURIComponent(id)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const snapshot = await response.json() as B50Snapshot;
        snapshotCache.set(id, snapshot);
        return snapshot;
      })
      .finally(() => { inflight.delete(id); });
    inflight.set(id, pending);
  }
  return pending;
}
