"use client";

import * as React from "react";
import {
  ArrowRight,
  Calculator,
  Check,
  Loader2,
  Plus,
  Search,
  Target,
  TrendingUp,
  X,
} from "lucide-react";
import { AppNavigation } from "@/components/app-navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { chartNoteCount } from "@/lib/chart-notes";
import { CHART_CONSTANTS_VERSION, chartConstantForSong } from "@/lib/chart-constants";
import { exactWeightedPotential, formatPotential } from "@/lib/potential";
import {
  displaySongArtist,
  displaySongTitle,
  formatDifficultyLevel,
  getCatalogDifficulty,
  getSongById,
  getSongCatalog,
  searchCatalogSongs,
  type CatalogSong,
} from "@/lib/song-catalog";
import type { Best50Score, DashboardPayload, SongScore, SongScoresPayload } from "@/lib/types";
import {
  clearTypeCode,
  difficultyCode,
  difficultyTone,
  formatScore,
} from "@/lib/utils";
import {
  farCountForMaxPureScore,
  MAX_WHAT_IF_QUEUE,
  maxPureScoreFromFar,
  parseFarInput,
  simulateMultiWhatIf,
  type WhatIfMultiPlayResult,
  type WhatIfMultiSimulationResult,
  whatIfScoreGrade,
} from "@/lib/what-if";

const CLEAR_TYPE_OPTIONS = [
  { value: "1", label: "TC · Track Complete", triggerLabel: "TC · 通关" },
  { value: "3", label: "PM · Pure Memory", triggerLabel: "PM · 满分" },
  { value: "2", label: "FR · Full Recall", triggerLabel: "FR · 全连" },
  { value: "5", label: "HC · Hard Clear", triggerLabel: "HC · 困难通关" },
  { value: "4", label: "EC · Easy Clear", triggerLabel: "EC · 简单通关" },
  { value: "0", label: "TL · Track Lost", triggerLabel: "TL · 未通关" },
] as const;

type CatalogScope = "all" | "b50";
type B50TableView = "affected" | "all";

interface QueuedChart {
  uid: string;
  songId: string;
  difficulty: number;
  farInput: string;
  clearType: number;
}

interface PbCacheEntry {
  state: "loading" | "done" | "error";
  score: SongScore | null;
  error: string | null;
}

function resolveSongDifficulty(song: CatalogSong, preferredDifficulty: number): number {
  const matched = getCatalogDifficulty(song, preferredDifficulty);
  if (matched) return matched.difficulty;
  return (
    song.difficulties.find((item) => item.difficulty === 2)?.difficulty ??
    song.difficulties[song.difficulties.length - 1]?.difficulty ??
    2
  );
}

function pickPreferredDifficulty(
  song: CatalogSong,
  sortedB50: ReadonlyArray<Best50Score>,
  excludeDiffs?: ReadonlySet<number>,
): number {
  const available = excludeDiffs
    ? song.difficulties.filter((diff) => !excludeDiffs.has(diff.difficulty))
    : song.difficulties;
  const candidates = available.length ? available : song.difficulties;
  const candidateDiffs = new Set(candidates.map((diff) => diff.difficulty));
  const b50Match = sortedB50.find(
    (entry) => entry.songId === song.id && candidateDiffs.has(entry.difficulty),
  );
  if (b50Match) return b50Match.difficulty;
  if (candidateDiffs.has(2)) return 2;
  return [...candidates].sort((a, b) => b.difficulty - a.difficulty)[0]?.difficulty ?? 2;
}

export function WhatIfShell({ initialData }: { initialData: DashboardPayload }) {
  const best50 = initialData.latest?.best50 ?? [];
  const sortedB50 = React.useMemo(
    () => [...best50].sort((a, b) => b.rating - a.rating).slice(0, 50),
    [best50],
  );
  const b50SongIds = React.useMemo(() => new Set(sortedB50.map((entry) => entry.songId)), [sortedB50]);
  const b50RankByKey = React.useMemo(() => {
    const map = new Map<string, { rank: number; entry: Best50Score }>();
    sortedB50.forEach((entry, index) => {
      map.set(`${entry.songId}:${entry.difficulty}`, { rank: index + 1, entry });
    });
    return map;
  }, [sortedB50]);

  const catalog = React.useMemo(() => getSongCatalog(), []);
  const defaultSong = React.useMemo(() => {
    const firstB50 = sortedB50[0];
    if (firstB50) {
      const found = getSongById(firstB50.songId);
      if (found) return found;
    }
    return getSongById("grievouslady") ?? catalog[0];
  }, [catalog, sortedB50]);

  const defaultDifficulty = React.useMemo(() => {
    if (sortedB50[0] && sortedB50[0].songId === defaultSong.id) {
      return sortedB50[0].difficulty;
    }
    return (
      defaultSong.difficulties.find((item) => item.difficulty === 2)?.difficulty ??
      defaultSong.difficulties[defaultSong.difficulties.length - 1]?.difficulty ??
      2
    );
  }, [defaultSong, sortedB50]);

  const [scope, setScope] = React.useState<CatalogScope>("all");
  const [searchTerm, setSearchTerm] = React.useState("");
  const nextSlotIdRef = React.useRef(2);
  const [queue, setQueue] = React.useState<QueuedChart[]>(() => [
    {
      uid: "slot-1",
      songId: defaultSong.id,
      difficulty: defaultDifficulty,
      farInput: "0",
      clearType: 1,
    },
  ]);
  const [activeUid, setActiveUid] = React.useState("slot-1");
  const [tableView, setTableView] = React.useState<B50TableView>("affected");

  const [pbCache, setPbCache] = React.useState<Record<string, PbCacheEntry>>({});
  const pbAbortMapRef = React.useRef<Map<string, AbortController>>(new Map());

  React.useEffect(() => {
    return () => {
      delete document.documentElement.dataset.whatIfSelectOpen;
      for (const controller of pbAbortMapRef.current.values()) {
        controller.abort();
      }
      pbAbortMapRef.current.clear();
    };
  }, []);

  const activeIndex = React.useMemo(() => {
    const idx = queue.findIndex((item) => item.uid === activeUid);
    return idx >= 0 ? idx : 0;
  }, [queue, activeUid]);
  const activeSlot = queue[activeIndex] ?? queue[0];

  const selectedSong = React.useMemo(
    () => getSongById(activeSlot.songId) ?? defaultSong,
    [activeSlot.songId, defaultSong],
  );
  const activeDifficulty = React.useMemo(
    () => resolveSongDifficulty(selectedSong, activeSlot.difficulty),
    [selectedSong, activeSlot.difficulty],
  );
  const noteCount = React.useMemo(
    () => chartNoteCount(selectedSong.id, activeDifficulty),
    [selectedSong.id, activeDifficulty],
  );
  const parsedFar = React.useMemo(
    () => parseFarInput(activeSlot.farInput, noteCount),
    [activeSlot.farInput, noteCount],
  );
  const effectiveScore =
    noteCount !== null && parsedFar !== null ? maxPureScoreFromFar(noteCount, parsedFar) : 0;

  const resolvedQueue = React.useMemo(
    () =>
      queue.map((slot) => {
        const song = getSongById(slot.songId) ?? defaultSong;
        const difficulty = resolveSongDifficulty(song, slot.difficulty);
        const notes = chartNoteCount(song.id, difficulty);
        const far = parseFarInput(slot.farInput, notes);
        const score = notes !== null && far !== null ? maxPureScoreFromFar(notes, far) : 0;
        return {
          slot,
          song,
          difficulty,
          noteCount: notes,
          parsedFar: far,
          score,
        };
      }),
    [queue, defaultSong],
  );

  const queuedDiffsBySong = React.useMemo(() => {
    const map = new Map<string, Set<number>>();
    for (const item of resolvedQueue) {
      let set = map.get(item.song.id);
      if (!set) {
        set = new Set<number>();
        map.set(item.song.id, set);
      }
      set.add(item.difficulty);
    }
    return map;
  }, [resolvedQueue]);

  const simulation = React.useMemo(
    () =>
      simulateMultiWhatIf({
        best50: sortedB50,
        plays: resolvedQueue.map((item) => ({
          songId: item.song.id,
          difficulty: item.difficulty,
          score: item.score,
          clearType: item.slot.clearType,
        })),
        activeIndex,
      }),
    [sortedB50, resolvedQueue, activeIndex],
  );

  const activePlayResult = simulation.plays[activeIndex] ?? simulation.plays[0];
  const activeKey = `${selectedSong.id}:${activeDifficulty}`;
  const activePb = pbCache[activeKey] ?? { state: "idle" as const, score: null, error: null };

  const searchResults = React.useMemo(() => {
    if (scope === "b50") {
      const normalized = searchTerm.trim().toLowerCase();
      const uniqueSongs: Array<{ song: CatalogSong; bestRank: number }> = [];
      const seen = new Set<string>();
      sortedB50.forEach((entry, index) => {
        if (seen.has(entry.songId)) return;
        const song = getSongById(entry.songId);
        if (!song) return;
        if (normalized) {
          const haystack = [
            song.id,
            song.title,
            song.ja,
            song.artist,
            ...(song.search ?? []),
            ...song.difficulties.flatMap((d) => [d.title, d.artist]),
          ]
            .filter(Boolean)
            .join("\n")
            .toLowerCase();
          const tokens = normalized.split(/\s+/).filter(Boolean);
          if (!tokens.every((token) => haystack.includes(token))) return;
        }
        seen.add(entry.songId);
        uniqueSongs.push({ song, bestRank: index + 1 });
      });
      return uniqueSongs.map((item) => item.song);
    }
    return searchCatalogSongs(searchTerm, {
      limit: 40,
      prioritizeSongIds: b50SongIds,
    });
  }, [scope, searchTerm, sortedB50, b50SongIds]);

  const updateActiveSlot = React.useCallback(
    (updater: (slot: QueuedChart) => QueuedChart) => {
      setQueue((prev) =>
        prev.map((slot, index) => (index === activeIndex ? updater(slot) : slot)),
      );
    },
    [activeIndex],
  );

  function selectSong(song: CatalogSong) {
    if (queue.length > 1) {
      const existingMatches = resolvedQueue.filter((item) => item.song.id === song.id);
      if (existingMatches.length > 0) {
        const currentIdx = existingMatches.findIndex((item) => item.slot.uid === activeSlot.uid);
        const target =
          currentIdx >= 0
            ? existingMatches[(currentIdx + 1) % existingMatches.length]
            : existingMatches[0];
        setActiveUid(target.slot.uid);
        return;
      }
    }
    if (song.id === selectedSong.id) return;
    const usedOtherDiffs = new Set(
      resolvedQueue
        .filter((item) => item.slot.uid !== activeSlot.uid && item.song.id === song.id)
        .map((item) => item.difficulty),
    );
    const nextDiff = pickPreferredDifficulty(song, sortedB50, usedOtherDiffs);
    updateActiveSlot((slot) => ({
      ...slot,
      songId: song.id,
      difficulty: nextDiff,
      farInput: "0",
    }));
  }

  function addSongToQueue(song: CatalogSong) {
    if (queue.length >= MAX_WHAT_IF_QUEUE) return;
    const existingDiffs = queuedDiffsBySong.get(song.id);
    if (existingDiffs && existingDiffs.size >= song.difficulties.length) return;
    const nextDiff = pickPreferredDifficulty(song, sortedB50, existingDiffs);
    const nextUid = `slot-${nextSlotIdRef.current++}`;
    setQueue((prev) => [
      ...prev,
      {
        uid: nextUid,
        songId: song.id,
        difficulty: nextDiff,
        farInput: "0",
        clearType: 1,
      },
    ]);
    setActiveUid(nextUid);
  }

  function removeSlot(uid: string) {
    if (queue.length <= 1) return;
    const idx = queue.findIndex((item) => item.uid === uid);
    const next = queue.filter((item) => item.uid !== uid);
    if (uid === activeUid && next.length > 0) {
      const fallback = next[Math.min(Math.max(idx, 0), next.length - 1)];
      setActiveUid(fallback.uid);
    }
    setQueue(next);
  }

  function resetAllFar() {
    setQueue((prev) => prev.map((slot) => ({ ...slot, farInput: "0" })));
  }

  function keepOnlyActive() {
    const current = queue[activeIndex] ?? queue[0];
    if (current) setQueue([current]);
  }

  function selectDifficulty(difficulty: number) {
    const otherSlot = resolvedQueue.find(
      (item) =>
        item.slot.uid !== activeSlot.uid &&
        item.song.id === selectedSong.id &&
        item.difficulty === difficulty,
    );
    if (otherSlot) {
      setActiveUid(otherSlot.slot.uid);
      return;
    }
    updateActiveSlot((slot) => ({
      ...slot,
      difficulty,
      farInput: "0",
    }));
  }

  function applyTargetScore(targetScore: number, nextClearType?: number) {
    if (noteCount === null) return;
    const farCount = farCountForMaxPureScore(noteCount, targetScore);
    if (farCount === null) return;
    const resultScore = maxPureScoreFromFar(noteCount, farCount);
    updateActiveSlot((slot) => ({
      ...slot,
      farInput: String(farCount),
      clearType:
        nextClearType !== undefined
          ? nextClearType
          : resultScore >= 10_000_000 && slot.clearType === 0
            ? 3
            : slot.clearType,
    }));
  }

  const applyFarValue = React.useCallback(
    (farCount: number) => {
      updateActiveSlot((slot) => ({
        ...slot,
        farInput: String(farCount),
      }));
    },
    [updateActiveSlot],
  );

  async function lookupOfficialScore() {
    const lookupKey = `${selectedSong.id}:${activeDifficulty}`;
    pbAbortMapRef.current.get(lookupKey)?.abort();
    const controller = new AbortController();
    pbAbortMapRef.current.set(lookupKey, controller);
    setPbCache((prev) => ({
      ...prev,
      [lookupKey]: { state: "loading", score: null, error: null },
    }));
    const queryTerm = (displaySongTitle(selectedSong, activeDifficulty) || selectedSong.id).slice(0, 100);
    try {
      const params = new URLSearchParams({
        term: queryTerm,
        difficulty: String(activeDifficulty),
        page: "1",
        sort: "title",
      });
      const response = await fetch(`/api/scores?${params.toString()}`, {
        signal: controller.signal,
        cache: "no-store",
      });
      if (response.status === 401) {
        window.location.assign(`/login?callbackUrl=${encodeURIComponent(window.location.pathname)}`);
        return;
      }
      const payload = (await response.json()) as SongScoresPayload & { error?: string };
      if (!response.ok) throw new Error(payload.error || "查询失败，请稍后重试。");
      if (controller.signal.aborted) return;
      const matched = payload.scores.find(
        (item) => item.songId === selectedSong.id && item.difficulty === activeDifficulty,
      );
      setPbCache((prev) => ({
        ...prev,
        [lookupKey]: { state: "done", score: matched ?? null, error: null },
      }));
    } catch (caught) {
      if (!controller.signal.aborted) {
        setPbCache((prev) => ({
          ...prev,
          [lookupKey]: {
            state: "error",
            score: null,
            error: caught instanceof Error ? caught.message : "查询失败，请稍后重试。",
          },
        }));
      }
    } finally {
      if (pbAbortMapRef.current.get(lookupKey) === controller) {
        pbAbortMapRef.current.delete(lookupKey);
      }
    }
  }

  const beforeExact = exactWeightedPotential(sortedB50);
  const beforeDisplay = formatPotential(beforeExact);
  const floorRating = sortedB50.length >= 50 ? sortedB50[49].rating : 0;
  const top10FloorRating = sortedB50.length >= 10 ? sortedB50[9].rating : 0;

  const visibleRows = React.useMemo(() => {
    const rows = simulation.after.best50;
    if (tableView === "all" || rows.length <= 15) return rows;
    const simIndices: number[] = [];
    rows.forEach((entry, idx) => {
      if (entry.isSimulated) simIndices.push(idx);
    });
    if (!simIndices.length) {
      return rows.slice(0, 10);
    }
    const radius = simIndices.length === 1 ? 4 : 2;
    const include = new Set<number>();
    for (const idx of simIndices) {
      const start = Math.max(0, idx - radius);
      const end = Math.min(rows.length - 1, idx + radius);
      for (let cursor = start; cursor <= end; cursor++) {
        include.add(cursor);
      }
    }
    return rows.filter((_, idx) => include.has(idx));
  }, [simulation.after.best50, tableView]);

  const activeTitle = displaySongTitle(selectedSong, activeDifficulty);
  const activeArtist = displaySongArtist(selectedSong, activeDifficulty);
  const deltaClass =
    simulation.impact.exactDelta > 1e-9 ? "up" : simulation.impact.exactDelta < -1e-9 ? "down" : "flat";
  const displayDeltaClass =
    simulation.impact.displayDelta > 0 ? "up" : simulation.impact.displayDelta < 0 ? "down" : "flat";
  const milestoneScores = React.useMemo(() => {
    const milestones = simulation.activeMilestones;
    const representable = (targetScore: number | null) => {
      if (noteCount === null || targetScore === null) return null;
      const farCount = farCountForMaxPureScore(noteCount, targetScore, "atLeast");
      if (farCount === null) return null;
      return { farCount, score: maxPureScoreFromFar(noteCount, farCount) };
    };
    return {
      changeB50: representable(milestones?.minScoreToChangeB50 ?? null),
      gainDisplayPtt: representable(milestones?.minScoreToGainDisplayPtt ?? null),
      enterTop10: representable(milestones?.minScoreToEnterTop10 ?? null),
    };
  }, [noteCount, simulation.activeMilestones]);

  const maxSimulatedRating = React.useMemo(
    () => simulation.plays.reduce((max, item) => Math.max(max, item.play.rating), 0),
    [simulation.plays],
  );
  const isMulti = queue.length > 1;
  const bannerStatus = isMulti
    ? simulation.impact.enteredCount + simulation.impact.improvedCount > 0
      ? "improved"
      : "unchanged_below_floor"
    : activePlayResult.status;

  return (
    <main className="app-shell what-if-shell">
      <AppNavigation current="what-if" />
      <div className="app-content">
        <section className="logs-intro what-if-intro" aria-labelledby="what-if-title">
          <div>
            <p className="section-kicker">
              <Calculator size={13} /> WHAT-IF SIMULATOR
            </p>
            <h1 id="what-if-title">
              测试 如果 y <span>/ MULTI-CHART B50 SIMULATION</span>
            </h1>
          </div>
          <div className="what-if-baseline-grid" aria-label="当前基准数据">
            <div className="what-if-baseline-item">
              <span>当前 B50 加权</span>
              <strong>{sortedB50.length ? beforeDisplay.toFixed(3) : "—"}</strong>
              <small>{sortedB50.length ? beforeExact.toFixed(6) : "暂无快照"}</small>
            </div>
            <div className="what-if-baseline-item">
              <span>B50 守门线 #50</span>
              <strong>{sortedB50.length >= 50 ? floorRating.toFixed(3) : "未满 50"}</strong>
              <small>Top10 门槛 {sortedB50.length >= 10 ? top10FloorRating.toFixed(3) : "—"}</small>
            </div>
          </div>
        </section>

        {!sortedB50.length ? (
          <div className="what-if-notice" role="status">
            <span>尚未同步任何 B50 快照：当前仅基于空白 B50 推演单曲成绩，可先前往</span>
            <a href="/">概览页同步 B50</a>
            <span>以获得完整的进榜与排名对比。</span>
          </div>
        ) : null}

        <section className="what-if-workspace" aria-label="模拟参数与结果">
          <div className="section-block what-if-controls">
            <div className="what-if-panel-head">
              <div>
                <p className="section-kicker">STEP 01 · CHART &amp; FAR</p>
                <h2>选曲</h2>
              </div>
              <Badge variant="outline">定数 v{CHART_CONSTANTS_VERSION} · {catalog.length} 首</Badge>
            </div>

            <div className="what-if-picker-toolbar">
              <label className="what-if-search-box">
                <Search size={15} aria-hidden="true" />
                <input
                  type="search"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="搜索曲名 / 别名 / 日文韩文读音 / 作曲家 / ID…"
                  aria-label="搜索曲目"
                  autoComplete="off"
                />
              </label>
              <div className="what-if-scope-tabs" role="tablist" aria-label="曲目列表范围">
                <button
                  type="button"
                  role="tab"
                  aria-selected={scope === "all"}
                  className={scope === "all" ? "active" : ""}
                  onClick={() => setScope("all")}
                >
                  全部曲库
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={scope === "b50"}
                  className={scope === "b50" ? "active" : ""}
                  onClick={() => setScope("b50")}
                  disabled={!sortedB50.length}
                >
                  当前 B50 ({b50SongIds.size})
                </button>
              </div>
            </div>

            <div className="what-if-song-list" role="list" aria-label="匹配曲目">
              {searchResults.length ? (
                searchResults.map((song) => {
                  const isSelected = song.id === selectedSong.id;
                  const inB50 = b50SongIds.has(song.id);
                  const queuedDiffs = queuedDiffsBySong.get(song.id);
                  const allDiffsQueued = Boolean(queuedDiffs && queuedDiffs.size >= song.difficulties.length);
                  const queueFull = queue.length >= MAX_WHAT_IF_QUEUE;
                  return (
                    <div
                      key={song.id}
                      role="listitem"
                      className={`what-if-song-option${isSelected ? " active" : ""}`}
                    >
                      <button
                        type="button"
                        className="what-if-song-option-main"
                        aria-pressed={isSelected}
                        onClick={() => selectSong(song)}
                      >
                        <div className="what-if-song-option-copy">
                          <strong>
                            {song.title}
                            {song.ja && song.ja !== song.title ? <small>{song.ja}</small> : null}
                          </strong>
                          <span>{song.artist}</span>
                        </div>
                        <div className="what-if-song-option-diffs">
                          {inB50 ? <span className="what-if-in-b50-tag">B50</span> : null}
                          {song.difficulties.map((diff) => (
                            <span
                              key={diff.difficulty}
                              className={`what-if-diff-pill difficulty-${difficultyTone(diff.difficulty, diff.alias)}${queuedDiffs?.has(diff.difficulty) ? " is-queued" : ""}`}
                            >
                              {difficultyCode(diff.difficulty, diff.alias)} {formatDifficultyLevel(diff)}
                            </span>
                          ))}
                        </div>
                      </button>
                      <button
                        type="button"
                        className={`what-if-song-add-btn${allDiffsQueued ? " is-done" : ""}`}
                        disabled={allDiffsQueued || queueFull}
                        onClick={() => addSongToQueue(song)}
                        aria-label={
                          allDiffsQueued
                            ? `${song.title} 全部难度已在推演列表`
                            : queueFull
                              ? `最多可添加 ${MAX_WHAT_IF_QUEUE} 首`
                              : `添加 ${song.title} 到联合推演`
                        }
                        title={
                          allDiffsQueued
                            ? "该曲目全部难度已在推演列表"
                            : queueFull
                              ? `最多可叠加 ${MAX_WHAT_IF_QUEUE} 个谱面`
                              : "添加到联合推演（可多次添加不同难度）"
                        }
                      >
                        {allDiffsQueued ? <Check size={14} /> : <Plus size={14} />}
                      </button>
                    </div>
                  );
                })
              ) : (
                <div className="what-if-song-empty">没有匹配的曲目，可尝试输入英文原名、日文假名或歌曲 ID。</div>
              )}
            </div>

            <div className="what-if-selected-chart">
              <div className="what-if-selected-top">
                <div className="what-if-selected-meta">
                  <span className="score-label">
                    SELECTED TRACK{isMulti ? ` · S${activeIndex + 1}` : ""}
                  </span>
                  <h3>{activeTitle}</h3>
                  <p>
                    {activeArtist}
                    {selectedSong.ja && selectedSong.ja !== activeTitle ? ` · ${selectedSong.ja}` : ""}
                  </p>
                </div>
                <div className="what-if-diff-tabs" role="group" aria-label="选择难度">
                  {selectedSong.difficulties.map((diff) => {
                    const active = diff.difficulty === activeDifficulty;
                    const constant = chartConstantForSong(selectedSong.id, diff.difficulty);
                    const b50Match = b50RankByKey.get(`${selectedSong.id}:${diff.difficulty}`);
                    const otherSlotIdx = resolvedQueue.findIndex(
                      (item) =>
                        item.slot.uid !== activeSlot.uid &&
                        item.song.id === selectedSong.id &&
                        item.difficulty === diff.difficulty,
                    );
                    return (
                      <button
                        key={diff.difficulty}
                        type="button"
                        aria-pressed={active}
                        className={`what-if-diff-button difficulty-${difficultyTone(diff.difficulty, diff.alias)}${active ? " active" : ""}${otherSlotIdx >= 0 ? " in-other-slot" : ""}`}
                        onClick={() => selectDifficulty(diff.difficulty)}
                        title={otherSlotIdx >= 0 ? `已在 S${otherSlotIdx + 1}，点击切换编辑` : undefined}
                      >
                        <span className="what-if-diff-code">
                          {difficultyCode(diff.difficulty, diff.alias)} {formatDifficultyLevel(diff)}
                        </span>
                        <strong>{constant !== null ? constant.toFixed(1) : "—"}</strong>
                        {b50Match ? (
                          <small>#{b50Match.rank}</small>
                        ) : otherSlotIdx >= 0 ? (
                          <small>S{otherSlotIdx + 1}</small>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="what-if-milestones what-if-milestones-inline" aria-label="目标分数参考">
                <div className="what-if-milestone-header">
                  <Target size={13} />
                  <span>
                    目标分数线（
                    {isMulti ? `其余 ${queue.length - 1} 首联合基线 · ` : ""}
                    定数 {activePlayResult.play.constant.toFixed(1)} &amp;{" "}
                    {clearTypeCode(activePlayResult.play.clearType)}）
                  </span>
                </div>
                <div className="what-if-milestone-grid">
                  <MilestoneButton
                    label={simulation.activeMilestones?.existingInBaseline ? "刷新当前成绩" : "进入 B50 (#50)"}
                    farCount={milestoneScores.changeB50?.farCount ?? null}
                    score={milestoneScores.changeB50?.score ?? null}
                    onSelect={applyFarValue}
                  />
                  <MilestoneButton
                    label={`显示 PTT +0.001 (${((Math.round((simulation.activeMilestones?.baselineDisplayPotential ?? 0) * 1000) + 1) / 1000).toFixed(3)})`}
                    farCount={milestoneScores.gainDisplayPtt?.farCount ?? null}
                    score={milestoneScores.gainDisplayPtt?.score ?? null}
                    onSelect={applyFarValue}
                  />
                  <MilestoneButton
                    label={simulation.activeMilestones?.alreadyInTop10 ? "已在 Top 10" : "进入 Top 10 (#10)"}
                    farCount={milestoneScores.enterTop10?.farCount ?? null}
                    score={milestoneScores.enterTop10?.score ?? null}
                    alreadyDone={Boolean(simulation.activeMilestones?.alreadyInTop10)}
                    onSelect={applyFarValue}
                  />
                </div>
              </div>
            </div>

            <div className="what-if-current-pb">
              {activePlayResult.existing ? (
                <div className="what-if-pb-row">
                  <div>
                    <span className="score-label">CURRENT B50 ENTRY</span>
                    <strong>
                      #{activePlayResult.existing.rank} · {formatScore(activePlayResult.existing.score)}{" "}
                      <em>{clearTypeCode(activePlayResult.existing.clearType)}</em>
                    </strong>
                    <small>
                      当前单曲 PTT {activePlayResult.existing.rating.toFixed(6)}
                      {activePlayResult.existing.foldedFarCount !== null ? (
                        <>
                          {" "}· 折合 FAR {activePlayResult.existing.foldedFarCount}（
                          {activePlayResult.existing.nearCount} FAR + {activePlayResult.existing.missCount} LOST）
                        </>
                      ) : null}
                    </small>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      applyTargetScore(activePlayResult.existing!.score, activePlayResult.existing!.clearType)
                    }
                  >
                    填入对应 FAR
                  </Button>
                </div>
              ) : (
                <div className="what-if-pb-row">
                  <div>
                    <span className="score-label">CURRENT PERSONAL BEST</span>
                    {activePb.state === "done" ? (
                      activePb.score ? (
                        <>
                          <strong>
                            {formatScore(activePb.score.score)} <em>{clearTypeCode(activePb.score.clearType)}</em>
                          </strong>
                          <small>
                            单曲 PTT{" "}
                            {activePlayResult.play.constant
                              ? (
                                  Math.max(
                                    0,
                                    activePlayResult.play.constant +
                                      (activePb.score.score >= 10_000_000
                                        ? 2
                                        : activePb.score.score >= 9_800_000
                                          ? 1 + (activePb.score.score - 9_800_000) / 200_000
                                          : (activePb.score.score - 9_500_000) / 300_000) +
                                      (activePb.score.clearType > 0 ? 0.2 : 0),
                                  )
                                ).toFixed(3)
                              : "—"}
                            {" · "}尚未进入 B50
                          </small>
                        </>
                      ) : (
                        <strong>官网暂无该谱面成绩</strong>
                      )
                    ) : activePb.state === "error" ? (
                      <strong className="what-if-pb-error">{activePb.error}</strong>
                    ) : (
                      <strong>当前未进入 B50</strong>
                    )}
                  </div>
                  <div className="what-if-pb-actions">
                    {activePb.score ? (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => applyTargetScore(activePb.score!.score, activePb.score!.clearType)}
                      >
                        填入对应 FAR
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={lookupOfficialScore}
                      disabled={activePb.state === "loading"}
                    >
                      {activePb.state === "loading" ? <Loader2 size={13} className="spin" /> : <Search size={13} />}
                      {activePb.state === "loading" ? "查询中…" : "查官网成绩"}
                    </Button>
                  </div>
                </div>
              )}
            </div>

            <div className="what-if-inputs-grid">
              <label className="what-if-field">
                <span>
                  FAR 个数
                  <em>{parsedFar ?? "—"} / {noteCount ?? "—"}</em>
                </span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={activeSlot.farInput}
                  onChange={(event) => {
                    const value = event.target.value;
                    updateActiveSlot((slot) => ({ ...slot, farInput: value }));
                  }}
                  placeholder="例如 1"
                  aria-label="FAR 个数"
                />
                {parsedFar === null ? (
                  <small className="what-if-input-error">
                    {noteCount === null
                      ? "缺少该谱面的物量数据。"
                      : `请输入 0 至 ${noteCount.toLocaleString("en-US")} 的整数。`}
                  </small>
                ) : null}
              </label>

              <div className="what-if-field">
                <label htmlFor="what-if-clear-type">通关状态</label>
                <Select
                  id="what-if-clear-type"
                  name="clearType"
                  value={String(activeSlot.clearType)}
                  onValueChange={(value) => {
                    const nextClear = Number(value);
                    updateActiveSlot((slot) => ({ ...slot, clearType: nextClear }));
                  }}
                  options={CLEAR_TYPE_OPTIONS}
                  contentClassName="what-if-clear-type-menu"
                  onOpenChange={(open) => {
                    if (open) {
                      document.documentElement.dataset.whatIfSelectOpen = "true";
                    } else {
                      delete document.documentElement.dataset.whatIfSelectOpen;
                    }
                  }}
                />
              </div>

              <label className="what-if-field what-if-score-field">
                <span>
                  假设分数 Y
                  <em className={`what-if-grade-chip grade-${whatIfScoreGrade(effectiveScore).toLowerCase().replace("+", "-plus")}`}>
                    {whatIfScoreGrade(effectiveScore)}
                  </em>
                </span>
                <input
                  type="text"
                  value={parsedFar !== null ? formatScore(effectiveScore) : "—"}
                  readOnly
                  aria-readonly="true"
                  aria-label="由 FAR 个数计算得到的假设分数 Y"
                />
                <small className="what-if-input-hint">
                  {parsedFar !== null
                    ? `单曲 PTT ${activePlayResult.play.rating.toFixed(6)} · 定数 ${activePlayResult.play.constant.toFixed(1)}`
                    : null}
                </small>
              </label>
            </div>

            <div className="what-if-queue-block" aria-label="联合推演曲目队列">
              <div className="what-if-queue-header">
                <div className="what-if-queue-title">
                  <span>联合推演队列 ({queue.length}/{MAX_WHAT_IF_QUEUE})</span>
                  {!isMulti ? <small>点击上方曲目右侧「+」可叠加多首共同推演</small> : null}
                </div>
                {isMulti ? (
                  <div className="what-if-queue-actions">
                    <button type="button" onClick={resetAllFar}>
                      全部 0 FAR
                    </button>
                    <button type="button" onClick={keepOnlyActive}>
                      仅留当前
                    </button>
                  </div>
                ) : null}
              </div>
              {isMulti ? (
                <div className="what-if-queue-list" role="list">
                  {resolvedQueue.map((item, idx) => {
                    const playResult = simulation.plays[idx];
                    const isCurrent = item.slot.uid === activeSlot.uid;
                    const catalogDiff = getCatalogDifficulty(item.song, item.difficulty);
                    const diffLabel = catalogDiff
                      ? `${difficultyCode(item.difficulty, catalogDiff.alias)} ${formatDifficultyLevel(catalogDiff)}`
                      : difficultyCode(item.difficulty);
                    return (
                      <div
                        key={item.slot.uid}
                        role="listitem"
                        className={`what-if-queue-item${isCurrent ? " active" : ""}`}
                      >
                        <button
                          type="button"
                          className="what-if-queue-item-main"
                          aria-current={isCurrent ? "true" : undefined}
                          onClick={() => setActiveUid(item.slot.uid)}
                        >
                          <span className="what-if-queue-slot">S{idx + 1}</span>
                          <span
                            className={`what-if-diff-pill difficulty-${difficultyTone(item.difficulty, catalogDiff?.alias)}`}
                          >
                            {diffLabel}
                          </span>
                          <div className="what-if-queue-copy">
                            <strong>
                              <span className="what-if-queue-title-text">{playResult.play.title}</span>
                              {isCurrent ? <span className="what-if-queue-editing-tag">编辑中</span> : null}
                            </strong>
                            <small>
                              {item.parsedFar !== null ? `${item.parsedFar} FAR` : "FAR 无效"} ·{" "}
                              {clearTypeCode(item.slot.clearType)} ·{" "}
                              {item.parsedFar !== null ? formatScore(item.score) : "—"} ·{" "}
                              {playResult.play.rating.toFixed(3)} PTT
                              {playResult.status === "entered_b50" && playResult.newRank
                                ? ` · 新入 #${playResult.newRank}`
                                : playResult.status === "improved" && playResult.newRank
                                  ? ` · 升至 #${playResult.newRank}`
                                  : ""}
                            </small>
                          </div>
                        </button>
                        <button
                          type="button"
                          className="what-if-queue-remove"
                          onClick={() => removeSlot(item.slot.uid)}
                          aria-label={`移除 ${playResult.play.title}`}
                          title="从推演队列移除"
                        >
                          <X size={13} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>
          </div>

          <div className="section-block what-if-results">
            <div className="what-if-panel-head">
              <div>
                <p className="section-kicker">STEP 02 · POTENTIAL IMPACT</p>
                <h2>推演结果</h2>
              </div>
              <Badge variant={simulation.impact.exactDelta > 1e-9 ? "default" : "muted"}>
                <TrendingUp size={12} />{" "}
                {isMulti ? `联合 ${queue.length} 首 · ` : ""}
                {simulation.impact.exactDelta > 1e-9 ? "PTT 提升" : "B50 无提升"}
              </Badge>
            </div>

            <div className="what-if-summary-grid">
              <div className="what-if-stat-card">
                <span>推演前 B50</span>
                <strong>{simulation.before.displayPotential.toFixed(3)}</strong>
                <small>{simulation.before.exactPotential.toFixed(6)}</small>
              </div>
              <div className="what-if-stat-card highlight">
                <span>推演后 B50</span>
                <strong>{simulation.after.displayPotential.toFixed(3)}</strong>
                <small>{simulation.after.exactPotential.toFixed(6)}</small>
              </div>
              <div className={`what-if-stat-card delta-${displayDeltaClass}`}>
                <span>B50 变化</span>
                <strong>
                  {simulation.impact.displayDelta > 0 ? "+" : ""}
                  {simulation.impact.displayDelta.toFixed(3)}
                </strong>
                <small className={`delta-sub-${deltaClass}`}>
                  精确 {simulation.impact.exactDelta > 0 ? "+" : ""}
                  {simulation.impact.exactDelta.toFixed(6)}
                </small>
              </div>
              {isMulti ? (
                <div className="what-if-stat-card">
                  <span>联合模拟概况</span>
                  <strong>
                    {simulation.impact.enteredCount + simulation.impact.improvedCount} / {queue.length} 有效
                  </strong>
                  <small>
                    新进 {simulation.impact.enteredCount} · 刷新 {simulation.impact.improvedCount} · 最高{" "}
                    {maxSimulatedRating.toFixed(3)}
                  </small>
                </div>
              ) : (
                <div className="what-if-stat-card">
                  <span>假设单曲 PTT</span>
                  <strong>{activePlayResult.play.rating.toFixed(3)}</strong>
                  <small>
                    定数 {activePlayResult.play.constant.toFixed(1)} ·{" "}
                    {activePlayResult.existing
                      ? `较原成绩 ${activePlayResult.existing.deltaRating >= 0 ? "+" : ""}${activePlayResult.existing.deltaRating.toFixed(3)}`
                      : sortedB50.length >= 50
                        ? `较 #50 ${activePlayResult.play.rating - floorRating >= 0 ? "+" : ""}${(activePlayResult.play.rating - floorRating).toFixed(3)}`
                        : "新入榜"}
                  </small>
                </div>
              )}
            </div>

            <div className={`what-if-impact-banner status-${bannerStatus}`} role="status">
              {isMulti ? (
                <MultiImpactMessage
                  simulation={simulation}
                  queue={queue}
                  activeUid={activeSlot.uid}
                  onFocusSlot={setActiveUid}
                />
              ) : (
                <ImpactMessage playResult={activePlayResult} simulation={simulation} />
              )}
            </div>

            <div className="formula-strip what-if-formula">
              <span>
                <strong>TOP 10</strong> × 2: {simulation.before.top10Sum.toFixed(3)} <ArrowRight size={12} />{" "}
                <strong>{simulation.after.top10Sum.toFixed(3)}</strong>
              </span>
              <i />
              <span>
                <strong>REST 40</strong>: {simulation.before.rest40Sum.toFixed(3)} <ArrowRight size={12} />{" "}
                <strong>{simulation.after.rest40Sum.toFixed(3)}</strong>
              </span>
              <span className="formula-result">
                TOTAL / 60 = <strong>{simulation.after.exactPotential.toFixed(6)}</strong>
              </span>
            </div>

            <div className="what-if-table-block">
              <div className="what-if-table-header">
                <h3>推演后 B50 列表</h3>
                <div className="what-if-scope-tabs" role="tablist" aria-label="列表显示范围">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={tableView === "affected"}
                    className={tableView === "affected" ? "active" : ""}
                    onClick={() => setTableView("affected")}
                  >
                    变动附近
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={tableView === "all"}
                    className={tableView === "all" ? "active" : ""}
                    onClick={() => setTableView("all")}
                  >
                    全部 ({simulation.after.best50.length})
                  </button>
                </div>
              </div>

              {simulation.after.best50.length ? (
                <div className="what-if-b50-list">
                  {visibleRows.map((entry, idx) => {
                    const prev = visibleRows[idx - 1];
                    const showGap = Boolean(prev && entry.rank - prev.rank > 1);
                    const showTop10Divider = entry.rank > 10 && (!prev || prev.rank <= 10);
                    const entryTitle = entry.title.zh || entry.title.en || entry.title.ja || entry.songId;
                    const simTag =
                      entry.isSimulated && entry.simulatedIndex !== null
                        ? isMulti
                          ? `模拟 S${entry.simulatedIndex + 1}`
                          : "模拟"
                        : null;
                    return (
                      <React.Fragment key={`${entry.songId}-${entry.difficulty}`}>
                        {showGap && prev ? (
                          <div className="what-if-b50-gap">
                            <span>
                              … 省略 #{prev.rank + 1}
                              {entry.rank - 1 > prev.rank + 1 ? ` – #${entry.rank - 1}` : ""} …
                            </span>
                          </div>
                        ) : null}
                        {showTop10Divider ? (
                          <div className="what-if-top10-divider">
                            <span>TOP 10 (×2 权重) / REST 40 (×1 权重)</span>
                          </div>
                        ) : null}
                        <div className={`what-if-b50-row${entry.isSimulated ? " is-simulated" : ""}`}>
                          <span className="what-if-row-rank">#{String(entry.rank).padStart(2, "0")}</span>
                          <span className={`what-if-row-diff difficulty-${difficultyTone(entry.difficulty, entry.difficultyAlias)}`}>
                            {difficultyCode(entry.difficulty, entry.difficultyAlias)}
                          </span>
                          <div className="what-if-row-title">
                            <strong title={entryTitle}>
                              <span className="what-if-row-title-text">{entryTitle}</span>
                              {simTag ? <span className="what-if-sim-tag">{simTag}</span> : null}
                            </strong>
                            <small>
                              定数 {entry.effectiveConstant !== null ? entry.effectiveConstant.toFixed(1) : "—"} ·{" "}
                              {formatScore(entry.score)} · {clearTypeCode(entry.clearType)}
                            </small>
                          </div>
                          <div className="what-if-row-right">
                            <strong>{entry.rating.toFixed(3)}</strong>
                            {entry.previousRank === null ? (
                              <span className="what-if-rank-delta is-new">NEW</span>
                            ) : entry.rankDelta !== null && entry.rankDelta > 0 ? (
                              <span className="what-if-rank-delta is-up">↑{entry.rankDelta}</span>
                            ) : entry.rankDelta !== null && entry.rankDelta < 0 ? (
                              <span className="what-if-rank-delta is-down">↓{Math.abs(entry.rankDelta)}</span>
                            ) : (
                              <span className="what-if-rank-delta is-flat">—</span>
                            )}
                          </div>
                        </div>
                      </React.Fragment>
                    );
                  })}

                  {simulation.after.displaced.map((displacedItem) => (
                    <div
                      key={`${displacedItem.songId}-${displacedItem.difficulty}`}
                      className="what-if-displaced-row"
                    >
                      <span>被挤出 #{displacedItem.previousRank}：</span>
                      <strong>
                        {displacedItem.title.zh ||
                          displacedItem.title.en ||
                          displacedItem.title.ja ||
                          displacedItem.songId}
                      </strong>
                      <small>
                        {difficultyCode(displacedItem.difficulty, displacedItem.difficultyAlias)} ·{" "}
                        {displacedItem.rating.toFixed(3)} PTT
                      </small>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="what-if-song-empty">当前尚无 B50 条目；输入高于 0 的单曲 PTT 后将自动生成模拟榜。</div>
              )}
            </div>
          </div>
        </section>

        <footer className="footer">
          <span>ArcOnline Extension</span>
        </footer>
      </div>
    </main>
  );
}

function ImpactMessage({
  playResult,
  simulation,
}: {
  playResult: WhatIfMultiPlayResult;
  simulation: WhatIfMultiSimulationResult;
}) {
  const { existing, play, status, newRank, ratingGapToChangeB50 } = playResult;
  const { after, before } = simulation;
  const displacedFirst = after.displaced[0] ?? null;
  if (status === "entered_b50") {
    const displacedTitle = displacedFirst
      ? displacedFirst.title.zh || displacedFirst.title.en || displacedFirst.title.ja || displacedFirst.songId
      : null;
    return (
      <span>
        该成绩可进入 B50 第 <strong>#{newRank}</strong> 名
        {newRank && newRank <= 10 ? "（进入 Top 10 双倍权重区）" : ""}
        {displacedTitle && displacedFirst
          ? `，挤出原 #${displacedFirst.previousRank}「${displacedTitle}」(${displacedFirst.rating.toFixed(3)})`
          : ""}
        。
      </span>
    );
  }
  if (status === "improved" && existing) {
    return (
      <span>
        刷新该曲 B50 成绩（{formatScore(existing.score)} → {formatScore(play.score)}），排名从{" "}
        <strong>#{existing.rank}</strong>
        {newRank && newRank !== existing.rank ? (
          <>
            {" "}升至 <strong>#{newRank}</strong>（↑{existing.rank - newRank}）
          </>
        ) : (
          " 保持不变"
        )}
        ，单曲 PTT +{existing.deltaRating.toFixed(3)}。
      </span>
    );
  }
  if (status === "unchanged_below_pb" && existing) {
    return (
      <span>
        假设单曲 PTT（{play.rating.toFixed(3)}）低于该谱面当前 B50 成绩（#{existing.rank}，
        {formatScore(existing.score)} / {existing.rating.toFixed(3)}），按 B50 仅计最高分规则不会替换。
      </span>
    );
  }
  if (status === "unchanged_equal") {
    return <span>假设单曲 PTT 与当前 B50 成绩持平，B50 排名与总值均无变化。</span>;
  }
  return (
    <span>
      假设单曲 PTT（{play.rating.toFixed(3)}）未超过当前 B50 守门线 #50（{before.floorRating.toFixed(3)}），还差{" "}
      <strong>{ratingGapToChangeB50.toFixed(3)}</strong> PTT 才能进榜。
    </span>
  );
}

function MultiImpactMessage({
  simulation,
  queue,
  activeUid,
  onFocusSlot,
}: {
  simulation: WhatIfMultiSimulationResult;
  queue: ReadonlyArray<QueuedChart>;
  activeUid: string;
  onFocusSlot: (uid: string) => void;
}) {
  const { impact } = simulation;
  return (
    <div className="what-if-multi-impact">
      <span>
        联合推演 <strong>{queue.length}</strong> 首：<strong>{impact.enteredCount}</strong> 首新入榜、
        <strong>{impact.improvedCount}</strong> 首刷新原成绩
        {impact.unchangedCount > 0 ? `、${impact.unchangedCount} 首未变化` : ""}
        {impact.displacedCount > 0 ? `，共挤出 ${impact.displacedCount} 首原 B50 曲目` : ""}。
      </span>
      <div className="what-if-impact-chips">
        {simulation.plays.map((item, idx) => {
          const slot = queue[idx];
          if (!slot) return null;
          const isCurrent = slot.uid === activeUid;
          const outcome =
            item.status === "entered_b50" && item.newRank
              ? `新 #${item.newRank}`
              : item.status === "improved" && item.newRank
                ? `升 #${item.newRank}`
                : "未变动";
          return (
            <button
              key={slot.uid}
              type="button"
              className={`what-if-impact-chip status-${item.status}${isCurrent ? " active" : ""}`}
              onClick={() => onFocusSlot(slot.uid)}
            >
              <span>S{idx + 1}</span>
              <strong>{item.play.title}</strong>
              <em>{outcome}</em>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function MilestoneButton({
  label,
  farCount,
  score,
  alreadyDone = false,
  onSelect,
}: {
  label: string;
  farCount: number | null;
  score: number | null;
  alreadyDone?: boolean;
  onSelect: (farCount: number) => void;
}) {
  if (alreadyDone) {
    return (
      <div className="what-if-milestone-card is-done">
        <span>{label}</span>
        <strong>已达成</strong>
      </div>
    );
  }
  if (score === null || farCount === null) {
    return (
      <div className="what-if-milestone-card is-impossible">
        <span>{label}</span>
        <strong>理论值仍不足</strong>
      </div>
    );
  }
  return (
    <button type="button" className="what-if-milestone-card" onClick={() => onSelect(farCount)}>
      <span>{label}</span>
      <strong>{formatScore(score)}</strong>
      <small>FAR {farCount} · 点击填入</small>
    </button>
  );
}
