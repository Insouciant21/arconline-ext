import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function formatNumber(value: number, maximumFractionDigits = 3) {
  return new Intl.NumberFormat("zh-CN", {
    maximumFractionDigits,
    minimumFractionDigits: 0,
  }).format(value);
}

export function formatScore(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

export function scoreModifier(score: number) {
  if (score >= 10_000_000) return 2;
  if (score >= 9_800_000) return 1 + (score - 9_800_000) / 200_000;
  return (score - 9_500_000) / 300_000;
}

/**
 * Reverse the current single-play rating formula to infer the chart constant.
 * Lowiro's rating includes a 0.2 clear bonus for a non-lost result.
 */
export function chartConstantFromScore(score: { score: number; rating: number; clearType: number }) {
  const clearBonus = score.clearType > 0 ? 0.2 : 0;
  const constant = score.rating - scoreModifier(score.score) - clearBonus;
  return Math.max(0, Math.round(constant * 10) / 10);
}

export function formatRelativeDate(value: string | number) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const currentYear = new Date().getFullYear();
  const options: Intl.DateTimeFormatOptions = {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    ...(date.getFullYear() !== currentYear ? { year: "numeric" } : {}),
  };
  return new Intl.DateTimeFormat("zh-CN", {
    ...options,
  }).format(date);
}

export function formatJoinDate(value: number) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return year && month && day ? `${year}/${month}/${day}` : "—";
}

export function difficultyLabel(difficulty: number) {
  return ["Past", "Present", "Future", "Beyond", "Eternal", "Inscribed"][difficulty] ?? `D${difficulty}`;
}

export function difficultyTone(difficulty: number) {
  return ["past", "present", "future", "beyond", "eternal", "inscribed"][difficulty] ?? "future";
}

export function difficultyCode(difficulty: number) {
  return ["PST", "PRS", "FTR", "BYD", "ETR", "INS"][difficulty] ?? `D${difficulty}`;
}

export function clearTypeLabel(clearType: number) {
  return {
    0: "Track Lost",
    1: "Track Complete",
    2: "Full Recall",
    3: "Pure Memory",
    4: "Easy Clear",
    5: "Hard Clear",
  }[clearType] ?? "Unknown";
}

export function clearTypeCode(clearType: number) {
  return {
    0: "TL",
    1: "TC",
    2: "FR",
    3: "PM",
    4: "EC",
    5: "HC",
  }[clearType] ?? "—";
}
