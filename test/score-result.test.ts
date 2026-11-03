import { describe, expect, it } from "vitest";
import { chartConstantForSong, resultGrade, scoreResultData } from "../src/lib/score-result";
import { chartConstantFromScore, playRatingFromConstant } from "../src/lib/utils";
import type { SongScore } from "../src/lib/types";

const score: SongScore = {
  songId: "aegleseeker", difficulty: 2, modifier: 0, score: 9_960_014,
  perfectCount: 1559, shinyPerfectCount: 1469, nearCount: 5, missCount: 4,
  clearType: 1, bestClearType: 5, yearlyPlayCount: 8,
  title: { en: "Aegleseeker" }, artist: "Silentroom vs Frums", timePlayed: 1777211741898,
};

describe("score result export data", () => {
  it("looks up the supplied constants by API difficulty index, including ETR and INS", () => {
    expect([0, 1, 2, 3, 4].map(difficulty => chartConstantForSong("sayonarahatsukoi", difficulty)))
      .toEqual([1.5, 4.5, 7, null, 8.5]);
    expect(chartConstantForSong("dreadarea", 3)).toBe(11.4);
    expect(chartConstantForSong("extradimensional", 4)).toBe(11.3);
    expect(chartConstantForSong("trickmaster", 4)).toBe(10.5);
    expect(chartConstantForSong("undefined", 2)).toBe(9.4);
  });

  it("does not substitute another difficulty or invent missing constants", () => {
    for (const [songId, difficulty] of [["aegleseeker", 4], ["unknown-song", 2], ["__proto__", 2], ["constructor", 0], ["aegleseeker", -1], ["aegleseeker", 2.5]] as const) {
      expect(chartConstantForSong(songId, difficulty)).toBeNull();
    }
    expect(scoreResultData({ ...score, songId: "not-in-table" })).toMatchObject({ constant: null, rating: null });
  });

  it("calculates the single-play PTT for the reference result", () => {
    const result = scoreResultData(score);
    expect(result.constant).toBe(11.2);
    expect(result.level).toBe("11");
    expect(result.rating).toBeCloseTo(13.20007, 6);
    expect(result.scoreText).toBe("09’960’014");
    expect(result.dateText).toBe("2026/04/26 21:55");
    expect(result.filename).toBe("aegleseeker-FTR-20260426-2155.png");
  });

  it("uses the game's displayed chart level independently of the chart constant", () => {
    expect(scoreResultData({ ...score, songId: "sulfur" })).toMatchObject({ constant: 9.7, level: "9+" });
    expect(scoreResultData({ ...score, songId: "sayonarahatsukoi", difficulty: 4 }).level).toBe("8");
    expect(scoreResultData({ ...score, songId: "unknown-song" }).level).toBeNull();
  });

  it("keeps PURE MEMORY separate from the score grade", () => {
    const result = scoreResultData({ ...score, score: 10_001_469, clearType: 3 });
    expect(result).toMatchObject({ grade: "explus", clear: "pure" });
    expect(result.rating).toBeCloseTo(13.4, 8);
  });

  it("safely names downloads with an unavailable date and a nonstandard song ID", () => {
    expect(scoreResultData({ ...score, songId: "../bad/song\nname", timePlayed: 0 }).filename).toBe("-bad-song-name-FTR-undated.png");
    expect(scoreResultData({ ...score, difficulty: 3, difficultyAlias: 1 }).filename).toContain("-INS-");
  });
});

describe("single-play PTT", () => {
  it.each([
    [10_001_500, 1, 12.2], [10_000_000, 1, 12.2], [9_900_000, 1, 11.7],
    [9_800_000, 1, 11.2], [9_500_000, 1, 10.2], [9_200_000, 1, 9.2],
    [9_900_000, 0, 11.5], [0, 0, 0], [0, 1, 0],
  ])("rates score %i and clear type %i as %f for constant 10.0", (value, clearType, expected) => {
    expect(playRatingFromConstant(10, { score: value, clearType })).toBeCloseTo(expected, 8);
  });

  it("matches the existing inverse formula for lost, normal, full, pure, easy and hard results", () => {
    for (const clearType of [0, 1, 2, 3, 4, 5]) {
      const result = { score: 9_941_413, clearType };
      expect(chartConstantFromScore({ ...result, rating: playRatingFromConstant(11.4, result) })).toBe(11.4);
    }
  });
});

describe("result grades", () => {
  it.each([
    [10_002_000, "explus"], [9_900_000, "explus"], [9_899_999, "ex"],
    [9_800_000, "ex"], [9_799_999, "aa"], [9_500_000, "aa"],
    [9_499_999, "a"], [9_000_000, "a"], [8_999_999, "b"],
    [8_600_000, "b"], [8_599_999, "c"], [7_900_000, "c"], [7_899_999, "d"],
  ])("selects the native grade sprite for %i", (value, expected) => expect(resultGrade(value)).toBe(expected));
});
