"use client";

import * as React from "react";
import {
  ArrowRight,
  Calculator,
  Loader2,
  Search,
  Target,
  TrendingUp,
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
  maxPureScoreFromFar,
  parseFarInput,
  simulateWhatIf,
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
  const [selectedSongId, setSelectedSongId] = React.useState(defaultSong.id);
  const [selectedDifficulty, setSelectedDifficulty] = React.useState(defaultDifficulty);
  const [farInput, setFarInput] = React.useState("0");
  const [clearType, setClearType] = React.useState(1);
  const [tableView, setTableView] = React.useState<B50TableView>("affected");

  const [pbLookupState, setPbLookupState] = React.useState<"idle" | "loading" | "done" | "error">("idle");
  const [pbScore, setPbScore] = React.useState<SongScore | null>(null);
  const [pbError, setPbError] = React.useState<string | null>(null);
  const pbAbortRef = React.useRef<AbortController | null>(null);

  React.useEffect(() => {
    return () => {
      delete document.documentElement.dataset.whatIfSelectOpen;
    };
  }, []);

  const selectedSong = React.useMemo(
    () => getSongById(selectedSongId) ?? defaultSong,
    [selectedSongId, defaultSong],
  );
  const activeDifficulty = React.useMemo(() => {
    const matched = getCatalogDifficulty(selectedSong, selectedDifficulty);
    if (matched) return matched.difficulty;
    return (
      selectedSong.difficulties.find((item) => item.difficulty === 2)?.difficulty ??
      selectedSong.difficulties[selectedSong.difficulties.length - 1]?.difficulty ??
      2
    );
  }, [selectedSong, selectedDifficulty]);
  const noteCount = React.useMemo(
    () => chartNoteCount(selectedSong.id, activeDifficulty),
    [selectedSong.id, activeDifficulty],
  );
  const parsedFar = React.useMemo(
    () => parseFarInput(farInput, noteCount),
    [farInput, noteCount],
  );
  const effectiveScore =
    noteCount !== null && parsedFar !== null ? maxPureScoreFromFar(noteCount, parsedFar) : 0;

  const simulation = React.useMemo(
    () =>
      simulateWhatIf({
        best50: sortedB50,
        songId: selectedSong.id,
        difficulty: activeDifficulty,
        score: effectiveScore,
        clearType,
      }),
    [sortedB50, selectedSong.id, activeDifficulty, effectiveScore, clearType],
  );

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

  const resetLookup = React.useCallback(() => {
    pbAbortRef.current?.abort();
    pbAbortRef.current = null;
    setPbLookupState("idle");
    setPbScore(null);
    setPbError(null);
  }, []);

  function selectSong(song: CatalogSong) {
    resetLookup();
    setSelectedSongId(song.id);
    setFarInput("0");
    const b50Match = sortedB50.find((entry) => entry.songId === song.id);
    const nextDiff =
      b50Match?.difficulty ??
      song.difficulties.find((item) => item.difficulty === 2)?.difficulty ??
      song.difficulties[song.difficulties.length - 1]?.difficulty ??
      2;
    setSelectedDifficulty(nextDiff);
  }

  function selectDifficulty(difficulty: number) {
    resetLookup();
    setSelectedDifficulty(difficulty);
    setFarInput("0");
  }

  function applyTargetScore(targetScore: number, nextClearType?: number) {
    if (noteCount === null) return;
    const farCount = farCountForMaxPureScore(noteCount, targetScore);
    if (farCount === null) return;
    setFarInput(String(farCount));
    if (nextClearType !== undefined) {
      setClearType(nextClearType);
    } else if (maxPureScoreFromFar(noteCount, farCount) >= 10_000_000 && clearType === 0) {
      setClearType(3);
    }
  }

  function applyFarValue(farCount: number) {
    setFarInput(String(farCount));
  }

  async function lookupOfficialScore() {
    pbAbortRef.current?.abort();
    const controller = new AbortController();
    pbAbortRef.current = controller;
    setPbLookupState("loading");
    setPbScore(null);
    setPbError(null);
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
      setPbScore(matched ?? null);
      setPbLookupState("done");
    } catch (caught) {
      if (!controller.signal.aborted) {
        setPbError(caught instanceof Error ? caught.message : "查询失败，请稍后重试。");
        setPbLookupState("error");
      }
    }
  }

  React.useEffect(() => () => pbAbortRef.current?.abort(), []);

  const beforeExact = exactWeightedPotential(sortedB50);
  const beforeDisplay = formatPotential(beforeExact);
  const floorRating = sortedB50.length >= 50 ? sortedB50[49].rating : 0;
  const top10FloorRating = sortedB50.length >= 10 ? sortedB50[9].rating : 0;

  const visibleRows = React.useMemo(() => {
    const rows = simulation.after.best50;
    if (tableView === "all" || rows.length <= 15) return rows;
    const simIdx = rows.findIndex((entry) => entry.isSimulated);
    if (simIdx < 0) {
      return rows.slice(0, 10);
    }
    const start = Math.max(0, simIdx - 4);
    const end = Math.min(rows.length, simIdx + 5);
    return rows.slice(start, end);
  }, [simulation.after.best50, tableView]);

  const activeTitle = displaySongTitle(selectedSong, activeDifficulty);
  const activeArtist = displaySongArtist(selectedSong, activeDifficulty);
  const deltaClass =
    simulation.impact.exactDelta > 1e-9 ? "up" : simulation.impact.exactDelta < -1e-9 ? "down" : "flat";
  const displayDeltaClass =
    simulation.impact.displayDelta > 0 ? "up" : simulation.impact.displayDelta < 0 ? "down" : "flat";
  const milestoneScores = React.useMemo(() => {
    const representable = (targetScore: number | null) => {
      if (noteCount === null || targetScore === null) return null;
      const farCount = farCountForMaxPureScore(noteCount, targetScore, "atLeast");
      if (farCount === null) return null;
      return { farCount, score: maxPureScoreFromFar(noteCount, farCount) };
    };
    return {
      changeB50: representable(simulation.impact.minScoreToChangeB50),
      gainDisplayPtt: representable(simulation.impact.minScoreToGainDisplayPtt),
      enterTop10: representable(simulation.impact.minScoreToEnterTop10),
    };
  }, [
    noteCount,
    simulation.impact.minScoreToChangeB50,
    simulation.impact.minScoreToEnterTop10,
    simulation.impact.minScoreToGainDisplayPtt,
  ]);

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
              测试 如果 y <span>/ SINGLE-CHART B50 SIMULATION</span>
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
                <h2>选曲与 FAR 条件</h2>
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

            <div className="what-if-song-list" role="listbox" aria-label="匹配曲目">
              {searchResults.length ? (
                searchResults.map((song) => {
                  const isSelected = song.id === selectedSong.id;
                  const inB50 = b50SongIds.has(song.id);
                  return (
                    <button
                      key={song.id}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      className={`what-if-song-option${isSelected ? " active" : ""}`}
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
                            className={`what-if-diff-pill difficulty-${difficultyTone(diff.difficulty, diff.alias)}`}
                          >
                            {difficultyCode(diff.difficulty, diff.alias)} {formatDifficultyLevel(diff)}
                          </span>
                        ))}
                      </div>
                    </button>
                  );
                })
              ) : (
                <div className="what-if-song-empty">没有匹配的曲目，可尝试输入英文原名、日文假名或歌曲 ID。</div>
              )}
            </div>

            <div className="what-if-selected-chart">
              <div className="what-if-selected-meta">
                <span className="score-label">SELECTED TRACK</span>
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
                  return (
                    <button
                      key={diff.difficulty}
                      type="button"
                      aria-pressed={active}
                      className={`what-if-diff-button difficulty-${difficultyTone(diff.difficulty, diff.alias)}${active ? " active" : ""}`}
                      onClick={() => selectDifficulty(diff.difficulty)}
                    >
                      <span className="what-if-diff-code">
                        {difficultyCode(diff.difficulty, diff.alias)} {formatDifficultyLevel(diff)}
                      </span>
                      <strong>{constant !== null ? constant.toFixed(1) : "—"}</strong>
                      {b50Match ? <small>#{b50Match.rank}</small> : null}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="what-if-current-pb">
              {simulation.existing ? (
                <div className="what-if-pb-row">
                  <div>
                    <span className="score-label">CURRENT B50 ENTRY</span>
                    <strong>
                      #{simulation.existing.rank} · {formatScore(simulation.existing.score)}{" "}
                      <em>{clearTypeCode(simulation.existing.clearType)}</em>
                    </strong>
                    <small>
                      当前单曲 PTT {simulation.existing.rating.toFixed(6)}
                      {simulation.existing.foldedFarCount !== null ? (
                        <>
                          {" "}· 折合 FAR {simulation.existing.foldedFarCount}（
                          {simulation.existing.nearCount} FAR + {simulation.existing.missCount} LOST）
                        </>
                      ) : null}
                    </small>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => applyTargetScore(simulation.existing!.score, simulation.existing!.clearType)}
                  >
                    填入对应 FAR
                  </Button>
                </div>
              ) : (
                <div className="what-if-pb-row">
                  <div>
                    <span className="score-label">CURRENT PERSONAL BEST</span>
                    {pbLookupState === "done" ? (
                      pbScore ? (
                        <>
                          <strong>
                            {formatScore(pbScore.score)} <em>{clearTypeCode(pbScore.clearType)}</em>
                          </strong>
                          <small>
                            单曲 PTT{" "}
                            {simulation.play.constant
                              ? (
                                  Math.max(
                                    0,
                                    simulation.play.constant +
                                      (pbScore.score >= 10_000_000
                                        ? 2
                                        : pbScore.score >= 9_800_000
                                          ? 1 + (pbScore.score - 9_800_000) / 200_000
                                          : (pbScore.score - 9_500_000) / 300_000) +
                                      (pbScore.clearType > 0 ? 0.2 : 0),
                                  )
                                ).toFixed(3)
                              : "—"}
                            {" · "}尚未进入 B50
                          </small>
                        </>
                      ) : (
                        <strong>官网暂无该谱面成绩</strong>
                      )
                    ) : pbLookupState === "error" ? (
                      <strong className="what-if-pb-error">{pbError}</strong>
                    ) : (
                      <strong>当前未进入 B50</strong>
                    )}
                  </div>
                  <div className="what-if-pb-actions">
                    {pbScore ? (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => applyTargetScore(pbScore.score, pbScore.clearType)}
                      >
                        填入对应 FAR
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={lookupOfficialScore}
                      disabled={pbLookupState === "loading"}
                    >
                      {pbLookupState === "loading" ? <Loader2 size={13} className="spin" /> : <Search size={13} />}
                      {pbLookupState === "loading" ? "查询中…" : "查官网成绩"}
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
                  value={farInput}
                  onChange={(event) => setFarInput(event.target.value)}
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
                  value={String(clearType)}
                  onValueChange={(value) => setClearType(Number(value))}
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
                    ? `单曲 PTT ${simulation.play.rating.toFixed(6)} · 定数 ${simulation.play.constant.toFixed(1)}`
                    : null}
                </small>
              </label>
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
              <div className="what-if-stat-card">
                <span>假设单曲 PTT</span>
                <strong>{simulation.play.rating.toFixed(3)}</strong>
                <small>
                  定数 {simulation.play.constant.toFixed(1)} ·{" "}
                  {simulation.existing
                    ? `较原成绩 ${simulation.existing.deltaRating >= 0 ? "+" : ""}${simulation.existing.deltaRating.toFixed(3)}`
                    : sortedB50.length >= 50
                      ? `较 #50 ${simulation.play.rating - floorRating >= 0 ? "+" : ""}${(simulation.play.rating - floorRating).toFixed(3)}`
                      : "新入榜"}
                </small>
              </div>
            </div>

            <div className={`what-if-impact-banner status-${simulation.impact.status}`} role="status">
              <ImpactMessage simulation={simulation} />
            </div>

            <div className="what-if-milestones" aria-label="目标分数参考">
              <div className="what-if-milestone-header">
                <Target size={14} />
                <span>目标分数线（按当前定数 {simulation.play.constant.toFixed(1)} &amp; {clearTypeCode(simulation.play.clearType)}）</span>
              </div>
              <div className="what-if-milestone-grid">
                <MilestoneButton
                  label={simulation.existing ? "刷新当前成绩" : "进入 B50 (#50)"}
                  farCount={milestoneScores.changeB50?.farCount ?? null}
                  score={milestoneScores.changeB50?.score ?? null}
                  onSelect={applyFarValue}
                />
                <MilestoneButton
                  label={`显示 PTT +0.001 (${((Math.floor(simulation.before.exactPotential * 1000) + 1) / 1000).toFixed(3)})`}
                  farCount={milestoneScores.gainDisplayPtt?.farCount ?? null}
                  score={milestoneScores.gainDisplayPtt?.score ?? null}
                  onSelect={applyFarValue}
                />
                <MilestoneButton
                  label={simulation.impact.previousRank && simulation.impact.previousRank <= 10 ? "已在 Top 10" : "进入 Top 10 (#10)"}
                  farCount={milestoneScores.enterTop10?.farCount ?? null}
                  score={milestoneScores.enterTop10?.score ?? null}
                  alreadyDone={Boolean(simulation.impact.previousRank && simulation.impact.previousRank <= 10)}
                  onSelect={applyFarValue}
                />
              </div>
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
                    const showTop10Divider = entry.rank > 10 && (!prev || prev.rank <= 10);
                    const entryTitle = entry.title.zh || entry.title.en || entry.title.ja || entry.songId;
                    return (
                      <React.Fragment key={`${entry.songId}-${entry.difficulty}`}>
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
                              {entry.isSimulated ? <span className="what-if-sim-tag">模拟</span> : null}
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

                  {simulation.after.displaced ? (
                    <div className="what-if-displaced-row">
                      <span>被挤出 #50：</span>
                      <strong>
                        {simulation.after.displaced.title.zh ||
                          simulation.after.displaced.title.en ||
                          simulation.after.displaced.title.ja ||
                          simulation.after.displaced.songId}
                      </strong>
                      <small>
                        {difficultyCode(simulation.after.displaced.difficulty, simulation.after.displaced.difficultyAlias)} ·{" "}
                        {simulation.after.displaced.rating.toFixed(3)} PTT
                      </small>
                    </div>
                  ) : null}
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

function ImpactMessage({ simulation }: { simulation: ReturnType<typeof simulateWhatIf> }) {
  const { impact, existing, after, before, play } = simulation;
  if (impact.status === "entered_b50") {
    const displacedTitle = after.displaced
      ? after.displaced.title.zh || after.displaced.title.en || after.displaced.title.ja || after.displaced.songId
      : null;
    return (
      <span>
        该成绩可进入 B50 第 <strong>#{impact.newRank}</strong> 名
        {impact.newRank && impact.newRank <= 10 ? "（进入 Top 10 双倍权重区）" : ""}
        {displacedTitle ? `，挤出原 #50「${displacedTitle}」(${after.displaced!.rating.toFixed(3)})` : ""}。
      </span>
    );
  }
  if (impact.status === "improved" && existing) {
    return (
      <span>
        刷新该曲 B50 成绩（{formatScore(existing.score)} → {formatScore(play.score)}），排名从{" "}
        <strong>#{existing.rank}</strong>
        {impact.newRank && impact.newRank !== existing.rank ? (
          <>
            {" "}升至 <strong>#{impact.newRank}</strong>（↑{existing.rank - impact.newRank}）
          </>
        ) : (
          " 保持不变"
        )}
        ，单曲 PTT +{existing.deltaRating.toFixed(3)}。
      </span>
    );
  }
  if (impact.status === "unchanged_below_pb" && existing) {
    return (
      <span>
        假设单曲 PTT（{play.rating.toFixed(3)}）低于该谱面当前 B50 成绩（#{existing.rank}，
        {formatScore(existing.score)} / {existing.rating.toFixed(3)}），按 B50 仅计最高分规则不会替换。
      </span>
    );
  }
  if (impact.status === "unchanged_equal") {
    return <span>假设单曲 PTT 与当前 B50 成绩持平，B50 排名与总值均无变化。</span>;
  }
  return (
    <span>
      假设单曲 PTT（{play.rating.toFixed(3)}）未超过当前 B50 守门线 #50（{before.floorRating.toFixed(3)}），还差{" "}
      <strong>{impact.ratingGapToChangeB50.toFixed(3)}</strong> PTT 才能进榜。
    </span>
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
