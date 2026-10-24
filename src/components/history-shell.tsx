"use client";

import * as React from "react";
import { Archive, Database, History as HistoryIcon } from "lucide-react";
import { ScoreCard } from "@/components/score-card";
import { HistoryCompare } from "@/components/history-compare";
import { AppNavigation } from "@/components/app-navigation";
import type { B50Snapshot, HistoryPayload, SnapshotSummary } from "@/lib/types";
import { cacheSnapshot, cachedSnapshot, loadSnapshot } from "@/lib/snapshot-cache";
import { exactWeightedPotential } from "@/lib/potential";
import { formatRelativeDate } from "@/lib/utils";

const beijingDateTime = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});
function beijingParts(value: string) {
  const parts = Object.fromEntries(beijingDateTime.formatToParts(new Date(value)).map(({ type, value }) => [type, value]));
  return { year: parts.year, month: parts.month, day: parts.day, time: `${parts.hour}:${parts.minute}` };
}
function deltaClass(delta: number) {
  return delta > 0 ? "up" : delta < 0 ? "down" : "flat";
}
function formatDelta(delta: number) {
  return `${delta > 0 ? "+" : ""}${delta.toFixed(3)}`;
}
// Summaries arrive newest-first, so each snapshot's baseline is its successor.
function deltaAgainst(snapshots: SnapshotSummary[], index: number) {
  if (index < 0 || index + 1 >= snapshots.length) return undefined;
  return Number((snapshots[index].potential - snapshots[index + 1].potential).toFixed(3));
}

export function HistoryShell({ initialData }: { initialData: HistoryPayload }) {
  const [comparing, setComparing] = React.useState(false);
  const [selectedId, setSelectedId] = React.useState(initialData.snapshots[0]?.id || "");
  const [detail, setDetail] = React.useState(initialData.detail);
  const [detailState, setDetailState] = React.useState<"ready" | "loading" | "error">("ready");

  // The newest snapshot arrives server-rendered; older ones load on demand
  // and land in the shared cache, so revisiting one is instant.
  React.useEffect(() => {
    if (initialData.detail) cacheSnapshot(initialData.detail);
  }, []);
  React.useEffect(() => {
    if (!selectedId || detail?.id === selectedId) return;
    const cached = cachedSnapshot(selectedId);
    if (cached) { setDetail(cached); setDetailState("ready"); return; }
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
    return () => { active = false; };
  }, [selectedId, detail?.id]);

  return (
    <main className="app-shell history-shell">
      <AppNavigation current="history" />
      <div className="app-content">

      <section className="history-intro" aria-labelledby="history-title">
        <div>
          <p className="section-kicker"><HistoryIcon size={13} /> ARCHIVE TIMELINE</p>
          <h1 id="history-title">历史 <span>/ B50 SNAPSHOTS</span></h1>
        </div>
      </section>

      <div className="history-view-tabs" aria-label="历史查看模式">
        <button type="button" aria-pressed={!comparing} onClick={() => setComparing(false)}>历史详情</button>
        <button type="button" aria-pressed={comparing} onClick={() => setComparing(true)}>对比两次历史</button>
      </div>

      {comparing ? <HistoryCompare summaries={initialData.snapshots} /> : initialData.snapshots.length ? (
        <section className="history-layout">
          <aside className="history-index" aria-label="历史快照列表">
            <div className="history-index-heading">
              <span>SNAPSHOT INDEX</span>
              <strong>{String(initialData.snapshots.length).padStart(2, "0")}</strong>
            </div>
            <div className="history-index-list">
              {Object.entries(
                initialData.snapshots.reduce<Record<string, Array<{ snapshot: SnapshotSummary; delta?: number }>>>((groups, snapshot, index) => {
                  const parts = beijingParts(snapshot.fetchedAt);
                  const key = `${parts.year}-${parts.month}`;
                  (groups[key] ||= []).push({ snapshot, delta: deltaAgainst(initialData.snapshots, index) });
                  return groups;
                }, {}),
              ).map(([key, items]) => (
                <React.Fragment key={key}>
                  <div className="history-index-month" aria-hidden="true">
                    {key.slice(0, 4)} / {key.slice(5)}
                  </div>
                  {items.map(({ snapshot, delta }) => (
                    <HistoryIndexButton
                      key={snapshot.id}
                      snapshot={snapshot}
                      delta={delta}
                      active={snapshot.id === selectedId}
                      onClick={() => setSelectedId(snapshot.id)}
                    />
                  ))}
                </React.Fragment>
              ))}
            </div>
          </aside>

          {detail ? (
            <HistoryDetail snapshot={detail} delta={deltaAgainst(initialData.snapshots, initialData.snapshots.findIndex((summary) => summary.id === detail.id))} />
          ) : detailState === "error" ? (
            <p className="history-detail-status" role="alert">快照加载失败，请刷新页面重试。</p>
          ) : (
            <p className="history-detail-status" role="status">正在加载快照…</p>
          )}
        </section>
      ) : (
        <section className="history-empty">
          <Archive size={28} />
          <h2>暂无历史快照</h2>
          <p>返回概览页获取第一份 B50，之后每次同步都会自动归档。</p>
          <a className="history-empty-link" href="/">返回概览</a>
        </section>
      )}

      <footer className="footer"><span>ArcOnline Extension</span></footer>
          </div>
    </main>
  );
}

function HistoryIndexButton({
  snapshot,
  delta,
  active,
  onClick,
}: {
  snapshot: SnapshotSummary;
  delta?: number;
  active: boolean;
  onClick: () => void;
}) {
  const parts = beijingParts(snapshot.fetchedAt);
  const mediaStatus = snapshot.mediaStatus && snapshot.mediaStatus !== "complete" ? snapshot.mediaStatus : null;
  return (
    <button
      type="button"
      className={`history-index-item${active ? " active" : ""}`}
      aria-pressed={active}
      onClick={onClick}
    >
      <span className="history-index-when">
        <time dateTime={snapshot.fetchedAt}>{Number(parts.month)}/{Number(parts.day)} · {parts.time}</time>
        <small>{snapshot.trigger.toUpperCase()} · {snapshot.entries} ENTRIES</small>
      </span>
      <span className="history-index-score">
        <strong>{snapshot.potential.toFixed(3)}</strong>
        {mediaStatus ? (
          <span className={`history-status history-status-${mediaStatus}`}>{mediaStatus === "processing" ? "SYNC" : "PARTIAL"}</span>
        ) : delta !== undefined ? (
          <span className={`history-index-delta ${deltaClass(delta)}`}>{formatDelta(delta)}</span>
        ) : (
          <span className="history-index-delta flat">—</span>
        )}
      </span>
    </button>
  );
}

function HistoryDetail({ snapshot, delta }: { snapshot: B50Snapshot; delta?: number }) {
  const top10 = snapshot.best50.slice(0, 10).reduce((sum, score) => sum + score.rating, 0);
  const rest40 = snapshot.best50.slice(10).reduce((sum, score) => sum + score.rating, 0);
  const mediaStatus = snapshot.mediaStatus || "complete";

  return (
    <section className="history-detail" aria-labelledby="snapshot-title">
      <div className="history-detail-heading">
        <div>
          <p className="section-kicker"><Database size={13} /> SNAPSHOT DETAIL</p>
          <h2 id="snapshot-title">{formatRelativeDate(snapshot.fetchedAt)}</h2>
          <p>{snapshot.trigger.toUpperCase()} FETCH</p>
        </div>
        <div className="history-detail-potential">
          <span>POTENTIAL / 潜力值</span>
          <strong>{snapshot.potential.toFixed(3)}</strong>
          {delta !== undefined ? (
            <small className={`history-index-delta ${deltaClass(delta)}`}>较上次 {formatDelta(delta)}</small>
          ) : null}
        </div>
      </div>

      <div className="history-detail-meta">
        <span className={`media-status media-${mediaStatus}`}>{mediaStatus === "complete" ? "MEDIA READY" : mediaStatus === "processing" ? "MEDIA PROCESSING" : "MEDIA PARTIAL"}</span>
        <span>{snapshot.best50.length} / 50 ENTRIES</span>
        <span>WEIGHTED {exactWeightedPotential(snapshot.best50).toFixed(6)}</span>
      </div>

      <div className="formula-strip"><span><strong>TOP 10</strong> × 2 = {top10.toFixed(6)}</span><i /><span><strong>REST {Math.max(snapshot.best50.length - 10, 0)}</strong> = {rest40.toFixed(6)}</span><span className="formula-result">TOTAL / 60 = <strong>{((top10 * 2 + rest40) / 60).toFixed(6)}</strong></span></div>
      <div className="score-grid">{snapshot.best50.map((score, index) => <ScoreCard key={`${snapshot.id}-${score.songId}-${score.difficulty}-${index}`} score={score} rank={index + 1} />)}</div>
    </section>
  );
}
