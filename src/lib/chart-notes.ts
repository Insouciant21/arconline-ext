import chartNotesData from "./chart-notes.json";

const chartNotes = chartNotesData as Record<string, ReadonlyArray<number | null> | undefined>;

export function chartNoteCount(songId: string, difficulty: number): number | null {
  const count = chartNotes[songId]?.[difficulty];
  return typeof count === "number" && Number.isSafeInteger(count) && count > 0 ? count : null;
}
