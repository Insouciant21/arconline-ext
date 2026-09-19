import type { B50Snapshot, Best50Score } from "./types";

export const comparedFields = ["score", "rating", "perfectCount", "nearCount", "missCount", "clearType", "modifier", "timePlayed"] as const;
export type ComparedField = (typeof comparedFields)[number];

export function compareSnapshots(before: B50Snapshot, after: B50Snapshot) {
  const index = (scores: Best50Score[]) => new Map(scores.map((score, i) => [
    `${score.songId}:${score.difficulty}`, { score, rank: i + 1 },
  ]));
  const left = index(before.best50);
  const right = index(after.best50);
  return [...new Set([...right.keys(), ...left.keys()])].map((key) => {
    const old = left.get(key);
    const next = right.get(key);
    const fields = old && next ? comparedFields.filter((field) => old.score[field] !== next.score[field]) : [];
    const kind: "added" | "removed" | "changed" | "unchanged" = !old ? "added" : !next ? "removed" : fields.length || old.rank !== next.rank ? "changed" : "unchanged";
    return { key, before: old, after: next, fields, kind };
  });
}
