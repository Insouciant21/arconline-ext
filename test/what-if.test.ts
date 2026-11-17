import { describe, expect, it } from "vitest";
import chartConstants from "../src/lib/chart-constants.json";
import { chartNoteCount } from "../src/lib/chart-notes";
import { chartConstantForSong } from "../src/lib/chart-constants";
import {
  displaySongArtist,
  displaySongTitle,
  getCatalogDifficulty,
  getSongById,
  getSongCatalog,
  searchCatalogSongs,
} from "../src/lib/song-catalog";
import {
  farCountForMaxPureScore,
  foldedFarCount,
  maxPureScoreFromFar,
  parseFarInput,
  simulateMultiWhatIf,
  simulateWhatIf,
} from "../src/lib/what-if";
import type { Best50Score } from "../src/lib/types";

function makeBest50(count = 50): Best50Score[] {
  return Array.from({ length: count }, (_, index) => {
    const rating = 13.0 - index * 0.02;
    return {
      songId: `test_song_${index}`,
      difficulty: 2,
      modifier: 0,
      score: 9_900_000,
      perfectCount: 1000,
      nearCount: 5,
      missCount: 0,
      clearType: 1,
      title: { en: `Test Song ${index}` },
      artist: "Test Artist",
      timePlayed: 1_700_000_000_000,
      rating,
    };
  });
}

describe("song catalog", () => {
  it("aligns 1:1 with chart-constants.json across all 569 active songs", () => {
    const catalog = getSongCatalog();
    const ccEntries = chartConstants as Record<string, Array<{ constant: number; old: boolean } | null>>;
    expect(catalog).toHaveLength(Object.keys(ccEntries).length);
    expect(catalog).toHaveLength(569);

    for (const song of catalog) {
      const ccDiffs = ccEntries[song.id];
      expect(ccDiffs).toBeDefined();
      const catalogDiffSet = new Set(song.difficulties.map((diff) => diff.difficulty));
      for (let d = 0; d <= 4; d++) {
        expect(catalogDiffSet.has(d)).toBe(Boolean(ccDiffs[d]));
      }
    }
  });

  it("preserves INS aliases, difficulty overrides, and excludes deleted/placeholder charts", () => {
    expect(getSongById("particlearts")).toBeUndefined();

    const lastEternity = getSongById("lasteternity");
    expect(lastEternity?.difficulties.map((d) => d.difficulty)).toEqual([3]);

    for (const insSongId of ["dreadarea", "rivenpilgrim", "cataclysmcry", "deinosphainein"]) {
      const song = getSongById(insSongId);
      expect(getCatalogDifficulty(song!, 3)?.alias).toBe(1);
    }

    const pragmatism = getSongById("pragmatism")!;
    expect(displaySongTitle(pragmatism, 2)).toBe("PRAGMATISM");
    expect(displaySongTitle(pragmatism, 3)).toBe("PRAGMATISM -RESURRECTION-");

    const ignotus = getSongById("ignotus")!;
    expect(displaySongTitle(ignotus, 3)).toBe("Ignotus Afterburn");
    expect(displaySongArtist(ignotus, 3)).toBe("Arcaea Sound Team");
  });

  it("has note counts for every active catalog chart", () => {
    for (const song of getSongCatalog()) {
      for (const difficulty of song.difficulties) {
        expect(
          chartNoteCount(song.id, difficulty.difficulty),
          `${song.id}:${difficulty.difficulty}`,
        ).toEqual(expect.any(Number));
      }
    }
    expect(chartNoteCount("lasteternity", 3)).toBe(790);
    expect(chartNoteCount("lasteternity", 2)).toBeNull();
  });

  it("searches songs across titles, Japanese/Korean readings, and symbols", () => {
    expect(searchCatalogSongs("w4")[0]?.id).toBe("omegafour");
    expect(searchCatalogSongs("sacrosanct")[0]?.id).toBe("sacrosanct");
    expect(searchCatalogSongs("mask")[0]?.id).toBe("mask");
    expect(searchCatalogSongs("神奈川電脳暗渠")[0]?.id).toBe("kanagawa");
    expect(searchCatalogSongs("かながわ")[0]?.id).toBe("kanagawa");
    expect(searchCatalogSongs("II").some((s) => s.id === "ii")).toBe(true);
  });
});

describe("what-if simulator", () => {
  it("derives Max Pure scores from FAR counts", () => {
    expect(maxPureScoreFromFar(205, 0)).toBe(10_000_205);
    expect(maxPureScoreFromFar(205, 1)).toBe(9_975_813);
    expect(maxPureScoreFromFar(1_450, 1)).toBe(9_998_000);
    expect(farCountForMaxPureScore(205, 9_975_813)).toBe(1);
    expect(farCountForMaxPureScore(205, 9_975_814, "atLeast")).toBe(0);
  });

  it("parses FAR inputs cleanly and rejects out-of-range strings", () => {
    expect(parseFarInput("0", 205)).toBe(0);
    expect(parseFarInput("1", 205)).toBe(1);
    expect(parseFarInput(" 1 ", 205)).toBe(1);
    expect(parseFarInput("-1", 205)).toBeNull();
    expect(parseFarInput("1.5", 205)).toBeNull();
    expect(parseFarInput("206", 205)).toBeNull();
    expect(parseFarInput("abc", 205)).toBeNull();
    expect(parseFarInput("", 205)).toBeNull();
    expect(parseFarInput("1", null)).toBeNull();
  });

  it("folds one LOST into two FAR for the equivalent FAR display", () => {
    expect(foldedFarCount({ nearCount: 12, missCount: 4 })).toBe(20);
    expect(foldedFarCount({ nearCount: 0, missCount: 0 })).toBe(0);
    expect(foldedFarCount({ nearCount: -1, missCount: 4 })).toBeNull();
    expect(foldedFarCount({ nearCount: 1.5, missCount: 4 })).toBeNull();
  });

  it("computes B50 improvement, rank climb, and displaced #50 when entering B50", () => {
    const best50 = makeBest50(50);
    const constant = chartConstantForSong("grievouslady", 2)!;
    expect(constant).toBe(11.1);

    const result = simulateWhatIf({
      best50,
      songId: "grievouslady",
      difficulty: 2,
      score: 9_950_000,
      clearType: 1,
    });

    expect(result.play.rating).toBeCloseTo(13.05, 6);
    expect(result.impact.status).toBe("entered_b50");
    expect(result.impact.newRank).toBe(1);
    expect(result.after.displaced?.songId).toBe("test_song_49");
    expect(result.after.displaced?.previousRank).toBe(50);
    expect(result.impact.exactDelta).toBeGreaterThan(0);
    expect(result.after.displayPotential).toBeGreaterThanOrEqual(result.before.displayPotential);
  });

  it("updates an existing B50 entry when improved and leaves B50 unchanged when lower", () => {
    const best50 = makeBest50(50);
    best50[20] = {
      ...best50[20],
      songId: "grievouslady",
      difficulty: 2,
      score: 9_800_000,
      rating: 12.6,
    };

    const improved = simulateWhatIf({
      best50,
      songId: "grievouslady",
      difficulty: 2,
      score: 9_950_000,
      clearType: 1,
    });
    expect(improved.impact.status).toBe("improved");
    expect(improved.existing?.foldedFarCount).toBe(5);
    expect(improved.impact.previousRank).toBe(21);
    expect(improved.impact.newRank).toBe(1);
    expect(improved.impact.exactDelta).toBeGreaterThan(0);

    const lower = simulateWhatIf({
      best50,
      songId: "grievouslady",
      difficulty: 2,
      score: 9_500_000,
      clearType: 1,
    });
    expect(lower.impact.status).toBe("unchanged_below_pb");
    expect(lower.impact.exactDelta).toBe(0);
    expect(lower.after.exactPotential).toBe(lower.before.exactPotential);
  });

  it("applies Track Lost clear penalty and manual constant overrides", () => {
    const best50 = makeBest50(50);
    const cleared = simulateWhatIf({
      best50,
      songId: "grievouslady",
      difficulty: 2,
      score: 9_900_000,
      clearType: 1,
    });
    const lost = simulateWhatIf({
      best50,
      songId: "grievouslady",
      difficulty: 2,
      score: 9_900_000,
      clearType: 0,
    });
    expect(cleared.play.rating - lost.play.rating).toBeCloseTo(0.2, 6);

    const overridden = simulateWhatIf({
      best50,
      songId: "grievouslady",
      difficulty: 2,
      score: 9_900_000,
      clearType: 1,
      constantOverride: 11.5,
    });
    expect(overridden.play.isConstantOverridden).toBe(true);
    expect(overridden.play.rating - cleared.play.rating).toBeCloseTo(0.4, 6);
  });

  it("computes exact score milestones for entering B50 and gaining +0.001 display PTT", () => {
    const best50 = makeBest50(50);
    const result = simulateWhatIf({
      best50,
      songId: "grievouslady",
      difficulty: 2,
      score: 9_600_000,
      clearType: 1,
    });
    expect(result.impact.status).toBe("unchanged_below_floor");
    const minChange = result.impact.minScoreToChangeB50!;
    expect(minChange).not.toBeNull();
    const atMinChange = simulateWhatIf({
      best50,
      songId: "grievouslady",
      difficulty: 2,
      score: minChange,
      clearType: 1,
    });
    expect(atMinChange.impact.status).toBe("entered_b50");
    if (minChange > 0) {
      const belowMinChange = simulateWhatIf({
        best50,
        songId: "grievouslady",
        difficulty: 2,
        score: minChange - 1,
        clearType: 1,
      });
      expect(belowMinChange.impact.status).toBe("unchanged_below_floor");
    }

    const minDisplay = result.impact.minScoreToGainDisplayPtt!;
    expect(minDisplay).not.toBeNull();
    const atMinDisplay = simulateWhatIf({
      best50,
      songId: "grievouslady",
      difficulty: 2,
      score: minDisplay,
      clearType: 1,
    });
    expect(atMinDisplay.impact.displayDelta).toBeGreaterThanOrEqual(0.001);
    if (minDisplay > 0) {
      const belowMinDisplay = simulateWhatIf({
        best50,
        songId: "grievouslady",
        difficulty: 2,
        score: minDisplay - 1,
        clearType: 1,
      });
      expect(belowMinDisplay.impact.displayDelta).toBe(0);
    }
  });

  it("works when B50 is empty", () => {
    const result = simulateWhatIf({
      best50: [],
      songId: "sayonarahatsukoi",
      difficulty: 2,
      score: 10_000_000,
      clearType: 3,
    });
    expect(result.before.count).toBe(0);
    expect(result.impact.status).toBe("entered_b50");
    expect(result.impact.newRank).toBe(1);
    expect(result.after.exactPotential).toBeCloseTo(result.play.rating * 2 / 60, 6);
  });

  it("keeps the single-play multi result consistent with the legacy simulator", () => {
    const best50 = makeBest50(50);
    const legacy = simulateWhatIf({
      best50,
      songId: "grievouslady",
      difficulty: 2,
      score: 9_950_000,
      clearType: 1,
    });
    const multi = simulateMultiWhatIf({
      best50,
      plays: [{ songId: "grievouslady", difficulty: 2, score: 9_950_000, clearType: 1 }],
      activeIndex: 0,
    });

    expect(multi.plays[0].status).toBe(legacy.impact.status);
    expect(multi.plays[0].newRank).toBe(legacy.impact.newRank);
    expect(multi.after.exactPotential).toBeCloseTo(legacy.after.exactPotential, 9);
    expect(multi.impact.displayDelta).toBe(legacy.impact.displayDelta);
    expect(multi.activeMilestones?.minScoreToChangeB50).toBe(legacy.impact.minScoreToChangeB50);
    expect(multi.activeMilestones?.minScoreToGainDisplayPtt).toBe(
      legacy.impact.minScoreToGainDisplayPtt,
    );
  });

  it("combines multiple plays, tracks mixed outcomes, and displaces every dropped B50 entry", () => {
    const best50 = makeBest50(50);
    const result = simulateMultiWhatIf({
      best50,
      plays: [
        { songId: "testify", difficulty: 3, score: 9_950_000, clearType: 1 },
        { songId: "grievouslady", difficulty: 2, score: 9_950_000, clearType: 1 },
        { songId: "worldender", difficulty: 3, score: 9_400_000, clearType: 1 },
      ],
    });

    expect(result.impact.enteredCount).toBe(2);
    expect(result.impact.improvedCount).toBe(0);
    expect(result.impact.unchangedCount).toBe(1);
    expect(result.after.displaced).toHaveLength(2);
    expect(result.after.displaced.map((entry) => entry.previousRank)).toEqual([49, 50]);
    expect(result.after.exactPotential).toBeGreaterThan(result.before.exactPotential);
  });

  it("supports improving an existing entry alongside new entries and below-floor plays", () => {
    const best50 = makeBest50(50);
    best50[20] = {
      ...best50[20],
      songId: "testify",
      difficulty: 3,
      score: 9_800_000,
      rating: 12.6,
    };

    const result = simulateMultiWhatIf({
      best50,
      plays: [
        { songId: "testify", difficulty: 3, score: 9_950_000, clearType: 1 },
        { songId: "grievouslady", difficulty: 2, score: 9_950_000, clearType: 1 },
        { songId: "worldender", difficulty: 3, score: 9_400_000, clearType: 1 },
      ],
    });

    expect(result.plays.map((play) => play.status)).toEqual([
      "improved",
      "entered_b50",
      "unchanged_below_floor",
    ]);
    expect(result.impact.improvedCount).toBe(1);
    expect(result.impact.enteredCount).toBe(1);
    expect(result.impact.unchangedCount).toBe(1);
    expect(result.after.displaced).toHaveLength(1);
  });

  it("keeps different difficulties of the same song as separate simulated charts", () => {
    const best50 = makeBest50(50);
    const result = simulateMultiWhatIf({
      best50,
      plays: [
        { songId: "testify", difficulty: 2, score: 9_950_000, clearType: 1 },
        { songId: "testify", difficulty: 3, score: 9_950_000, clearType: 1 },
      ],
    });

    const simulatedKeys = result.after.best50
      .filter((entry) => entry.isSimulated)
      .map((entry) => `${entry.songId}:${entry.difficulty}`)
      .sort();
    expect(simulatedKeys).toEqual(["testify:2", "testify:3"]);
    expect(result.after.displaced).toHaveLength(2);
  });

  it("deduplicates the same song and difficulty using the highest simulated rating", () => {
    const best50 = makeBest50(50);
    const result = simulateMultiWhatIf({
      best50,
      plays: [
        { songId: "grievouslady", difficulty: 2, score: 9_950_000, clearType: 1 },
        { songId: "grievouslady", difficulty: 2, score: 9_900_000, clearType: 1 },
      ],
    });

    expect(result.after.best50.filter((entry) => entry.isSimulated)).toHaveLength(1);
    expect(result.after.displaced).toHaveLength(1);
    expect(result.plays[0].status).toBe("entered_b50");
    expect(result.plays[1].status).toBe("unchanged_below_floor");
    expect(result.after.best50.find((entry) => entry.isSimulated)?.score).toBe(9_950_000);
  });

  it("computes active milestones against the other queued plays as the baseline", () => {
    const best50 = makeBest50(50);
    const plays = [
      { songId: "testify", difficulty: 3, score: 9_950_000, clearType: 1 },
      { songId: "grievouslady", difficulty: 2, score: 9_950_000, clearType: 1 },
    ] as const;
    const firstActive = simulateMultiWhatIf({ best50, plays, activeIndex: 0 });
    const secondActive = simulateMultiWhatIf({ best50, plays, activeIndex: 1 });

    expect(firstActive.activeMilestones?.baselineDisplayPotential).toBeGreaterThan(
      firstActive.before.displayPotential,
    );
    expect(secondActive.activeMilestones?.baselineDisplayPotential).toBeGreaterThan(
      secondActive.before.displayPotential,
    );
    expect(firstActive.activeMilestones?.minScoreToChangeB50).not.toBeNull();
    expect(secondActive.activeMilestones?.minScoreToChangeB50).not.toBeNull();
  });
});
