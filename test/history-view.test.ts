import { describe, expect, it } from "vitest";
import {
  beijingDateParts,
  buildHistoryUrlSearch,
  computeSnapshotStats,
  deltaAgainst,
  filterAndSortHistoryScores,
  filterTimelineSnapshots,
  parseHistoryUrlState,
  summarizeSnapshotDiff,
} from "../src/lib/history-view";
import type { B50Snapshot, Best50Score, SnapshotSummary } from "../src/lib/types";

function makeScore(overrides: Partial<Best50Score> & { songId: string; rating: number }): Best50Score {
  return {
    difficulty: 2,
    modifier: 0,
    score: 9_920_000,
    perfectCount: 1000,
    nearCount: 5,
    missCount: 1,
    clearType: 1,
    title: { en: overrides.songId },
    artist: "Test Artist",
    timePlayed: 1_700_000_000_000,
    ...overrides,
  };
}

function makeSnapshot(id: string, fetchedAt: string, best50: Best50Score[]): B50Snapshot {
  const potential = best50.length
    ? Number(
        (
          (best50.slice(0, 10).reduce((s, x) => s + x.rating, 0) * 2 +
            best50.slice(10).reduce((s, x) => s + x.rating, 0)) /
          60
        ).toFixed(3),
      )
    : 0;
  return {
    id,
    fetchedAt,
    trigger: "manual",
    potential,
    weightedPotential: potential,
    user: { rating: potential },
    best50,
    imageStats: { requested: 0, uploaded: 0, failed: 0, failures: [] },
  };
}

const summaries: SnapshotSummary[] = [
  { id: "s3", fetchedAt: "2026-11-22T12:00:00.000Z", potential: 12.95, weightedPotential: 12.95, trigger: "manual", entries: 50 },
  { id: "s2", fetchedAt: "2026-11-20T12:00:00.000Z", potential: 12.95, weightedPotential: 12.95, trigger: "daily", entries: 50 },
  { id: "s1", fetchedAt: "2026-10-15T12:00:00.000Z", potential: 12.80, weightedPotential: 12.80, trigger: "manual", entries: 50 },
];

describe("history view helpers", () => {
  it("computes chronological deltas and Asia/Shanghai parts", () => {
    expect(deltaAgainst(summaries, 0)).toBe(0);
    expect(deltaAgainst(summaries, 1)).toBe(0.15);
    expect(deltaAgainst(summaries, 2)).toBeUndefined();
    expect(deltaAgainst(summaries, -1)).toBeUndefined();

    const parts = beijingDateParts("2026-11-22T16:30:00.000Z");
    expect(parts.monthKey).toBe("2026-11");
    expect(parts.day).toBe("23");
    expect(parts.time).toBe("00:30");
  });

  it("filters timeline snapshots and computes normalized bar ratios", () => {
    const all = filterTimelineSnapshots(summaries, { changedOnly: false, month: "all", selectedId: "s3" });
    expect(all.hasUnchanged).toBe(true);
    expect(all.monthKeys).toEqual(["2026-11", "2026-10"]);
    expect(all.items).toHaveLength(3);
    expect(all.items[0].barRatio).toBeCloseTo(1, 6);
    expect(all.items[2].barRatio).toBeCloseTo(0.18, 6);

    // changedOnly keeps latest (index 0), changed items (s2), and selectedId
    const changed = filterTimelineSnapshots(summaries, { changedOnly: true, month: "all", selectedId: "s1" });
    expect(changed.items.map((item) => item.snapshot.id)).toEqual(["s3", "s2", "s1"]);

    const changedWithoutS1Selected = filterTimelineSnapshots(summaries, {
      changedOnly: true,
      month: "all",
      selectedId: "s2",
    });
    expect(changedWithoutS1Selected.items.map((item) => item.snapshot.id)).toEqual(["s3", "s2"]);

    const octOnly = filterTimelineSnapshots(summaries, { changedOnly: false, month: "2026-10", selectedId: "s3" });
    expect(octOnly.items.map((item) => item.snapshot.id)).toEqual(["s1"]);
  });

  it("computes snapshot stats and diff summary accurately", () => {
    const prevScores = Array.from({ length: 12 }, (_, idx) =>
      makeScore({ songId: `song-${idx}`, rating: 13.0 - idx * 0.1, score: 9_900_000 }),
    );
    const currScores = [
      makeScore({ songId: "song-2", rating: 13.1, score: 9_960_000, title: { en: "Song Two", zh: "第二首" } }),
      ...prevScores.slice(0, 2),
      ...prevScores.slice(3, 11),
      makeScore({ songId: "new-song", rating: 11.85, difficulty: 3, difficultyAlias: 1 }),
    ];

    const prevSnap = makeSnapshot("s1", "2026-10-15T12:00:00.000Z", prevScores);
    const currSnap = makeSnapshot("s2", "2026-11-20T12:00:00.000Z", currScores);

    const stats = computeSnapshotStats(currSnap);
    expect(stats.top10Avg).toBeGreaterThan(stats.b50Avg);
    expect(stats.top10Floor).toBeCloseTo(currScores[9].rating, 6);
    expect(stats.b50Floor).toBeCloseTo(currScores[11].rating, 6);

    const diff = summarizeSnapshotDiff(prevSnap, currSnap);
    expect(diff.counts.added).toBe(1);
    expect(diff.counts.removed).toBe(1);
    expect(diff.counts.changed).toBeGreaterThanOrEqual(1);

    const song2 = diff.byKey.get("song-2:2")!;
    expect(song2.kind).toBe("changed");
    expect(song2.scoreDelta).toBe(60_000);
    expect(song2.ratingDelta).toBeCloseTo(0.3, 3);
    expect(song2.rankDelta).toBe(2); // #3 -> #1 = +2

    const byChanged = filterAndSortHistoryScores(currScores, {
      group: "changed",
      query: "",
      sort: "rank",
      diffByKey: diff.byKey,
    });
    expect(byChanged.some((entry) => entry.key === "song-2:2")).toBe(true);
    expect(byChanged.some((entry) => entry.key === "new-song:3")).toBe(true);

    const insQuery = filterAndSortHistoryScores(currScores, {
      group: "all",
      query: "ins new-song",
      sort: "rank",
      diffByKey: diff.byKey,
    });
    expect(insQuery.map((entry) => entry.key)).toEqual(["new-song:3"]);

    const sortedByScore = filterAndSortHistoryScores(currScores, {
      group: "top10",
      query: "",
      sort: "score",
    });
    expect(sortedByScore).toHaveLength(10);
    expect(sortedByScore[0].rank).toBe(1);
  });

  it("parses and serializes URL state cleanly", () => {
    expect(parseHistoryUrlState("?snapshot=s2", summaries)).toEqual({
      view: "detail",
      snapshotId: "s2",
      beforeId: undefined,
      afterId: undefined,
    });

    expect(parseHistoryUrlState("?snapshot=missing", summaries).snapshotId).toBe("s3");
    expect(parseHistoryUrlState("?view=compare&before=s1&after=s3", summaries)).toEqual({
      view: "compare",
      snapshotId: "s3",
      beforeId: "s1",
      afterId: "s3",
    });

    expect(buildHistoryUrlSearch({ view: "detail", snapshotId: "s3", defaultSnapshotId: "s3" })).toBe("");
    expect(buildHistoryUrlSearch({ view: "detail", snapshotId: "s2", defaultSnapshotId: "s3" })).toBe(
      "?snapshot=s2",
    );
    expect(buildHistoryUrlSearch({ view: "compare", beforeId: "s1", afterId: "s3" })).toBe(
      "?view=compare&before=s1&after=s3",
    );
  });
});
