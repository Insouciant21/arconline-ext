import { compareSnapshots, type ComparedField } from "./history-diff";
import { exactWeightedPotential } from "./potential";
import type { B50Snapshot, Best50Score, SnapshotSummary } from "./types";
import { chartConstantFromScore, difficultyCode } from "./utils";

const beijingDateTimeFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export interface BeijingDateParts {
  year: string;
  month: string;
  day: string;
  time: string;
  monthKey: string;
  shortDate: string;
  fullDate: string;
}

export interface TimelineSnapshotItem {
  snapshot: SnapshotSummary;
  index: number;
  delta?: number;
  changed: boolean;
  parts: BeijingDateParts;
  barRatio: number;
}

export interface FilteredTimelineResult {
  items: TimelineSnapshotItem[];
  monthKeys: string[];
  hasUnchanged: boolean;
}

export interface SnapshotStats {
  top10Sum: number;
  rest40Sum: number;
  weightedExact: number;
  top10Avg: number;
  top10Floor: number;
  b50Avg: number;
  b50Floor: number;
}

export interface HistoryDiffRow {
  key: string;
  kind: "added" | "removed" | "changed" | "unchanged";
  before?: { score: Best50Score; rank: number };
  after?: { score: Best50Score; rank: number };
  fields: ComparedField[];
  scoreDelta: number | null;
  ratingDelta: number | null;
  rankDelta: number | null;
}

export interface SnapshotDiffSummary {
  rows: HistoryDiffRow[];
  changedRows: HistoryDiffRow[];
  removedRows: HistoryDiffRow[];
  byKey: Map<string, HistoryDiffRow>;
  counts: {
    added: number;
    removed: number;
    changed: number;
    unchanged: number;
    totalChanged: number;
  };
}

export type HistoryScoreGroup = "all" | "top10" | "rest40" | "changed";
export type HistoryScoreSort = "rank" | "score" | "constant" | "playedAt";

export interface HistoryScoreEntry {
  score: Best50Score;
  rank: number;
  key: string;
  chartConstant: number;
  diff?: HistoryDiffRow;
}

export interface HistoryUrlState {
  view: "detail" | "compare";
  snapshotId: string;
  beforeId?: string;
  afterId?: string;
}

/**
 * Compute PTT delta against the chronologically previous snapshot (summaries are newest-first).
 */
export function deltaAgainst(
  snapshots: ReadonlyArray<SnapshotSummary>,
  index: number,
): number | undefined {
  if (index < 0 || index + 1 >= snapshots.length) return undefined;
  return Number((snapshots[index].potential - snapshots[index + 1].potential).toFixed(3));
}

/**
 * Format an ISO timestamp into Asia/Shanghai calendar components.
 */
export function beijingDateParts(value: string): BeijingDateParts {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return {
      year: "----",
      month: "--",
      day: "--",
      time: "--:--",
      monthKey: "----/--",
      shortDate: "--/--",
      fullDate: "—",
    };
  }
  const parts = Object.fromEntries(
    beijingDateTimeFormatter.formatToParts(date).map(({ type, value: part }) => [type, part]),
  );
  const year = parts.year ?? "----";
  const month = parts.month ?? "--";
  const day = parts.day ?? "--";
  const time = `${parts.hour ?? "--"}:${parts.minute ?? "--"}`;
  return {
    year,
    month,
    day,
    time,
    monthKey: `${year}-${month}`,
    shortDate: `${Number(month)}/${Number(day)}`,
    fullDate: `${year}/${month}/${day} ${time}`,
  };
}

/**
 * Decorate and filter timeline snapshots with delta flags, relative bar heights, and month grouping.
 */
export function filterTimelineSnapshots(
  snapshots: ReadonlyArray<SnapshotSummary>,
  options: { changedOnly: boolean; month: string; selectedId: string },
): FilteredTimelineResult {
  if (!snapshots.length) {
    return { items: [], monthKeys: [], hasUnchanged: false };
  }

  let minPtt = Infinity;
  let maxPtt = -Infinity;
  for (const snapshot of snapshots) {
    if (snapshot.potential < minPtt) minPtt = snapshot.potential;
    if (snapshot.potential > maxPtt) maxPtt = snapshot.potential;
  }
  const span = maxPtt - minPtt;

  const monthKeys: string[] = [];
  const seenMonths = new Set<string>();
  let hasUnchanged = false;
  const items: TimelineSnapshotItem[] = [];

  snapshots.forEach((snapshot, index) => {
    const delta = deltaAgainst(snapshots, index);
    const changed = delta !== undefined && Math.abs(delta) > 0;
    if (delta === 0) hasUnchanged = true;

    const parts = beijingDateParts(snapshot.fetchedAt);
    if (!seenMonths.has(parts.monthKey)) {
      seenMonths.add(parts.monthKey);
      monthKeys.push(parts.monthKey);
    }

    const barRatio =
      snapshots.length <= 1 || span < 1e-9
        ? 0.65
        : Math.min(1, Math.max(0.18, 0.18 + ((snapshot.potential - minPtt) / span) * 0.82));

    if (options.changedOnly && !changed && snapshot.id !== options.selectedId && index !== 0) {
      return;
    }
    if (options.month !== "all" && parts.monthKey !== options.month) {
      return;
    }

    items.push({
      snapshot,
      index,
      delta,
      changed,
      parts,
      barRatio,
    });
  });

  return { items, monthKeys, hasUnchanged };
}

/**
 * Compute Top10 / Rest40 sums, averages, and floor thresholds for a B50 snapshot.
 */
export function computeSnapshotStats(snapshot: B50Snapshot): SnapshotStats {
  const top10 = snapshot.best50.slice(0, 10);
  const rest40 = snapshot.best50.slice(10);
  const top10Sum = top10.reduce((sum, score) => sum + score.rating, 0);
  const rest40Sum = rest40.reduce((sum, score) => sum + score.rating, 0);
  const weightedExact = exactWeightedPotential(snapshot.best50);
  const top10Avg = top10.length ? top10Sum / top10.length : 0;
  const top10Floor = top10.length >= 10 ? top10[9].rating : (top10.at(-1)?.rating ?? 0);
  const b50Avg = snapshot.best50.length ? (top10Sum + rest40Sum) / snapshot.best50.length : 0;
  const b50Floor = snapshot.best50.length ? snapshot.best50[snapshot.best50.length - 1].rating : 0;

  return {
    top10Sum,
    rest40Sum,
    weightedExact,
    top10Avg,
    top10Floor,
    b50Avg,
    b50Floor,
  };
}

/**
 * Summarize differences between a previous snapshot and the current snapshot.
 */
export function summarizeSnapshotDiff(
  prev: B50Snapshot,
  current: B50Snapshot,
): SnapshotDiffSummary {
  const rawRows = compareSnapshots(prev, current);
  let added = 0;
  let removed = 0;
  let changed = 0;
  let unchanged = 0;

  const rows: HistoryDiffRow[] = rawRows.map((row) => {
    if (row.kind === "added") added++;
    else if (row.kind === "removed") removed++;
    else if (row.kind === "changed") changed++;
    else unchanged++;

    return {
      key: row.key,
      kind: row.kind,
      before: row.before,
      after: row.after,
      fields: row.fields,
      scoreDelta:
        row.before && row.after ? row.after.score.score - row.before.score.score : null,
      ratingDelta:
        row.before && row.after
          ? Number((row.after.score.rating - row.before.score.rating).toFixed(3))
          : null,
      rankDelta: row.before && row.after ? row.before.rank - row.after.rank : null,
    };
  });

  const changedRows = rows.filter((row) => row.kind !== "unchanged");
  const removedRows = rows.filter((row) => row.kind === "removed");
  const byKey = new Map(rows.map((row) => [row.key, row]));

  return {
    rows,
    changedRows,
    removedRows,
    byKey,
    counts: {
      added,
      removed,
      changed,
      unchanged,
      totalChanged: added + removed + changed,
    },
  };
}

/**
 * Filter and sort a snapshot's B50 scores while preserving original #rank.
 */
export function filterAndSortHistoryScores(
  scores: ReadonlyArray<Best50Score>,
  options: {
    group: HistoryScoreGroup;
    query: string;
    sort: HistoryScoreSort;
    diffByKey?: ReadonlyMap<string, HistoryDiffRow>;
  },
): HistoryScoreEntry[] {
  const tokens = options.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const entries: HistoryScoreEntry[] = [];

  scores.forEach((score, idx) => {
    const rank = idx + 1;
    const key = `${score.songId}:${score.difficulty}`;
    const diff = options.diffByKey?.get(key);

    if (options.group === "top10" && rank > 10) return;
    if (options.group === "rest40" && rank <= 10) return;
    if (options.group === "changed" && (!diff || diff.kind === "unchanged")) return;

    if (tokens.length > 0) {
      const haystack = [
        score.title.zh,
        score.title.en,
        score.title.ja,
        score.artist,
        score.songId,
        difficultyCode(score.difficulty, score.difficultyAlias),
      ]
        .filter(Boolean)
        .join("\n")
        .toLowerCase();
      if (!tokens.every((token) => haystack.includes(token))) return;
    }

    entries.push({
      score,
      rank,
      key,
      chartConstant: chartConstantFromScore(score),
      diff,
    });
  });

  entries.sort((a, b) => {
    if (options.sort === "score") {
      return b.score.score - a.score.score || a.rank - b.rank;
    }
    if (options.sort === "constant") {
      return (
        b.chartConstant - a.chartConstant ||
        b.score.rating - a.score.rating ||
        a.rank - b.rank
      );
    }
    if (options.sort === "playedAt") {
      return b.score.timePlayed - a.score.timePlayed || a.rank - b.rank;
    }
    return a.rank - b.rank;
  });

  return entries;
}

/**
 * Parse URL query parameters for initial history detail or comparison state.
 */
export function parseHistoryUrlState(
  search: string,
  snapshots: ReadonlyArray<SnapshotSummary>,
): HistoryUrlState {
  const params = new URLSearchParams(search);
  const ids = new Set(snapshots.map((item) => item.id));
  const defaultId = snapshots[0]?.id ?? "";

  const view =
    params.get("view") === "compare" && snapshots.length >= 2 ? "compare" : "detail";
  const rawSnapshot = params.get("snapshot") ?? "";
  const rawBefore = params.get("before") ?? "";
  const rawAfter = params.get("after") ?? "";

  return {
    view,
    snapshotId: ids.has(rawSnapshot) ? rawSnapshot : defaultId,
    beforeId: ids.has(rawBefore) ? rawBefore : undefined,
    afterId: ids.has(rawAfter) ? rawAfter : undefined,
  };
}

/**
 * Build canonical query string (including leading '?' when non-empty) for URL sync.
 */
export function buildHistoryUrlSearch(state: {
  view: "detail" | "compare";
  snapshotId?: string;
  beforeId?: string;
  afterId?: string;
  defaultSnapshotId?: string;
}): string {
  const params = new URLSearchParams();
  if (state.view === "compare") {
    params.set("view", "compare");
    if (state.beforeId) params.set("before", state.beforeId);
    if (state.afterId) params.set("after", state.afterId);
  } else if (state.snapshotId && state.snapshotId !== state.defaultSnapshotId) {
    params.set("snapshot", state.snapshotId);
  }
  const encoded = params.toString();
  return encoded ? `?${encoded}` : "";
}
