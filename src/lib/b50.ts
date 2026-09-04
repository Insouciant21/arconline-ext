import type { B50Snapshot, Best50Score } from "./types";

type B50Source = Pick<B50Snapshot, "best50"> | { best50: Best50Score[] };

/**
 * Build a media-independent fingerprint for a B50 response.
 *
 * Image URLs/keys are deliberately excluded because media processing can
 * finish after the score data is persisted and must not create a new B50
 * record on its own.
 */
export function b50Fingerprint(source: B50Source) {
  return JSON.stringify(
    source.best50.map((score) => ({
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
        Object.entries(score.title).sort(([left], [right]) => left.localeCompare(right)),
      ),
      artist: score.artist,
      timePlayed: score.timePlayed,
      bg: score.bg || null,
    })),
  );
}

export function sameB50(left: B50Source, right: B50Source) {
  return b50Fingerprint(left) === b50Fingerprint(right);
}

export function scoreMediaKey(score: Pick<Best50Score, "songId" | "difficulty" | "bg">) {
  return `${score.songId}:${score.difficulty}:${score.bg || ""}`;
}
