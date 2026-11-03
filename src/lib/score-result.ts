import chartConstants from "./chart-constants.json";
import type { SongScore } from "./types";
import { difficultyCode, playRatingFromConstant } from "./utils";

type ChartConstant = { constant: number; old: boolean } | null;
const constants: Record<string, ChartConstant[]> = chartConstants;
const playedAtFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

export function chartConstantForSong(songId: string, difficulty: number) {
  if (!Object.hasOwn(constants, songId) || !Number.isInteger(difficulty) || difficulty < 0 || difficulty > 4) return null;
  return constants[songId][difficulty]?.constant ?? null;
}

export function resultGrade(score: number): "explus" | "ex" | "aa" | "a" | "b" | "c" | "d" {
  if (score >= 9_900_000) return "explus";
  if (score >= 9_800_000) return "ex";
  if (score >= 9_500_000) return "aa";
  if (score >= 9_000_000) return "a";
  if (score >= 8_600_000) return "b";
  if (score >= 7_900_000) return "c";
  return "d";
}

export function scoreResultData(score: SongScore) {
  const constant = chartConstantForSong(score.songId, score.difficulty);
  const clear: "fail" | "full" | "pure" | "normal" = score.clearType === 0 ? "fail" : score.clearType === 2 ? "full" : score.clearType === 3 ? "pure" : "normal";
  const date = new Date(score.timePlayed);
  const parts = score.timePlayed > 0 && Number.isFinite(date.getTime())
    ? Object.fromEntries(playedAtFormatter.formatToParts(date).map(({ type, value }) => [type, value]))
    : null;
  const dateText = parts ? `${parts.year}/${parts.month}/${parts.day} ${parts.hour}:${parts.minute}` : "—";
  const filenameDate = parts ? `${parts.year}${parts.month}${parts.day}-${parts.hour}${parts.minute}` : "undated";
  const safeId = score.songId.normalize("NFKC").replace(/[^a-z0-9_-]+/gi, "-").slice(0, 80) || "score";
  return {
    title: score.title.zh || score.title.en || score.title.ja || score.songId,
    constant,
    rating: constant === null ? null : playRatingFromConstant(constant, score),
    grade: resultGrade(score.score),
    // Grade and clear status are separate: a PURE MEMORY still has an EX+ grade.
    clear,
    scoreText: String(score.score).padStart(8, "0").replace(/\B(?=(\d{3})+(?!\d))/g, "’"),
    dateText,
    filename: `${safeId}-${difficultyCode(score.difficulty, score.difficultyAlias)}-${filenameDate}.png`,
  };
}
