"use client";

import * as React from "react";
import {
  Activity,
  Check,
  CloudDownload,
  Loader2,
  RefreshCw,
  UserRound,
} from "lucide-react";
import { PttChart } from "@/components/ptt-chart";
import { ScoreCard } from "@/components/score-card";
import { SignOutButton } from "@/components/sign-out-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import type { DashboardPayload } from "@/lib/types";
import { formatJoinDate, formatRelativeDate } from "@/lib/utils";

type ActionState = "idle" | "syncing" | "retrying";
type ChartRange = (typeof chartRanges)[number]["label"];

const chartRanges = [
  { label: "1W", days: 7 },
  { label: "1M", days: 31 },
  { label: "1Y", days: 365 },
  { label: "3Y", days: 1095 },
  { label: "5Y", days: 1825 },
] as const;

export function DashboardShell({ initialData }: { initialData: DashboardPayload }) {
  const [data, setData] = React.useState(initialData);
  const [action, setAction] = React.useState<ActionState>("idle");
  const [message, setMessage] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [lastAction, setLastAction] = React.useState<"sync" | "retry">("sync");
  const [logOpen, setLogOpen] = React.useState(false);
  const [chartRange, setChartRange] = React.useState<ChartRange>("1Y");

  const refresh = React.useCallback(async () => {
    const response = await fetch("/api/dashboard", { cache: "no-store" });
    const payload = (await response.json()) as DashboardPayload;
    if (!response.ok) throw new Error((payload as unknown as { error?: string }).error || "读取面板失败");
    setData(payload);
  }, []);

  async function startSync() {
    setAction("syncing");
    setLastAction("sync");
    setMessage(null);
    setError(null);
    try {
      const response = await fetch("/api/sync", { method: "POST" });
      const payload = (await response.json()) as {
        message?: string;
        error?: string;
        snapshot?: NonNullable<DashboardPayload["latest"]>;
      };
      if (!response.ok) throw new Error(payload.error || "同步失败");
      if (payload.snapshot) {
        setData((current) => ({ ...current, latest: payload.snapshot! }));
      } else {
        await refresh();
      }
      setMessage(payload.message || "同步完成");
      setLogOpen(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "同步失败");
      setLogOpen(true);
    } finally {
      setAction("idle");
    }
  }

  async function retryMedia() {
    setAction("retrying");
    setLastAction("retry");
    setMessage(null);
    setError(null);
    try {
      const response = await fetch("/api/media/retry", { method: "POST" });
      const payload = (await response.json()) as {
        message?: string;
        error?: string;
        snapshot?: NonNullable<DashboardPayload["latest"]>;
      };
      if (!response.ok) throw new Error(payload.error || "媒体重试失败");
      if (payload.snapshot) {
        setData((current) => ({ ...current, latest: payload.snapshot! }));
      } else {
        await refresh();
      }
      setMessage(payload.message || "媒体处理已开始重试");
      setLogOpen(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "媒体重试失败");
      setLogOpen(true);
    } finally {
      setAction("idle");
    }
  }

  const latest = data.latest;
  const top10 = latest?.best50.slice(0, 10).reduce((sum, score) => sum + score.rating, 0) || 0;
  const rest40 = latest?.best50.slice(10).reduce((sum, score) => sum + score.rating, 0) || 0;
  const selectedRange = chartRanges.find((range) => range.label === chartRange);
  const chartPoints = React.useMemo(() => {
    if (!selectedRange || !data.history.length) return [];
    const cutoff = Date.now() - selectedRange.days * 24 * 60 * 60 * 1000;
    const filtered = data.history.filter((point) => {
      const timestamp = Date.parse(`${point.date}T23:59:59`);
      return Number.isNaN(timestamp) || timestamp >= cutoff;
    });
    return filtered.length ? filtered : data.history.slice(-1);
  }, [data.history, selectedRange]);

  const latestSnapshotId = latest?.id;
  const latestMediaStatus = latest?.mediaStatus;
  React.useEffect(() => {
    if (!latestSnapshotId || latestMediaStatus !== "processing") {
      return;
    }

    let disposed = false;
    const interval = window.setInterval(() => {
      void (async () => {
        try {
          const response = await fetch("/api/dashboard", { cache: "no-store" });
          if (!response.ok || disposed) return;
          const payload = (await response.json()) as DashboardPayload;
          if (!disposed) setData(payload);
        } catch {
          // The next poll will retry while the background media job is active.
        }
      })();
    }, 2000);
    return () => {
      disposed = true;
      window.clearInterval(interval);
    };
  }, [latestMediaStatus, latestSnapshotId]);

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#overview" aria-label="Arcaea B50 Studio">
          <span className="brand-lockup">
            <strong className="brand-wordmark">ARCAEA</strong>
            <small>B50 STUDIO</small>
          </span>
        </a>
        <div className="topbar-actions">
          <a className="history-nav-link" href="/history">
            历史
          </a>
          <a className="history-nav-link" href="/logs">
            日志
          </a>
          <SignOutButton />
        </div>
      </header>

      <section className="profile-section" id="overview" aria-label="玩家信息">
        <div className="profile-card">
          <div className="profile-avatar">
            {latest?.user.avatarImageUrl ? (
              <img
                src={latest.user.avatarImageUrl}
                alt={`${latest.user.name || "玩家"} 头像`}
                loading="eager"
                decoding="async"
              />
            ) : (
              <UserRound size={21} />
            )}
          </div>
          <div className="profile-copy">
            <span className="score-label">PLAYER PROFILE</span>
            <h2>{latest?.user.name || "ARCAEA PLAYER"}</h2>
            <p>
              {latest?.user.userCode ? `USER CODE ${latest.user.userCode}` : "等待首次同步"}
              {latest?.user.country ? ` · ${latest.user.country}` : ""}
              {latest?.user.joinDate ? <span className="profile-join-date"> · JOINED {formatJoinDate(latest.user.joinDate)}</span> : null}
            </p>
          </div>
          <div className="profile-potential">
            <span>潜力值 / POTENTIAL</span>
            <strong>{latest ? latest.potential.toFixed(3) : "—"}</strong>
          </div>
        </div>
        <div className="profile-toolbar">
          <Button className="sync-button" onClick={startSync} disabled={action !== "idle"}>
            {action === "syncing" ? <Loader2 className="spin" size={16} /> : <CloudDownload size={16} />}
            {action === "syncing" ? "获取中…" : "获取 B50 & 潜力图"}
          </Button>
        </div>
      </section>

      <section className="section-block" id="b50">
        <div className="section-heading-row">
          <div><p className="section-kicker">RANKED PERFORMANCE</p><h2>BEST 50 <span>/ CURRENT ROTATION</span></h2></div>
          {latest ? <div className="section-meta"><span className={`media-status media-${latest.mediaStatus ?? "complete"}`}>{mediaStatusLabel(latest.mediaStatus)}</span>{latest.mediaStatus === "failed" ? <Button className="media-retry-button" variant="danger" size="sm" onClick={retryMedia} disabled={action !== "idle"}><RefreshCw className={action === "retrying" ? "spin" : undefined} size={13} />{action === "retrying" ? "重试中…" : "重试媒体"}</Button> : null}<span className="last-fetch">LAST FETCH <strong>{formatRelativeDate(latest.fetchedAt)}</strong></span></div> : null}
        </div>
        {latest ? (
          <>
            <div className="formula-strip"><span><strong>TOP 10</strong> × 2 = {top10.toFixed(3)}</span><i /> <span><strong>REST 40</strong> = {rest40.toFixed(3)}</span> <span className="formula-result">TOTAL / 60 = <strong>{latest.weightedPotential.toFixed(3)}</strong></span></div>
            <div className="score-grid">{latest.best50.map((score, index) => <ScoreCard key={`${score.songId}-${score.difficulty}-${index}`} score={score} rank={index + 1} />)}</div>
          </>
        ) : <EmptyState title="还没有 B50 快照" description="使用玩家信息卡片下方的获取器登录 Lowiro，抓取并保存首份快照。" />}
      </section>

      <section className="section-block" id="potential">
        <div className="hexagon-title"><span>POTENTIAL / 潜力值</span></div>
        <Card className="chart-panel">
          <CardHeader className="section-header">
            <div><p className="section-kicker">LONGITUDINAL VIEW</p><CardTitle>潜力值折线</CardTitle><CardDescription>每日末尾快照 · B50 v7 weighted average</CardDescription></div>
            <Badge><Activity size={12} /> {data.history.length ? "TRACKING" : "READY"}</Badge>
          </CardHeader>
          <CardContent>
            <div className="chart-toolbar">
              <span className="chart-toolbar-label">VIEW RANGE</span>
              <div className="range-tabs" role="tablist" aria-label="折线图时间范围">
                {chartRanges.map((range) => (
                  <button
                    key={range.label}
                    type="button"
                    role="tab"
                    aria-selected={chartRange === range.label}
                    className={chartRange === range.label ? "active" : ""}
                    onClick={() => setChartRange(range.label)}
                  >
                    {range.label}
                  </button>
                ))}
              </div>
            </div>
            <PttChart points={chartPoints} />
          </CardContent>
        </Card>
      </section>

      <footer className="footer"><span>ARCAEA B50 STUDIO</span><span>LOWIRO DATA PIPELINE · {data.scheduler.timezone}</span><span>LOCAL ARCHIVE / R2 MEDIA</span></footer>

      <Dialog open={logOpen} onOpenChange={setLogOpen}>
        <DialogContent><DialogTitle>{error ? "事务未完成" : lastAction === "retry" ? "MEDIA PROCESS 重试" : "B50 已获取"}</DialogTitle><DialogDescription>{error || message}</DialogDescription><div className={error ? "dialog-result error" : "dialog-result success"}>{error ? <RefreshCw size={18} /> : <Check size={18} />}<span>{error || message}</span></div></DialogContent>
      </Dialog>
    </main>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return <div className="empty-state"><div className="empty-state-mark">A</div><h3>{title}</h3><p>{description}</p></div>;
}

function mediaStatusLabel(status: "processing" | "complete" | "failed" | undefined) {
  if (status === "processing") return "MEDIA PROCESSING";
  if (status === "failed") return "MEDIA PARTIAL";
  return "MEDIA READY";
}
