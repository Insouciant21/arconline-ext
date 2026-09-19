"use client";

import * as React from "react";
import { Archive, ArrowLeft, Database, History as HistoryIcon } from "lucide-react";
import { ScoreCard } from "@/components/score-card";
import { HistoryCompare } from "@/components/history-compare";
import { SignOutButton } from "@/components/sign-out-button";
import type { B50Snapshot, HistoryPayload } from "@/lib/types";
import { formatRelativeDate } from "@/lib/utils";

export function HistoryShell({ initialData }: { initialData: HistoryPayload }) {
  const [comparing, setComparing] = React.useState(false);
  const [selectedId, setSelectedId] = React.useState(initialData.snapshots[0]?.id || "");
  const selected = initialData.snapshots.find((snapshot) => snapshot.id === selectedId) || initialData.snapshots[0];

  const sourceLabel = initialData.sources.r2Available
    ? initialData.sources.localCount > 0
      ? "LOCAL ARCHIVE + R2 BACKUP"
      : "R2 BACKUP"
    : initialData.sources.localCount > 0
      ? "LOCAL ARCHIVE"
      : "NO ARCHIVE";

  return (
    <main className="app-shell history-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Arcaea B50 Studio">
          <span className="brand-lockup">
            <strong className="brand-wordmark">ARCAEA</strong>
            <small>B50 STUDIO</small>
          </span>
        </a>
        <div className="topbar-actions">
          <a className="history-nav-link" href="/">
            <ArrowLeft size={15} />
            概览
          </a>
          <a className="history-nav-link" href="/logs">
            日志
          </a>
          <SignOutButton />
        </div>
      </header>

      <section className="history-intro" aria-labelledby="history-title">
        <div>
          <p className="section-kicker"><HistoryIcon size={13} /> ARCHIVE TIMELINE</p>
          <h1 id="history-title">历史 <span>/ B50 SNAPSHOTS</span></h1>
          <p className="history-description">从本地归档与 R2 备份中查看每次获取的 B50 快照。</p>
        </div>
        <div className="history-overview" aria-label="历史数据概览">
          <HistoryMetric label="SNAPSHOTS" value={String(initialData.snapshots.length)} />
          <HistoryMetric label="LOCAL ARCHIVE" value={String(initialData.sources.localCount)} />
          <HistoryMetric label="R2 BACKUP" value={initialData.sources.r2Available ? String(initialData.sources.r2Count) : "—"} />
        </div>
      </section>

      <div className="history-view-tabs" aria-label="历史查看模式">
        <button type="button" aria-pressed={!comparing} onClick={() => setComparing(false)}>历史详情</button>
        <button type="button" aria-pressed={comparing} onClick={() => setComparing(true)}>对比两次历史</button>
      </div>

      {comparing ? <HistoryCompare snapshots={initialData.snapshots} /> : selected ? (
        <section className="history-layout">
          <aside className="history-index" aria-label="历史快照列表">
            <div className="history-index-heading">
              <span>SNAPSHOT INDEX</span>
              <strong>{String(initialData.snapshots.length).padStart(2, "0")}</strong>
            </div>
            <div className="history-index-list">
              {initialData.snapshots.map((snapshot, index) => (
                <HistoryIndexButton
                  key={snapshot.id}
                  snapshot={snapshot}
                  index={index}
                  active={snapshot.id === selected.id}
                  onClick={() => setSelectedId(snapshot.id)}
                />
              ))}
            </div>
          </aside>

          <HistoryDetail snapshot={selected} sourceLabel={sourceLabel} />
        </section>
      ) : (
        <section className="history-empty">
          <Archive size={28} />
          <h2>暂无历史快照</h2>
          <p>返回概览页获取第一份 B50，之后每次同步都会自动归档。</p>
          <a className="history-empty-link" href="/">返回概览</a>
        </section>
      )}

      <footer className="footer"><span>ARCAEA B50 STUDIO</span><span>LOCAL ARCHIVE · R2 BACKUP</span><span>HISTORY / SNAPSHOTS</span></footer>
    </main>
  );
}

function HistoryMetric({ label, value }: { label: string; value: string }) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}

function HistoryIndexButton({
  snapshot,
  index,
  active,
  onClick,
}: {
  snapshot: B50Snapshot;
  index: number;
  active: boolean;
  onClick: () => void;
}) {
  const mediaStatus = snapshot.mediaStatus || "complete";
  return (
    <button
      type="button"
      className={`history-index-item${active ? " active" : ""}`}
      aria-pressed={active}
      onClick={onClick}
    >
      <span className="history-index-number">{String(index + 1).padStart(2, "0")}</span>
      <span className="history-index-copy">
        <time dateTime={snapshot.fetchedAt}>{formatRelativeDate(snapshot.fetchedAt)}</time>
        <strong>{snapshot.potential.toFixed(3)}</strong>
        <small>{snapshot.trigger.toUpperCase()} · {snapshot.best50.length} ENTRIES</small>
      </span>
      <span className={`history-status history-status-${mediaStatus}`}>{mediaStatus === "complete" ? "READY" : mediaStatus === "processing" ? "SYNC" : "PARTIAL"}</span>
    </button>
  );
}

function HistoryDetail({ snapshot, sourceLabel }: { snapshot: B50Snapshot; sourceLabel: string }) {
  const top10 = snapshot.best50.slice(0, 10).reduce((sum, score) => sum + score.rating, 0);
  const rest40 = snapshot.best50.slice(10).reduce((sum, score) => sum + score.rating, 0);
  const mediaStatus = snapshot.mediaStatus || "complete";

  return (
    <section className="history-detail" aria-labelledby="snapshot-title">
      <div className="history-detail-heading">
        <div>
          <p className="section-kicker"><Database size={13} /> SNAPSHOT DETAIL</p>
          <h2 id="snapshot-title">{formatRelativeDate(snapshot.fetchedAt)}</h2>
          <p>{snapshot.trigger.toUpperCase()} FETCH · {sourceLabel}</p>
        </div>
        <div className="history-detail-potential">
          <span>POTENTIAL / 潜力值</span>
          <strong>{snapshot.potential.toFixed(3)}</strong>
        </div>
      </div>

      <div className="history-detail-meta">
        <span className={`media-status media-${mediaStatus}`}>{mediaStatus === "complete" ? "MEDIA READY" : mediaStatus === "processing" ? "MEDIA PROCESSING" : "MEDIA PARTIAL"}</span>
        <span>{snapshot.best50.length} / 50 ENTRIES</span>
        <span>WEIGHTED {snapshot.weightedPotential.toFixed(3)}</span>
      </div>

      <div className="formula-strip"><span><strong>TOP 10</strong> × 2 = {top10.toFixed(3)}</span><i /><span><strong>REST {Math.max(snapshot.best50.length - 10, 0)}</strong> = {rest40.toFixed(3)}</span><span className="formula-result">TOTAL / 60 = <strong>{snapshot.weightedPotential.toFixed(3)}</strong></span></div>
      <div className="score-grid">{snapshot.best50.map((score, index) => <ScoreCard key={`${snapshot.id}-${score.songId}-${score.difficulty}-${index}`} score={score} rank={index + 1} />)}</div>
    </section>
  );
}
