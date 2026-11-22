"use client";

import * as React from "react";
import {
  Archive,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Database,
  GitCompareArrows,
  History as HistoryIcon,
  LayoutGrid,
  List,
  RotateCw,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { AppNavigation } from "@/components/app-navigation";
import { HistoryCompare } from "@/components/history-compare";
import { ScoreCard } from "@/components/score-card";
import { GradientScrollArea } from "@/components/ui/gradient-scroll-area";
import { Select } from "@/components/ui/select";
import {
  beijingDateParts,
  buildHistoryUrlSearch,
  computeSnapshotStats,
  deltaAgainst,
  filterAndSortHistoryScores,
  filterTimelineSnapshots,
  parseHistoryUrlState,
  summarizeSnapshotDiff,
  type HistoryDiffRow,
  type HistoryScoreGroup,
  type HistoryScoreSort,
} from "@/lib/history-view";
import { cacheSnapshot, cachedSnapshot, loadSnapshot } from "@/lib/snapshot-cache";
import type { B50Snapshot, HistoryPayload } from "@/lib/types";
import {
  clearTypeCode,
  clearTypeLabel,
  difficultyCode,
  difficultyTone,
  formatRelativeDate,
  formatScore,
  shinyPureCount,
} from "@/lib/utils";

const SORT_OPTIONS = [
  { value: "rank", label: "默认排名 (#1–#50)" },
  { value: "score", label: "按分数高到低" },
  { value: "constant", label: "按定数高到低" },
  { value: "playedAt", label: "按游玩时间" },
] as const;

function deltaClass(delta: number) {
  return delta > 0 ? "up" : delta < 0 ? "down" : "flat";
}

function formatDelta(delta: number) {
  return `${delta > 0 ? "+" : ""}${delta.toFixed(3)}`;
}

function scoreGrade(score: number) {
  if (score >= 10_000_000) return "PM";
  if (score >= 9_900_000) return "EX+";
  if (score >= 9_800_000) return "EX";
  if (score >= 9_500_000) return "AA";
  if (score >= 9_000_000) return "A";
  return "B";
}

function formatDiffBadge(diff: HistoryDiffRow): string {
  if (diff.kind === "added") return "NEW · 新入榜";
  const parts: string[] = [];
  if (diff.rankDelta !== null && diff.rankDelta !== 0) {
    parts.push(diff.rankDelta > 0 ? `↑${diff.rankDelta}` : `↓${Math.abs(diff.rankDelta)}`);
  }
  if (diff.ratingDelta !== null && diff.ratingDelta !== 0) {
    parts.push(`${diff.ratingDelta > 0 ? "+" : ""}${diff.ratingDelta.toFixed(3)} PTT`);
  } else if (diff.scoreDelta !== null && diff.scoreDelta !== 0) {
    parts.push(`${diff.scoreDelta > 0 ? "+" : ""}${diff.scoreDelta.toLocaleString("en-US")}`);
  }
  return parts.length ? parts.join(" · ") : "状态更新";
}

export function HistoryShell({ initialData }: { initialData: HistoryPayload }) {
  const snapshots = initialData.snapshots;
  const latestId = snapshots[0]?.id || "";

  const [comparing, setComparing] = React.useState(false);
  const [compareBeforeId, setCompareBeforeId] = React.useState<string | undefined>(undefined);
  const [compareAfterId, setCompareAfterId] = React.useState<string | undefined>(undefined);
  const [selectedId, setSelectedId] = React.useState(latestId);
  const [detail, setDetail] = React.useState<B50Snapshot | null>(initialData.detail);
  const [detailState, setDetailState] = React.useState<"ready" | "loading" | "error">("ready");
  const [prevDetail, setPrevDetail] = React.useState<B50Snapshot | null>(null);
  const [retryToken, setRetryToken] = React.useState(0);

  const [changedOnly, setChangedOnly] = React.useState(false);
  const [archiveOpen, setArchiveOpen] = React.useState(false);
  const [archiveMonth, setArchiveMonth] = React.useState("all");

  const [scoreGroup, setScoreGroup] = React.useState<HistoryScoreGroup>("all");
  const [searchQuery, setSearchQuery] = React.useState("");
  const [scoreSort, setScoreSort] = React.useState<HistoryScoreSort>("rank");
  const [viewMode, setViewMode] = React.useState<"cards" | "table">("cards");
  const [highlightedKey, setHighlightedKey] = React.useState<string | null>(null);

  const urlReadyRef = React.useRef(false);
  const railRef = React.useRef<HTMLDivElement | null>(null);
  const railProgressRef = React.useRef<HTMLDivElement | null>(null);
  const [railScrollable, setRailScrollable] = React.useState(false);

  // Hydrate cache and restore URL state safely on mount.
  React.useEffect(() => {
    if (initialData.detail) cacheSnapshot(initialData.detail);
    const urlState = parseHistoryUrlState(window.location.search, snapshots);
    if (urlState.view === "compare") {
      setComparing(true);
      setCompareBeforeId(urlState.beforeId);
      setCompareAfterId(urlState.afterId);
    } else if (urlState.snapshotId && urlState.snapshotId !== selectedId) {
      setSelectedId(urlState.snapshotId);
    }
    urlReadyRef.current = true;
  }, []);

  // Sync URL query parameters without mutating browser history entries.
  React.useEffect(() => {
    if (!urlReadyRef.current) return;
    const search = buildHistoryUrlSearch({
      view: comparing ? "compare" : "detail",
      snapshotId: selectedId,
      beforeId: compareBeforeId,
      afterId: compareAfterId,
      defaultSnapshotId: latestId,
    });
    const nextUrl = `${window.location.pathname}${search}`;
    if (`${window.location.pathname}${window.location.search}` !== nextUrl) {
      window.history.replaceState(null, "", nextUrl);
    }
  }, [comparing, selectedId, compareBeforeId, compareAfterId, latestId]);

  // Fetch selected snapshot (keeping previous detail visible during loading).
  React.useEffect(() => {
    if (!selectedId) return;
    const cached = cachedSnapshot(selectedId);
    if (cached) {
      setDetail(cached);
      setDetailState("ready");
      return;
    }
    let active = true;
    setDetailState("loading");
    loadSnapshot(selectedId)
      .then((snapshot) => {
        if (!active) return;
        setDetail(snapshot);
        setDetailState("ready");
      })
      .catch(() => {
        if (active) setDetailState("error");
      });
    return () => {
      active = false;
    };
  }, [selectedId, retryToken]);

  const activeSnapshot = detail;
  const activeSnapshotId = activeSnapshot?.id || selectedId;
  const activeIndex = React.useMemo(
    () => snapshots.findIndex((summary) => summary.id === activeSnapshotId),
    [snapshots, activeSnapshotId],
  );
  const prevSummary = activeIndex >= 0 ? snapshots[activeIndex + 1] : undefined;

  // Background-fetch the previous snapshot for automatic "vs previous" diffing.
  React.useEffect(() => {
    if (!prevSummary) {
      setPrevDetail(null);
      return;
    }
    const cached = cachedSnapshot(prevSummary.id);
    if (cached) {
      setPrevDetail(cached);
      return;
    }
    let active = true;
    loadSnapshot(prevSummary.id)
      .then((snapshot) => {
        if (active) setPrevDetail(snapshot);
      })
      .catch(() => {
        if (active) setPrevDetail(null);
      });
    return () => {
      active = false;
    };
  }, [prevSummary?.id]);

  // Timeline filtering & archive drawer filtering.
  const timeline = React.useMemo(
    () =>
      filterTimelineSnapshots(snapshots, {
        changedOnly,
        month: "all",
        selectedId,
      }),
    [snapshots, changedOnly, selectedId],
  );

  const archiveGrid = React.useMemo(
    () =>
      filterTimelineSnapshots(snapshots, {
        changedOnly: false,
        month: archiveMonth,
        selectedId,
      }),
    [snapshots, archiveMonth, selectedId],
  );

  const selectedIndex = React.useMemo(
    () => snapshots.findIndex((summary) => summary.id === selectedId),
    [snapshots, selectedId],
  );

  const stepList = React.useMemo(() => {
    if (timeline.items.some((item) => item.snapshot.id === selectedId)) {
      return timeline.items.map((item) => item.snapshot);
    }
    return snapshots;
  }, [timeline.items, snapshots, selectedId]);

  const stepIndex = React.useMemo(
    () => stepList.findIndex((item) => item.id === selectedId),
    [stepList, selectedId],
  );

  const selectSnapshot = React.useCallback((id: string) => {
    setSelectedId(id);
    setHighlightedKey(null);
  }, []);

  const stepNewer = React.useCallback(() => {
    if (stepIndex > 0) selectSnapshot(stepList[stepIndex - 1].id);
  }, [stepIndex, stepList, selectSnapshot]);

  const stepOlder = React.useCallback(() => {
    if (stepIndex >= 0 && stepIndex + 1 < stepList.length) {
      selectSnapshot(stepList[stepIndex + 1].id);
    }
  }, [stepIndex, stepList, selectSnapshot]);

  // Keyboard ArrowLeft / ArrowRight navigation across snapshots.
  React.useEffect(() => {
    if (comparing || snapshots.length <= 1) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const activeEl = document.activeElement as HTMLElement | null;
      if (
        activeEl?.closest(
          'input, textarea, select, [contenteditable="true"], [role="combobox"], [role="listbox"], [role="dialog"]',
        )
      ) {
        return;
      }
      if (event.key === "ArrowLeft") {
        if (stepIndex > 0) {
          event.preventDefault();
          stepNewer();
        }
      } else if (event.key === "ArrowRight") {
        if (stepIndex >= 0 && stepIndex + 1 < stepList.length) {
          event.preventDefault();
          stepOlder();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [comparing, snapshots.length, stepIndex, stepList.length, stepNewer, stepOlder]);

  // Sync horizontal timeline rail progress bar & wheel-to-horizontal scroll.
  React.useEffect(() => {
    const rail = railRef.current;
    if (!rail || comparing) return;

    const syncProgress = () => {
      const maxScroll = Math.max(0, rail.scrollWidth - rail.clientWidth);
      const isScrollable = maxScroll > 2;
      setRailScrollable(isScrollable);
      const fill = railProgressRef.current;
      if (fill) {
        const minRatio = 0.12;
        const fraction = isScrollable ? minRatio + (1 - minRatio) * (rail.scrollLeft / maxScroll) : 0;
        fill.style.transform = `scaleX(${fraction.toFixed(4)})`;
      }
    };

    const onWheel = (event: WheelEvent) => {
      if (rail.scrollWidth <= rail.clientWidth + 2) return;
      if (Math.abs(event.deltaY) > Math.abs(event.deltaX) && event.deltaY !== 0) {
        event.preventDefault();
        rail.scrollLeft += event.deltaY;
      }
    };

    syncProgress();
    rail.addEventListener("scroll", syncProgress, { passive: true });
    rail.addEventListener("wheel", onWheel, { passive: false });
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(syncProgress) : null;
    observer?.observe(rail);

    return () => {
      rail.removeEventListener("scroll", syncProgress);
      rail.removeEventListener("wheel", onWheel);
      observer?.disconnect();
    };
  }, [comparing, timeline.items.length]);

  // Center selected timeline node horizontally without moving page scroll.
  React.useEffect(() => {
    const rail = railRef.current;
    if (!rail || comparing) return;
    const node = rail.querySelector<HTMLElement>(`[data-snapshot-id="${CSS.escape(selectedId)}"]`);
    if (!node) return;
    const targetLeft = node.offsetLeft - rail.clientWidth / 2 + node.offsetWidth / 2;
    rail.scrollTo({ left: Math.max(0, targetLeft), behavior: "smooth" });
  }, [selectedId, comparing, timeline.items.length]);

  // Clear highlight flash automatically.
  React.useEffect(() => {
    if (!highlightedKey) return;
    const timer = window.setTimeout(() => setHighlightedKey(null), 2600);
    return () => window.clearTimeout(timer);
  }, [highlightedKey]);

  const diffSummary = React.useMemo(() => {
    if (!activeSnapshot || !prevSummary || !prevDetail || prevDetail.id !== prevSummary.id) {
      return null;
    }
    return summarizeSnapshotDiff(prevDetail, activeSnapshot);
  }, [activeSnapshot, prevSummary, prevDetail]);

  const changedInListCount = React.useMemo(() => {
    if (!activeSnapshot || !diffSummary) return 0;
    return activeSnapshot.best50.filter((score) => {
      const diff = diffSummary.byKey.get(`${score.songId}:${score.difficulty}`);
      return diff && diff.kind !== "unchanged";
    }).length;
  }, [activeSnapshot, diffSummary]);

  React.useEffect(() => {
    if (scoreGroup === "changed" && changedInListCount === 0) {
      setScoreGroup("all");
    }
  }, [scoreGroup, changedInListCount]);

  const openCompare = React.useCallback(
    (before?: string, after?: string) => {
      if (before && after) {
        setCompareBeforeId(before);
        setCompareAfterId(after);
      } else if (!compareBeforeId && !compareAfterId && snapshots.length >= 2) {
        setCompareBeforeId(snapshots[1].id);
        setCompareAfterId(snapshots[0].id);
      }
      setComparing(true);
    },
    [compareBeforeId, compareAfterId, snapshots],
  );

  const handleCompareSelectionChange = React.useCallback((beforeId: string, afterId: string) => {
    setCompareBeforeId(beforeId);
    setCompareAfterId(afterId);
  }, []);

  const focusScoreCardOrRow = React.useCallback((key: string) => {
    setScoreGroup("all");
    setSearchQuery("");
    setHighlightedKey(key);
    window.requestAnimationFrame(() => {
      const target = document.querySelector<HTMLElement>(`[data-score-key="${CSS.escape(key)}"]`);
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }, []);

  const stats = React.useMemo(
    () => (activeSnapshot ? computeSnapshotStats(activeSnapshot) : null),
    [activeSnapshot],
  );

  const filteredScores = React.useMemo(() => {
    if (!activeSnapshot) return [];
    return filterAndSortHistoryScores(activeSnapshot.best50, {
      group: scoreGroup,
      query: searchQuery,
      sort: scoreSort,
      diffByKey: diffSummary?.byKey,
    });
  }, [activeSnapshot, scoreGroup, searchQuery, scoreSort, diffSummary]);

  const activeDelta = activeIndex >= 0 ? deltaAgainst(snapshots, activeIndex) : undefined;
  const activeParts = activeSnapshot ? beijingDateParts(activeSnapshot.fetchedAt) : null;
  const activeMediaStatus = activeSnapshot?.mediaStatus || "complete";
  const showTop10DividerInTable =
    scoreSort === "rank" && scoreGroup === "all" && !searchQuery.trim();

  return (
    <main className="app-shell history-shell">
      <AppNavigation current="history" />
      <div className="app-content">
        <section className="history-intro" aria-labelledby="history-title">
          <div>
            <p className="section-kicker">
              <HistoryIcon size={13} /> ARCHIVE TIMELINE
            </p>
            <h1 id="history-title">
              历史 <span>/ FRAGMENTS</span>
            </h1>
          </div>
        </section>

        <div className="history-view-tabs" aria-label="历史查看模式">
          <div className="history-view-tabs-group">
            <button type="button" aria-pressed={!comparing} onClick={() => setComparing(false)}>
              历史详情
            </button>
            <button type="button" aria-pressed={comparing} onClick={() => openCompare()}>
              对比两次历史
            </button>
          </div>
          {!comparing && snapshots.length > 1 ? (
            <span className="history-kbd-hint" aria-hidden="true">
              ← / → 切换快照
            </span>
          ) : null}
        </div>

        {comparing ? (
          <HistoryCompare
            summaries={snapshots}
            initialBeforeId={compareBeforeId}
            initialAfterId={compareAfterId}
            onSelectionChange={handleCompareSelectionChange}
          />
        ) : snapshots.length ? (
          <section className="history-layout">
            <aside className="history-index" aria-label="历史快照时间轴">
              <div className="history-timeline-bar">
                <div className="history-timeline-meta">
                  <span className="history-timeline-kicker">SNAPSHOT TIMELINE</span>
                  <strong>
                    第 {Math.max(selectedIndex + 1, 1)} / {snapshots.length} 份
                  </strong>
                  <div className="history-step-buttons">
                    <button
                      type="button"
                      className="history-step-btn"
                      onClick={stepNewer}
                      disabled={stepIndex <= 0}
                      aria-label="切换到较新快照"
                      title="较新快照 (←)"
                    >
                      <ChevronLeft size={14} /> 较新
                    </button>
                    <button
                      type="button"
                      className="history-step-btn"
                      onClick={stepOlder}
                      disabled={stepIndex < 0 || stepIndex + 1 >= stepList.length}
                      aria-label="切换到较早快照"
                      title="较早快照 (→)"
                    >
                      较早 <ChevronRight size={14} />
                    </button>
                  </div>
                </div>

                <div className="history-timeline-actions">
                  {timeline.hasUnchanged ? (
                    <button
                      type="button"
                      className={`history-action-chip${changedOnly ? " active" : ""}`}
                      aria-pressed={changedOnly}
                      onClick={() => setChangedOnly((value) => !value)}
                    >
                      仅看 PTT 变动
                    </button>
                  ) : null}
                  {snapshots.length >= 2 && selectedIndex >= 0 && selectedIndex + 1 < snapshots.length ? (
                    <button
                      type="button"
                      className="history-action-chip"
                      onClick={() => openCompare(snapshots[selectedIndex + 1].id, selectedId)}
                    >
                      <GitCompareArrows size={13} /> 对比上一份
                    </button>
                  ) : null}
                  {snapshots.length >= 2 && selectedIndex > 0 ? (
                    <button
                      type="button"
                      className="history-action-chip"
                      onClick={() => openCompare(selectedId, snapshots[0].id)}
                    >
                      <GitCompareArrows size={13} /> 与最新对比
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className={`history-action-chip${archiveOpen ? " active" : ""}`}
                    aria-expanded={archiveOpen}
                    onClick={() => setArchiveOpen((value) => !value)}
                  >
                    <Calendar size={13} /> 全部索引 ({snapshots.length})
                  </button>
                </div>
              </div>

              <div className="history-timeline-rail-wrap">
                <div className="history-timeline-rail" ref={railRef} role="list" aria-label="快照时间轴节点">
                  {timeline.items.map(({ snapshot, index, delta, parts, barRatio }) => {
                    const active = snapshot.id === selectedId;
                    const mediaStatus =
                      snapshot.mediaStatus && snapshot.mediaStatus !== "complete"
                        ? snapshot.mediaStatus
                        : null;
                    return (
                      <button
                        key={snapshot.id}
                        type="button"
                        role="listitem"
                        data-snapshot-id={snapshot.id}
                        className={`history-timeline-node${active ? " active" : ""}`}
                        aria-pressed={active}
                        onClick={() => selectSnapshot(snapshot.id)}
                      >
                        <span className="history-node-bar-track" aria-hidden="true">
                          <span
                            className="history-node-bar"
                            style={{ height: `${Math.round(barRatio * 100)}%` }}
                          />
                        </span>
                        <span className="history-node-top">
                          <time dateTime={snapshot.fetchedAt}>
                            {parts.shortDate} · {parts.time}
                          </time>
                          {index === 0 ? <span className="history-node-badge">LATEST</span> : null}
                        </span>
                        <span className="history-node-bottom">
                          <strong>{snapshot.potential.toFixed(3)}</strong>
                          {mediaStatus ? (
                            <span className={`history-status history-status-${mediaStatus}`}>
                              {mediaStatus === "processing" ? "SYNC" : "PARTIAL"}
                            </span>
                          ) : delta !== undefined ? (
                            <span className={`history-index-delta ${deltaClass(delta)}`}>
                              {formatDelta(delta)}
                            </span>
                          ) : (
                            <span className="history-index-delta flat">—</span>
                          )}
                        </span>
                        <small className="history-node-trigger">
                          #{String(index + 1).padStart(2, "0")} · {snapshot.trigger.toUpperCase()}
                        </small>
                      </button>
                    );
                  })}
                </div>
                {railScrollable ? (
                  <div className="history-timeline-progress" aria-hidden="true">
                    <div className="history-timeline-progress-fill" ref={railProgressRef} />
                  </div>
                ) : null}
              </div>

              {archiveOpen ? (
                <div className="history-archive-drawer" aria-label="按月归档索引">
                  <div className="history-archive-months" role="group" aria-label="按月份筛选">
                    <button
                      type="button"
                      className={`history-month-chip${archiveMonth === "all" ? " active" : ""}`}
                      aria-pressed={archiveMonth === "all"}
                      onClick={() => setArchiveMonth("all")}
                    >
                      全部月份 ({snapshots.length})
                    </button>
                    {timeline.monthKeys.map((monthKey) => (
                      <button
                        key={monthKey}
                        type="button"
                        className={`history-month-chip${archiveMonth === monthKey ? " active" : ""}`}
                        aria-pressed={archiveMonth === monthKey}
                        onClick={() => setArchiveMonth(monthKey)}
                      >
                        {monthKey.replace("-", " / ")}
                      </button>
                    ))}
                  </div>
                  <GradientScrollArea className="history-archive-grid">
                    {archiveGrid.items.map(({ snapshot, index, delta, parts }) => {
                      const active = snapshot.id === selectedId;
                      return (
                        <button
                          key={snapshot.id}
                          type="button"
                          className={`history-archive-card${active ? " active" : ""}`}
                          aria-pressed={active}
                          onClick={() => {
                            selectSnapshot(snapshot.id);
                            setArchiveOpen(false);
                          }}
                        >
                          <div className="history-archive-card-head">
                            <time dateTime={snapshot.fetchedAt}>{parts.fullDate}</time>
                            <span>#{String(index + 1).padStart(2, "0")}</span>
                          </div>
                          <div className="history-archive-card-body">
                            <small>
                              {snapshot.trigger.toUpperCase()} · {snapshot.entries} ENTRIES
                            </small>
                            <div className="history-archive-card-score">
                              <strong>{snapshot.potential.toFixed(3)}</strong>
                              {delta !== undefined ? (
                                <span className={`history-index-delta ${deltaClass(delta)}`}>
                                  {formatDelta(delta)}
                                </span>
                              ) : (
                                <span className="history-index-delta flat">—</span>
                              )}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </GradientScrollArea>
                </div>
              ) : null}
            </aside>

            {activeSnapshot && stats && activeParts ? (
              <section
                className="history-detail"
                aria-labelledby="snapshot-title"
                aria-busy={detailState === "loading"}
              >
                {detailState === "loading" ? (
                  <div className="history-loading-bar" role="status" aria-label="正在加载快照" />
                ) : null}

                {detailState === "error" ? (
                  <div className="history-load-error" role="alert">
                    <span>快照 {selectedId} 加载失败，当前保留上一次已加载的内容。</span>
                    <button
                      type="button"
                      onClick={() => setRetryToken((token) => token + 1)}
                    >
                      <RotateCw size={13} /> 重试加载
                    </button>
                  </div>
                ) : null}

                <div className="history-detail-hero">
                  <div className="history-detail-title-col">
                    <div className="history-detail-tags">
                      <span className="section-kicker">
                        <Database size={13} /> SNAPSHOT DETAIL · #{String(Math.max(activeIndex + 1, 1)).padStart(2, "0")}
                      </span>
                      {activeIndex === 0 ? <span className="history-hero-badge">LATEST</span> : null}
                      {detailState === "loading" ? (
                        <span className="history-loading-pill">正在加载…</span>
                      ) : null}
                    </div>
                    <h2 id="snapshot-title">{formatRelativeDate(activeSnapshot.fetchedAt)}</h2>
                    <div className="history-detail-meta">
                      <span className={`media-status media-${activeMediaStatus}`}>
                        {activeMediaStatus === "complete"
                          ? "MEDIA READY"
                          : activeMediaStatus === "processing"
                            ? "MEDIA PROCESSING"
                            : "MEDIA PARTIAL"}
                      </span>
                      <span>{activeSnapshot.trigger.toUpperCase()} FETCH</span>
                      <span>{activeParts.fullDate}</span>
                      <span className="history-detail-id" title={activeSnapshot.id}>
                        ID {activeSnapshot.id}
                      </span>
                    </div>
                  </div>

                  <div className="history-kpi-grid" aria-label="快照关键指标">
                    <div className="history-kpi-card is-primary">
                      <span>POTENTIAL / 潜力值</span>
                      <strong>{activeSnapshot.potential.toFixed(3)}</strong>
                      {activeDelta !== undefined ? (
                        <small className={`history-index-delta ${deltaClass(activeDelta)}`}>
                          较上次 {formatDelta(activeDelta)}
                        </small>
                      ) : (
                        <small className="history-index-delta flat">首份归档快照</small>
                      )}
                    </div>
                    <div className="history-kpi-card">
                      <span>WEIGHTED / 加权</span>
                      <strong>{stats.weightedExact.toFixed(6)}</strong>
                      <small>{activeSnapshot.best50.length} / 50 ENTRIES</small>
                    </div>
                    <div className="history-kpi-card">
                      <span>TOP 10 均值</span>
                      <strong>{stats.top10Avg.toFixed(3)}</strong>
                      <small>#10 门槛 {stats.top10Floor.toFixed(3)}</small>
                    </div>
                    <div className="history-kpi-card">
                      <span>B50 均值</span>
                      <strong>{stats.b50Avg.toFixed(3)}</strong>
                      <small>#50 守门 {stats.b50Floor.toFixed(3)}</small>
                    </div>
                  </div>
                </div>

                <div className="formula-strip history-formula">
                  <span>
                    <strong>TOP 10</strong> × 2 = {stats.top10Sum.toFixed(6)}
                  </span>
                  <i />
                  <span>
                    <strong>REST {Math.max(activeSnapshot.best50.length - 10, 0)}</strong> ={" "}
                    {stats.rest40Sum.toFixed(6)}
                  </span>
                  <span className="formula-result">
                    TOTAL / 60 = <strong>{((stats.top10Sum * 2 + stats.rest40Sum) / 60).toFixed(6)}</strong>
                  </span>
                </div>

                {prevSummary && diffSummary ? (
                  diffSummary.counts.totalChanged === 0 ? (
                    <div className="history-diff-spotlight is-flat">
                      <div className="history-diff-flat-copy">
                        <Sparkles size={14} />
                        <span>
                          较上一份快照（{beijingDateParts(prevSummary.fetchedAt).shortDate}{" "}
                          {beijingDateParts(prevSummary.fetchedAt).time}）B50 成绩与排名无变化
                        </span>
                      </div>
                      <button
                        type="button"
                        className="history-diff-link"
                        onClick={() => openCompare(prevSummary.id, activeSnapshot.id)}
                      >
                        完整对比 →
                      </button>
                    </div>
                  ) : (
                    <div className="history-diff-spotlight" aria-label="较上次变动速览">
                      <div className="history-diff-head">
                        <div className="history-diff-title">
                          <span className="history-diff-kicker">CHANGES VS PREVIOUS</span>
                          <small>
                            对比 {beijingDateParts(prevSummary.fetchedAt).shortDate}{" "}
                            {beijingDateParts(prevSummary.fetchedAt).time}
                          </small>
                          <div className="history-diff-counts">
                            {diffSummary.counts.added > 0 ? (
                              <span className="is-added">新增 {diffSummary.counts.added}</span>
                            ) : null}
                            {diffSummary.counts.changed > 0 ? (
                              <span className="is-changed">变化 {diffSummary.counts.changed}</span>
                            ) : null}
                            {diffSummary.counts.removed > 0 ? (
                              <span className="is-removed">移出 {diffSummary.counts.removed}</span>
                            ) : null}
                          </div>
                        </div>
                        <button
                          type="button"
                          className="history-diff-link"
                          onClick={() => openCompare(prevSummary.id, activeSnapshot.id)}
                        >
                          完整对比 →
                        </button>
                      </div>
                      <div className="history-diff-chips">
                        {diffSummary.changedRows.slice(0, 8).map((row) => {
                          const targetScore = (row.after || row.before)!.score;
                          const songTitle =
                            targetScore.title.zh ||
                            targetScore.title.en ||
                            targetScore.title.ja ||
                            targetScore.songId;
                          const inList = row.kind !== "removed";
                          const Tag = inList ? "button" : "span";
                          return (
                            <Tag
                              key={row.key}
                              {...(inList
                                ? {
                                    type: "button" as const,
                                    onClick: () => focusScoreCardOrRow(row.key),
                                    title: "定位到该谱面",
                                  }
                                : {})}
                              className={`history-diff-chip kind-${row.kind}`}
                            >
                              <span className="history-diff-chip-kind">
                                {row.kind === "added"
                                  ? "新增"
                                  : row.kind === "removed"
                                    ? "移出"
                                    : "刷新"}
                              </span>
                              <strong>{songTitle}</strong>
                              <em>
                                {difficultyCode(
                                  targetScore.difficulty,
                                  targetScore.difficultyAlias,
                                )}
                              </em>
                              <small>
                                {row.kind === "removed"
                                  ? `原 #${row.before?.rank}`
                                  : formatDiffBadge(row)}
                              </small>
                            </Tag>
                          );
                        })}
                        {diffSummary.changedRows.length > 8 ? (
                          <button
                            type="button"
                            className="history-diff-more"
                            onClick={() => openCompare(prevSummary.id, activeSnapshot.id)}
                          >
                            +{diffSummary.changedRows.length - 8} 项全部对比
                          </button>
                        ) : null}
                      </div>
                    </div>
                  )
                ) : null}

                <div className="history-b50-toolbar" aria-label="B50 筛选与视图控制">
                  <div className="history-group-tabs" role="tablist" aria-label="分段筛选">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={scoreGroup === "all"}
                      className={scoreGroup === "all" ? "active" : ""}
                      onClick={() => setScoreGroup("all")}
                    >
                      全部 ({activeSnapshot.best50.length})
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={scoreGroup === "top10"}
                      className={scoreGroup === "top10" ? "active" : ""}
                      onClick={() => setScoreGroup("top10")}
                    >
                      Top 10
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={scoreGroup === "rest40"}
                      className={scoreGroup === "rest40" ? "active" : ""}
                      onClick={() => setScoreGroup("rest40")}
                    >
                      Rest {Math.max(activeSnapshot.best50.length - 10, 0)}
                    </button>
                    {changedInListCount > 0 ? (
                      <button
                        type="button"
                        role="tab"
                        aria-selected={scoreGroup === "changed"}
                        className={scoreGroup === "changed" ? "active" : ""}
                        onClick={() => setScoreGroup("changed")}
                      >
                        本次变动 ({changedInListCount})
                      </button>
                    ) : null}
                  </div>

                  <div className="history-b50-controls">
                    <label className="history-search-box">
                      <Search size={14} aria-hidden="true" />
                      <input
                        type="search"
                        value={searchQuery}
                        onChange={(event) => setSearchQuery(event.target.value)}
                        placeholder="搜索曲名 / 曲师 / 难度…"
                        aria-label="搜索快照内曲目"
                        autoComplete="off"
                      />
                      {searchQuery ? (
                        <button
                          type="button"
                          className="history-search-clear"
                          onClick={() => setSearchQuery("")}
                          aria-label="清空搜索"
                        >
                          <X size={13} />
                        </button>
                      ) : null}
                    </label>

                    <div className="history-sort-select">
                      <Select
                        id="history-score-sort"
                        name="scoreSort"
                        value={scoreSort}
                        onValueChange={(value) => setScoreSort(value as HistoryScoreSort)}
                        options={SORT_OPTIONS}
                      />
                    </div>

                    <div className="history-view-mode" role="group" aria-label="展示方式">
                      <button
                        type="button"
                        className={viewMode === "cards" ? "active" : ""}
                        aria-pressed={viewMode === "cards"}
                        onClick={() => setViewMode("cards")}
                      >
                        <LayoutGrid size={13} /> 卡片
                      </button>
                      <button
                        type="button"
                        className={viewMode === "table" ? "active" : ""}
                        aria-pressed={viewMode === "table"}
                        onClick={() => setViewMode("table")}
                      >
                        <List size={13} /> 榜单
                      </button>
                    </div>
                  </div>
                </div>

                {filteredScores.length === 0 ? (
                  <div className="history-filter-empty">
                    <p>没有匹配的谱面记录。</p>
                    <button
                      type="button"
                      onClick={() => {
                        setScoreGroup("all");
                        setSearchQuery("");
                      }}
                    >
                      清除筛选条件
                    </button>
                  </div>
                ) : viewMode === "cards" ? (
                  <div className="score-grid history-score-grid">
                    {filteredScores.map((entry) => {
                      const hasChange = Boolean(entry.diff && entry.diff.kind !== "unchanged");
                      const isHighlighted = highlightedKey === entry.key;
                      return (
                        <div
                          key={`${activeSnapshot.id}-${entry.key}-${entry.rank}`}
                          data-score-key={entry.key}
                          className={`history-card-slot${hasChange ? ` is-${entry.diff!.kind}` : ""}${isHighlighted ? " is-highlighted" : ""}`}
                        >
                          <ScoreCard score={entry.score} rank={entry.rank} />
                          {hasChange && entry.diff ? (
                            <div className={`history-card-diff kind-${entry.diff.kind}`}>
                              {formatDiffBadge(entry.diff)}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="history-score-table-wrap">
                    <table className="history-score-table">
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>曲目</th>
                          <th>难度 / 定数</th>
                          <th>分数 / 状态</th>
                          <th>单曲 PTT</th>
                          <th>判定 (P / F / L)</th>
                          <th>游玩时间</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredScores.map((entry, idx) => {
                          const prevRow = filteredScores[idx - 1];
                          const showDivider =
                            showTop10DividerInTable &&
                            entry.rank > 10 &&
                            (!prevRow || prevRow.rank <= 10);
                          const title =
                            entry.score.title.zh ||
                            entry.score.title.en ||
                            entry.score.title.ja ||
                            entry.score.songId;
                          const shiny = shinyPureCount(entry.score);
                          const hasChange = Boolean(entry.diff && entry.diff.kind !== "unchanged");
                          const isHighlighted = highlightedKey === entry.key;
                          const grade = scoreGrade(entry.score.score);
                          const clearCode = clearTypeCode(entry.score.clearType);

                          return (
                            <React.Fragment key={`${activeSnapshot.id}-${entry.key}-${entry.rank}`}>
                              {showDivider ? (
                                <tr className="history-table-divider">
                                  <td colSpan={7}>TOP 10 (×2 权重) / REST 40 (×1 权重)</td>
                                </tr>
                              ) : null}
                              <tr
                                data-score-key={entry.key}
                                className={`${hasChange ? `is-${entry.diff!.kind}` : ""}${isHighlighted ? " is-highlighted" : ""}`}
                              >
                                <td className="history-table-rank">
                                  #{String(entry.rank).padStart(2, "0")}
                                </td>
                                <td className="history-table-track">
                                  <div className="history-table-track-inner">
                                    <strong>{title}</strong>
                                    <small>{entry.score.artist || "Unknown artist"}</small>
                                  </div>
                                </td>
                                <td>
                                  <div className="history-table-diff">
                                    <span
                                      className={`what-if-diff-pill difficulty-${difficultyTone(
                                        entry.score.difficulty,
                                        entry.score.difficultyAlias,
                                      )}`}
                                    >
                                      {difficultyCode(
                                        entry.score.difficulty,
                                        entry.score.difficultyAlias,
                                      )}
                                    </span>
                                    <strong>{entry.chartConstant.toFixed(1)}</strong>
                                  </div>
                                </td>
                                <td>
                                  <div className="history-table-score">
                                    <strong>{formatScore(entry.score.score)}</strong>
                                    <small>
                                      {grade} ·{" "}
                                      <span title={clearTypeLabel(entry.score.clearType)}>
                                        {clearCode}
                                      </span>
                                    </small>
                                  </div>
                                </td>
                                <td className="history-table-ptt">
                                  <strong>{entry.score.rating.toFixed(3)}</strong>
                                  {hasChange && entry.diff ? (
                                    <small className={`history-table-diff-tag kind-${entry.diff.kind}`}>
                                      {formatDiffBadge(entry.diff)}
                                    </small>
                                  ) : null}
                                </td>
                                <td className="history-table-judgement">
                                  <span>
                                    <em>{formatScore(entry.score.perfectCount)}</em>
                                    {shiny !== null ? ` (+${formatScore(shiny)})` : ""} /{" "}
                                    {entry.score.nearCount} / {entry.score.missCount}
                                  </span>
                                </td>
                                <td className="history-table-date">
                                  {entry.score.timePlayed > 0
                                    ? formatRelativeDate(entry.score.timePlayed)
                                    : "—"}
                                </td>
                              </tr>
                            </React.Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            ) : detailState === "error" ? (
              <div className="history-load-error" role="alert">
                <span>快照加载失败，请重试。</span>
                <button type="button" onClick={() => setRetryToken((token) => token + 1)}>
                  <RotateCw size={13} /> 重试加载
                </button>
              </div>
            ) : (
              <p className="history-detail-status" role="status">
                正在加载
              </p>
            )}
          </section>
        ) : (
          <section className="history-empty">
            <Archive size={28} />
            <h2>暂无历史快照</h2>
            <p>返回概览页获取第一份 B50，之后每次同步都会自动归档。</p>
            <a className="history-empty-link" href="/">
              返回概览
            </a>
          </section>
        )}

        <footer className="footer">
          <span>ArcOnline Extension</span>
        </footer>
      </div>
    </main>
  );
}
