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
export const MAX_WHAT_IF_QUEUE = 10;

export interface WhatIfPlaySpec {
  songId: string;
  difficulty: number;
  score: number;
  clearType?: number;
  constantOverride?: number | null;
}

export interface WhatIfMultiInput {
  best50: ReadonlyArray<Best50Score>;
  plays: ReadonlyArray<WhatIfPlaySpec>;
  activeIndex?: number;
}

export interface WhatIfMultiEntry extends WhatIfEntry {
  simulatedIndex: number | null;
}

export interface WhatIfMultiPlayResult {
  index: number;
  key: string;
  play: WhatIfSimulationResult["play"];
  existing: WhatIfSimulationResult["existing"];
  status: WhatIfImpactStatus;
  newRank: number | null;
  previousRank: number | null;
  rankDelta: number | null;
  ratingGapToChangeB50: number;
}

export interface WhatIfMultiMilestones {
  baselineDisplayPotential: number;
  minScoreToChangeB50: number | null;
  minScoreToGainDisplayPtt: number | null;
  minScoreToEnterTop10: number | null;
  alreadyInTop10: boolean;
  existingInBaseline: boolean;
  constant: number;
  clearType: number;
}

export interface WhatIfMultiSimulationResult {
  before: WhatIfSimulationResult["before"];
  plays: WhatIfMultiPlayResult[];
  after: {
    exactPotential: number;
    displayPotential: number;
    top10Sum: number;
    rest40Sum: number;
    best50: WhatIfMultiEntry[];
    displaced: Array<Best50Score & { previousRank: number }>;
  };
  impact: {
    exactDelta: number;
    displayDelta: number;
    improvedCount: number;
    enteredCount: number;
    unchangedCount: number;
    displacedCount: number;
  };
  activeMilestones: WhatIfMultiMilestones | null;
}

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

interface ResolvedPlaySpec {
  index: number;
  key: string;
  play: WhatIfSimulationResult["play"];
  existing: WhatIfSimulationResult["existing"];
  existingIndex: number;
  existingRaw: Best50Score | null;
  syntheticEntry: Best50Score;
}

function resolvePlaySpec(
  orderedBefore: ReadonlyArray<Best50Score>,
  input: WhatIfPlaySpec,
  index: number,
): ResolvedPlaySpec {
  const key = `${input.songId}:${input.difficulty}`;
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

  return {
    index,
    key,
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
    existingIndex,
    existingRaw,
    syntheticEntry,
  };
}

function mergeResolvedPlays(
  orderedBefore: ReadonlyArray<Best50Score>,
  resolvedPlays: ReadonlyArray<ResolvedPlaySpec>,
) {
  const winningByKey = new Map<string, ResolvedPlaySpec>();
  for (const resolved of resolvedPlays) {
    const prev = winningByKey.get(resolved.key);
    if (!prev || resolved.play.rating > prev.play.rating + EPSILON) {
      winningByKey.set(resolved.key, resolved);
    }
  }

  const replacedExistingIndices = new Set<number>();
  const pool: Array<{
    item: Best50Score;
    order: number;
    isSimulated: boolean;
    simulatedIndex: number | null;
    key: string;
  }> = [];

  for (const resolved of winningByKey.values()) {
    if (resolved.existingRaw && resolved.existingIndex >= 0) {
      if (resolved.play.rating > resolved.existingRaw.rating + EPSILON) {
        replacedExistingIndices.add(resolved.existingIndex);
        pool.push({
          item: resolved.syntheticEntry,
          order: -100 + resolved.index,
          isSimulated: true,
          simulatedIndex: resolved.index,
          key: resolved.key,
        });
      }
    } else if (resolved.play.rating > EPSILON) {
      pool.push({
        item: resolved.syntheticEntry,
        order: 100 + resolved.index,
        isSimulated: true,
        simulatedIndex: resolved.index,
        key: resolved.key,
      });
    }
  }

  orderedBefore.forEach((item, idx) => {
    if (!replacedExistingIndices.has(idx)) {
      pool.push({
        item,
        order: idx,
        isSimulated: false,
        simulatedIndex: null,
        key: `${item.songId}:${item.difficulty}`,
      });
    }
  });

  pool.sort((a, b) => (b.item.rating !== a.item.rating ? b.item.rating - a.item.rating : a.order - b.order));
  const top50 = pool.slice(0, 50);
  const displaced: Array<Best50Score & { previousRank: number }> = [];
  for (const dropped of pool.slice(50)) {
    if (!dropped.isSimulated) {
      const previousRank = orderedBefore.findIndex(
        (item) => `${item.songId}:${item.difficulty}` === dropped.key,
      );
      if (previousRank >= 0) {
        displaced.push({ ...dropped.item, previousRank: previousRank + 1 });
      }
    }
  }
  displaced.sort((a, b) => a.previousRank - b.previousRank);

  return { winningByKey, top50, displaced };
}

function computeMilestonesAgainstBaseline(
  baseline: ReadonlyArray<Best50Score>,
  songId: string,
  difficulty: number,
  constant: number,
  clearType: number,
): WhatIfMultiMilestones {
  const orderedBaseline = sortBest50(baseline);
  const baselineExact = exactWeightedPotential(orderedBaseline);
  const baselineDisplay = formatPotential(baselineExact);
  const baselineFloorRating = orderedBaseline.length >= 50 ? orderedBaseline[49].rating : 0;
  const baselineTop10FloorRating = orderedBaseline.length >= 10 ? orderedBaseline[9].rating : 0;
  const existingIndex = orderedBaseline.findIndex(
    (entry) => entry.songId === songId && entry.difficulty === difficulty,
  );
  const existingEntry = existingIndex >= 0 ? orderedBaseline[existingIndex] : null;
  const thresholdRating = existingEntry
    ? existingEntry.rating
    : orderedBaseline.length >= 50
      ? baselineFloorRating
      : 0;

  const minScoreToChangeB50 = binarySearchMinScore((candidateScore) => {
    const rating = playRatingFromConstant(constant, { score: candidateScore, clearType });
    return rating > thresholdRating + EPSILON;
  });

  const baselineDisplayInt = Math.floor(baselineExact * 1000);
  const simulateExactForScore = (candidateScore: number) => {
    const candidateRating = playRatingFromConstant(constant, { score: candidateScore, clearType });
    if (existingEntry) {
      if (candidateRating <= existingEntry.rating + EPSILON) return baselineExact;
      const list = orderedBaseline.map((entry, idx) =>
        idx === existingIndex ? { rating: candidateRating } : entry,
      );
      return exactWeightedPotential(list);
    }
    if (orderedBaseline.length >= 50 && candidateRating <= baselineFloorRating + EPSILON) return baselineExact;
    if (orderedBaseline.length < 50 && candidateRating <= EPSILON) return baselineExact;
    return exactWeightedPotential([...orderedBaseline, { rating: candidateRating }]);
  };

  const minScoreToGainDisplayPtt = binarySearchMinScore(
    (candidateScore) => Math.floor(simulateExactForScore(candidateScore) * 1000) >= baselineDisplayInt + 1,
  );

  const alreadyInTop10 = existingIndex >= 0 && existingIndex < 10;
  const minScoreToEnterTop10 = alreadyInTop10
    ? null
    : orderedBaseline.length < 10
      ? binarySearchMinScore(
          (candidateScore) => playRatingFromConstant(constant, { score: candidateScore, clearType }) > EPSILON,
        )
      : binarySearchMinScore(
          (candidateScore) =>
            playRatingFromConstant(constant, { score: candidateScore, clearType }) >
            baselineTop10FloorRating + EPSILON,
        );

  return {
    baselineDisplayPotential: baselineDisplay,
    minScoreToChangeB50,
    minScoreToGainDisplayPtt,
    minScoreToEnterTop10,
    alreadyInTop10,
    existingInBaseline: Boolean(existingEntry),
    constant,
    clearType,
  };
}

export function simulateMultiWhatIf(input: WhatIfMultiInput): WhatIfMultiSimulationResult {
  const orderedBefore = sortBest50(input.best50);
  const beforeExact = exactWeightedPotential(orderedBefore);
  const beforeDisplay = formatPotential(beforeExact);
  const beforeSums = summarizeRatings(orderedBefore);
  const floorRating = orderedBefore.length >= 50 ? orderedBefore[49].rating : 0;
  const top10FloorRating = orderedBefore.length >= 10 ? orderedBefore[9].rating : 0;

  const previousRankMap = new Map<string, number>();
  orderedBefore.forEach((entry, idx) => {
    previousRankMap.set(`${entry.songId}:${entry.difficulty}`, idx + 1);
  });

  const resolvedPlays = input.plays.map((play, idx) => resolvePlaySpec(orderedBefore, play, idx));
  const { winningByKey, top50, displaced } = mergeResolvedPlays(orderedBefore, resolvedPlays);

  const afterEntries: WhatIfMultiEntry[] = top50.map(({ item, isSimulated, simulatedIndex }, idx) => {
    const rank = idx + 1;
    const key = `${item.songId}:${item.difficulty}`;
    const previousRank = previousRankMap.get(key) ?? null;
    const rankDelta = previousRank !== null ? previousRank - rank : null;
    const matchedWinner = simulatedIndex !== null ? winningByKey.get(key) : undefined;
    const effectiveConstant = isSimulated && matchedWinner
      ? matchedWinner.play.constant
      : chartConstantForSong(item.songId, item.difficulty) ?? chartConstantFromScore(item);
    return {
      ...item,
      rank,
      previousRank,
      rankDelta,
      isSimulated,
      simulatedIndex,
      effectiveConstant,
    };
  });

  const afterExact = exactWeightedPotential(afterEntries);
  const afterDisplay = formatPotential(afterExact);
  const afterSums = summarizeRatings(afterEntries);

  const afterRankByKey = new Map<string, number>();
  afterEntries.forEach((entry) => {
    afterRankByKey.set(`${entry.songId}:${entry.difficulty}`, entry.rank);
  });

  let improvedCount = 0;
  let enteredCount = 0;
  let unchangedCount = 0;

  const playResults: WhatIfMultiPlayResult[] = resolvedPlays.map((resolved) => {
    const isWinner = winningByKey.get(resolved.key)?.index === resolved.index;
    const afterRank = afterRankByKey.get(resolved.key) ?? null;
    const previousRank = resolved.existing?.rank ?? null;
    const otherPlays = resolvedPlays.filter((_, idx) => idx !== resolved.index);
    const otherMerged = mergeResolvedPlays(orderedBefore, otherPlays);
    const otherBaseline = otherMerged.top50.map((entry) => entry.item);
    const otherExisting = otherBaseline.find(
      (entry) => entry.songId === resolved.play.songId && entry.difficulty === resolved.play.difficulty,
    );
    const otherFloor = otherBaseline.length >= 50 ? otherBaseline[49].rating : 0;
    const threshold = otherExisting ? otherExisting.rating : otherFloor;

    let status: WhatIfImpactStatus;
    if (resolved.existingRaw) {
      if (isWinner && resolved.play.rating > resolved.existingRaw.rating + EPSILON) {
        status = "improved";
        improvedCount++;
      } else {
        status = Math.abs(resolved.play.rating - resolved.existingRaw.rating) <= EPSILON
          ? "unchanged_equal"
          : "unchanged_below_pb";
        unchangedCount++;
      }
    } else if (isWinner && afterRank !== null) {
      status = "entered_b50";
      enteredCount++;
    } else {
      status = "unchanged_below_floor";
      unchangedCount++;
    }

    return {
      index: resolved.index,
      key: resolved.key,
      play: resolved.play,
      existing: resolved.existing,
      status,
      newRank: afterRank,
      previousRank,
      rankDelta: previousRank !== null && afterRank !== null ? previousRank - afterRank : null,
      ratingGapToChangeB50: Math.max(0, threshold - resolved.play.rating),
    };
  });

  const activeIdx =
    input.activeIndex !== undefined &&
    input.activeIndex >= 0 &&
    input.activeIndex < resolvedPlays.length
      ? input.activeIndex
      : 0;
  const activeResolved = resolvedPlays[activeIdx] ?? null;
  let activeMilestones: WhatIfMultiMilestones | null = null;
  if (activeResolved) {
    const otherPlays = resolvedPlays.filter((_, idx) => idx !== activeIdx);
    const otherMerged = mergeResolvedPlays(orderedBefore, otherPlays);
    activeMilestones = computeMilestonesAgainstBaseline(
      otherMerged.top50.map((entry) => entry.item),
      activeResolved.play.songId,
      activeResolved.play.difficulty,
      activeResolved.play.constant,
      activeResolved.play.clearType,
    );
  }

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
    plays: playResults,
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
      improvedCount,
      enteredCount,
      unchangedCount,
      displacedCount: displaced.length,
    },
    activeMilestones,
  };
}

export function simulateWhatIf(input: WhatIfInput): WhatIfSimulationResult {
  const orderedBefore = sortBest50(input.best50);
  const beforeExact = exactWeightedPotential(orderedBefore);
  const beforeDisplay = formatPotential(beforeExact);
  const beforeSums = summarizeRatings(orderedBefore);
  const floorRating = orderedBefore.length >= 50 ? orderedBefore[49].rating : 0;
  const top10FloorRating = orderedBefore.length >= 10 ? orderedBefore[9].rating : 0;

  const resolved = resolvePlaySpec(orderedBefore, input, 0);
  const { existingIndex, existingRaw, syntheticEntry, existing } = resolved;
  const { constant, clearType, rating: playRating } = resolved.play;

  const previousRankMap = new Map<string, number>();
  orderedBefore.forEach((entry, idx) => {
    previousRankMap.set(`${entry.songId}:${entry.difficulty}`, idx + 1);
  });

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

  const milestones = computeMilestonesAgainstBaseline(
    orderedBefore,
    input.songId,
    input.difficulty,
    constant,
    clearType,
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
    play: resolved.play,
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
      minScoreToChangeB50: milestones.minScoreToChangeB50,
      minScoreToGainDisplayPtt: milestones.minScoreToGainDisplayPtt,
      minScoreToEnterTop10: milestones.minScoreToEnterTop10,
    },
  };
}
