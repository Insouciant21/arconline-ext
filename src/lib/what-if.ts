import { chartConstantForSong } from "./chart-constants";
import { exactWeightedPotential, formatPotential } from "./potential";
import { displaySongArtist, displaySongTitle, getCatalogDifficulty, getSongById } from "./song-catalog";
import type { Best50Score } from "./types";
import { chartConstantFromScore, playRatingFromConstant } from "./utils";

export interface WhatIfInput {
  best50: ReadonlyArray<Best50Score>;
  songId: string;
  difficulty: number;
  score: number;
  clearType?: number;
  constantOverride?: number | null;
}

export interface WhatIfEntry extends Best50Score {
  rank: number;
  previousRank: number | null;
  rankDelta: number | null;
  isSimulated: boolean;
  effectiveConstant: number | null;
}

export type WhatIfImpactStatus =
  | "entered_b50"
  | "improved"
  | "unchanged_below_pb"
  | "unchanged_below_floor"
  | "unchanged_equal";

export interface WhatIfSimulationResult {
  before: {
    exactPotential: number;
    displayPotential: number;
    top10Sum: number;
    rest40Sum: number;
    floorRating: number;
    top10FloorRating: number;
    count: number;
  };
  play: {
    songId: string;
    difficulty: number;
    difficultyAlias?: number;
    title: string;
    artist: string;
    score: number;
    clearType: number;
    grade: string;
    constant: number;
    officialConstant: number | null;
    isConstantOverridden: boolean;
    rating: number;
  };
  existing: {
    rank: number;
    score: number;
    rating: number;
    clearType: number;
    foldedFarCount: number | null;
    nearCount: number;
    missCount: number;
    deltaRating: number;
  } | null;
  after: {
    exactPotential: number;
    displayPotential: number;
    top10Sum: number;
    rest40Sum: number;
    best50: WhatIfEntry[];
    displaced: (Best50Score & { previousRank: number }) | null;
  };
  impact: {
    exactDelta: number;
    displayDelta: number;
    newRank: number | null;
    previousRank: number | null;
    rankDelta: number | null;
    status: WhatIfImpactStatus;
    ratingGapToChangeB50: number;
    minScoreToChangeB50: number | null;
    minScoreToGainDisplayPtt: number | null;
    minScoreToEnterTop10: number | null;
  };
}

const MAX_CALC_SCORE = 10_000_000;
const EPSILON = 1e-12;

export function parseFarInput(raw: string, noteCount: number | null): number | null {
  if (noteCount === null || !Number.isSafeInteger(noteCount) || noteCount <= 0) return null;
  const cleaned = raw.trim().replace(/[,_'\u2019\s]/g, "");
  if (!/^\d+$/.test(cleaned)) return null;
  const value = Number(cleaned);
  if (!Number.isSafeInteger(value) || value < 0 || value > noteCount) return null;
  return value;
}

export function maxPureScoreFromFar(noteCount: number, farCount: number): number {
  if (!Number.isSafeInteger(noteCount) || noteCount <= 0) {
    throw new RangeError("noteCount must be a positive integer");
  }
  if (!Number.isSafeInteger(farCount) || farCount < 0 || farCount > noteCount) {
    throw new RangeError("farCount must be an integer within the chart note count");
  }
  const pureCount = noteCount - farCount;
  return Math.floor((5_000_000 * (2 * pureCount + farCount)) / noteCount) + pureCount;
}

export type MaxPureScoreLookupMode = "nearest" | "atLeast" | "atMost";

export function farCountForMaxPureScore(
  noteCount: number,
  targetScore: number,
  mode: MaxPureScoreLookupMode = "nearest",
): number | null {
  if (
    !Number.isSafeInteger(noteCount) ||
    noteCount <= 0 ||
    !Number.isFinite(targetScore) ||
    targetScore < 0
  ) {
    return null;
  }

  if (mode === "atLeast") {
    if (maxPureScoreFromFar(noteCount, noteCount) >= targetScore) return noteCount;
    let result = 0;
    for (let farCount = 0; farCount <= noteCount; farCount++) {
      if (maxPureScoreFromFar(noteCount, farCount) < targetScore) break;
      result = farCount;
    }
    return result;
  }

  if (mode === "atMost") {
    for (let farCount = 0; farCount <= noteCount; farCount++) {
      if (maxPureScoreFromFar(noteCount, farCount) <= targetScore) return farCount;
    }
    return null;
  }

  let bestFarCount = 0;
  let bestScore = maxPureScoreFromFar(noteCount, 0);
  let bestDistance = Math.abs(bestScore - targetScore);
  for (let farCount = 1; farCount <= noteCount; farCount++) {
    const score = maxPureScoreFromFar(noteCount, farCount);
    const distance = Math.abs(score - targetScore);
    if (distance < bestDistance || (distance === bestDistance && score > bestScore)) {
      bestFarCount = farCount;
      bestScore = score;
      bestDistance = distance;
    }
  }
  return bestFarCount;
}

export function foldedFarCount(score: Pick<Best50Score, "nearCount" | "missCount">): number | null {
  if (![score.nearCount, score.missCount].every((value) => Number.isSafeInteger(value) && value >= 0)) {
    return null;
  }
  return score.nearCount + score.missCount * 2;
}

export function whatIfScoreGrade(score: number): string {
  if (score >= 10_000_000) return "PM";
  if (score >= 9_900_000) return "EX+";
  if (score >= 9_800_000) return "EX";
  if (score >= 9_500_000) return "AA";
  if (score >= 9_000_000) return "A";
  if (score >= 8_600_000) return "B";
  if (score >= 7_900_000) return "C";
  return "D";
}

function sortBest50(best50: ReadonlyArray<Best50Score>): Best50Score[] {
  return best50
    .map((item, index) => ({ item, index }))
    .sort((a, b) => (b.item.rating !== a.item.rating ? b.item.rating - a.item.rating : a.index - b.index))
    .slice(0, 50)
    .map(({ item }) => item);
}

function summarizeRatings(entries: ReadonlyArray<{ rating: number }>) {
  const top10Sum = entries.slice(0, 10).reduce((sum, entry) => sum + entry.rating, 0);
  const rest40Sum = entries.slice(10, 50).reduce((sum, entry) => sum + entry.rating, 0);
  return { top10Sum, rest40Sum };
}

function binarySearchMinScore(predicate: (score: number) => boolean): number | null {
  if (!predicate(MAX_CALC_SCORE)) return null;
  if (predicate(0)) return 0;
  let low = 0;
  let high = MAX_CALC_SCORE;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (predicate(mid)) {
      high = mid;
    } else {
      low = mid + 1;
    }
  }
  return low;
}

export function simulateWhatIf(input: WhatIfInput): WhatIfSimulationResult {
  const orderedBefore = sortBest50(input.best50);
  const beforeExact = exactWeightedPotential(orderedBefore);
  const beforeDisplay = formatPotential(beforeExact);
  const beforeSums = summarizeRatings(orderedBefore);
  const floorRating = orderedBefore.length >= 50 ? orderedBefore[49].rating : 0;
  const top10FloorRating = orderedBefore.length >= 10 ? orderedBefore[9].rating : 0;

  const song = getSongById(input.songId);
  const catalogDiff = song ? getCatalogDifficulty(song, input.difficulty) : undefined;
  const officialConstant = chartConstantForSong(input.songId, input.difficulty);
  const existingIndex = orderedBefore.findIndex(
    (entry) => entry.songId === input.songId && entry.difficulty === input.difficulty,
  );
  const existingRaw = existingIndex >= 0 ? orderedBefore[existingIndex] : null;
  const existingConstant = existingRaw ? chartConstantFromScore(existingRaw) : null;
  const constant =
    input.constantOverride !== undefined && input.constantOverride !== null && Number.isFinite(input.constantOverride)
      ? Math.max(0, Math.round(input.constantOverride * 10) / 10)
      : officialConstant ?? existingConstant ?? catalogDiff?.rating ?? 0;
  const isConstantOverridden =
    input.constantOverride !== undefined &&
    input.constantOverride !== null &&
    Number.isFinite(input.constantOverride) &&
    (officialConstant === null || Math.abs(constant - officialConstant) > 1e-9);

  const clearType = input.clearType ?? (input.score >= 10_000_000 ? 3 : 1);
  const title =
    (song ? displaySongTitle(song, input.difficulty) : undefined) ||
    existingRaw?.title.zh ||
    existingRaw?.title.en ||
    existingRaw?.title.ja ||
    input.songId;
  const artist = (song ? displaySongArtist(song, input.difficulty) : undefined) || existingRaw?.artist || "";
  const difficultyAlias = catalogDiff?.alias ?? existingRaw?.difficultyAlias;
  const playRating = playRatingFromConstant(constant, { score: input.score, clearType });

  const existing = existingRaw
    ? {
        rank: existingIndex + 1,
        score: existingRaw.score,
        rating: existingRaw.rating,
        clearType: existingRaw.clearType,
        foldedFarCount: foldedFarCount(existingRaw),
        nearCount: existingRaw.nearCount,
        missCount: existingRaw.missCount,
        deltaRating: playRating - existingRaw.rating,
      }
    : null;

  const previousRankMap = new Map<string, number>();
  orderedBefore.forEach((entry, idx) => {
    previousRankMap.set(`${entry.songId}:${entry.difficulty}`, idx + 1);
  });

  const syntheticEntry: Best50Score = {
    songId: input.songId,
    difficulty: input.difficulty,
    ...(difficultyAlias !== undefined ? { difficultyAlias } : {}),
    modifier: existingRaw?.modifier ?? 0,
    score: input.score,
    perfectCount: existingRaw?.perfectCount ?? 0,
    nearCount: existingRaw?.nearCount ?? 0,
    missCount: existingRaw?.missCount ?? 0,
    clearType,
    title: existingRaw?.title ?? { en: title, ...(song?.ja ? { ja: song.ja } : {}) },
    artist,
    timePlayed: existingRaw?.timePlayed ?? 0,
    ...(existingRaw?.bg ? { bg: existingRaw.bg } : {}),
    ...(existingRaw?.imageKey ? { imageKey: existingRaw.imageKey } : {}),
    ...(existingRaw?.imageUrl ? { imageUrl: existingRaw.imageUrl } : {}),
    rating: playRating,
  };

  let status: WhatIfImpactStatus;
  let rawAfter: Array<{ item: Best50Score; order: number; isSimulated: boolean }>;
  let displaced: (Best50Score & { previousRank: number }) | null = null;

  if (existingRaw) {
    if (playRating > existingRaw.rating + EPSILON) {
      status = "improved";
      rawAfter = orderedBefore.map((item, idx) =>
        idx === existingIndex
          ? { item: syntheticEntry, order: -1, isSimulated: true }
          : { item, order: idx, isSimulated: false },
      );
    } else {
      status = Math.abs(playRating - existingRaw.rating) <= EPSILON ? "unchanged_equal" : "unchanged_below_pb";
      rawAfter = orderedBefore.map((item, idx) => ({ item, order: idx, isSimulated: false }));
    }
  } else if (orderedBefore.length < 50 ? playRating > EPSILON : playRating > floorRating + EPSILON) {
    status = "entered_b50";
    rawAfter = [
      ...orderedBefore.map((item, idx) => ({ item, order: idx, isSimulated: false })),
      { item: syntheticEntry, order: -1, isSimulated: true },
    ];
  } else {
    status = "unchanged_below_floor";
    rawAfter = orderedBefore.map((item, idx) => ({ item, order: idx, isSimulated: false }));
  }

  rawAfter.sort((a, b) => (b.item.rating !== a.item.rating ? b.item.rating - a.item.rating : a.order - b.order));
  const top50After = rawAfter.slice(0, 50);
  if (status === "entered_b50" && rawAfter.length > 50) {
    displaced = { ...rawAfter[50].item, previousRank: 50 };
  }

  const afterEntries: WhatIfEntry[] = top50After.map(({ item, isSimulated }, idx) => {
    const rank = idx + 1;
    const previousRank = previousRankMap.get(`${item.songId}:${item.difficulty}`) ?? null;
    const rankDelta = previousRank !== null ? previousRank - rank : null;
    const effectiveConstant = isSimulated
      ? constant
      : chartConstantForSong(item.songId, item.difficulty) ?? chartConstantFromScore(item);
    return {
      ...item,
      rank,
      previousRank,
      rankDelta,
      isSimulated,
      effectiveConstant,
    };
  });

  const afterExact = exactWeightedPotential(afterEntries);
  const afterDisplay = formatPotential(afterExact);
  const afterSums = summarizeRatings(afterEntries);

  const simulatedIndex = afterEntries.findIndex(
    (entry) => entry.songId === input.songId && entry.difficulty === input.difficulty,
  );
  const newRank = simulatedIndex >= 0 ? simulatedIndex + 1 : null;
  const previousRank = existing?.rank ?? null;
  const rankDelta = previousRank !== null && newRank !== null ? previousRank - newRank : null;

  const thresholdRating = existingRaw ? existingRaw.rating : orderedBefore.length >= 50 ? floorRating : 0;
  const ratingGapToChangeB50 = Math.max(0, thresholdRating - playRating);

  const minScoreToChangeB50 = binarySearchMinScore((candidateScore) => {
    const r = playRatingFromConstant(constant, { score: candidateScore, clearType });
    return r > thresholdRating + EPSILON;
  });

  const beforeDisplayInt = Math.floor(beforeExact * 1000);
  const simulateExactForScore = (candidateScore: number) => {
    const candidateRating = playRatingFromConstant(constant, { score: candidateScore, clearType });
    if (existingRaw) {
      if (candidateRating <= existingRaw.rating + EPSILON) return beforeExact;
      const list = orderedBefore.map((entry, idx) => (idx === existingIndex ? { rating: candidateRating } : entry));
      return exactWeightedPotential(list);
    }
    if (orderedBefore.length >= 50 && candidateRating <= floorRating + EPSILON) return beforeExact;
    if (orderedBefore.length < 50 && candidateRating <= EPSILON) return beforeExact;
    return exactWeightedPotential([...orderedBefore, { rating: candidateRating }]);
  };

  const minScoreToGainDisplayPtt = binarySearchMinScore(
    (candidateScore) => Math.floor(simulateExactForScore(candidateScore) * 1000) >= beforeDisplayInt + 1,
  );

  const minScoreToEnterTop10 =
    previousRank !== null && previousRank <= 10
      ? null
      : orderedBefore.length < 10
        ? binarySearchMinScore((candidateScore) => playRatingFromConstant(constant, { score: candidateScore, clearType }) > EPSILON)
        : binarySearchMinScore(
            (candidateScore) => playRatingFromConstant(constant, { score: candidateScore, clearType }) > top10FloorRating + EPSILON,
          );

  return {
    before: {
      exactPotential: beforeExact,
      displayPotential: beforeDisplay,
      top10Sum: beforeSums.top10Sum,
      rest40Sum: beforeSums.rest40Sum,
      floorRating,
      top10FloorRating,
      count: orderedBefore.length,
    },
    play: {
      songId: input.songId,
      difficulty: input.difficulty,
      ...(difficultyAlias !== undefined ? { difficultyAlias } : {}),
      title,
      artist,
      score: input.score,
      clearType,
      grade: whatIfScoreGrade(input.score),
      constant,
      officialConstant,
      isConstantOverridden,
      rating: playRating,
    },
    existing,
    after: {
      exactPotential: afterExact,
      displayPotential: afterDisplay,
      top10Sum: afterSums.top10Sum,
      rest40Sum: afterSums.rest40Sum,
      best50: afterEntries,
      displaced,
    },
    impact: {
      exactDelta: afterExact - beforeExact,
      displayDelta: Math.round((afterDisplay - beforeDisplay) * 1000) / 1000,
      newRank,
      previousRank,
      rankDelta,
      status,
      ratingGapToChangeB50,
      minScoreToChangeB50,
      minScoreToGainDisplayPtt,
      minScoreToEnterTop10,
    },
  };
}
