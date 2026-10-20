import { describe, expect, it } from "vitest";
import { shinyPureCount } from "../src/lib/utils";

describe("shiny PURE counts", () => {
  it.each([
    { score: 10_001_223, perfectCount: 1444, nearCount: 0, missCount: 0, expected: 1223 },
    { score: 10_001_444, perfectCount: 1444, nearCount: 0, missCount: 0, expected: 1444 },
    { score: 10_000_000, perfectCount: 1444, nearCount: 0, missCount: 0, expected: 0 },
    { score: 9_941_413, perfectCount: 1647, nearCount: 12, missCount: 4, expected: 1546 },
    { score: 9_969_923, perfectCount: 1274, nearCount: 2, missCount: 3, expected: 1198 },
    { score: 1_666_666, perfectCount: 0, nearCount: 1, missCount: 2, expected: 0 },
    { score: 0, perfectCount: 0, nearCount: 0, missCount: 10, expected: 0 },
  ])("recovers $expected shiny PUREs from $score", ({ expected, ...score }) => {
    expect(shinyPureCount(score)).toBe(expected);
  });

  it.each([
    { score: 0, perfectCount: 0, nearCount: 0, missCount: 0 },
    { score: 9_999_999, perfectCount: 100, nearCount: 0, missCount: 0 },
    { score: 10_000_101, perfectCount: 100, nearCount: 0, missCount: 0 },
    { score: Number.NaN, perfectCount: 100, nearCount: 0, missCount: 0 },
    { score: 10_000_000, perfectCount: -1, nearCount: 0, missCount: 0 },
    { score: 10_000_000, perfectCount: 1.5, nearCount: 0, missCount: 0 },
  ])("omits a bonus for invalid judgement data %#", score => {
    expect(shinyPureCount(score)).toBeNull();
  });
});
