import chartConstants from "./chart-constants.json";

type ChartConstant = { constant: number; old: boolean } | null;
const constants: Record<string, ChartConstant[]> = chartConstants;

export function chartConstantForSong(songId: string, difficulty: number) {
  if (!Object.hasOwn(constants, songId) || !Number.isInteger(difficulty) || difficulty < 0 || difficulty > 4) return null;
  return constants[songId][difficulty]?.constant ?? null;
}
