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
import { AppNavigation } from "@/components/app-navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import type { DashboardPayload, JobView } from "@/lib/types";
import { formatJoinDate, formatRelativeDate } from "@/lib/utils";

type ActionState = "idle" | "syncing" | "retrying" | "importing";
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
  const [lastAction, setLastAction] = React.useState<"sync" | "retry" | "import">("sync");
  const [logOpen, setLogOpen] = React.useState(false);
  const [chartRange, setChartRange] = React.useState<ChartRange>("1Y");

  const [jobId, setJobId] = React.useState<string | null>(initialData.activeJob?.id || null);
  const [job, setJob] = React.useState<JobView | null>(initialData.activeJob);
  const latest = data.latest;
  async function submit(path: string, kind: "sync" | "retry" | "import") {
    setAction(kind === "sync" ? "syncing" : kind === "retry" ? "retrying" : "importing");
    setLastAction(kind); setError(null); setMessage(null);
    try {
      const response = await fetch(path, { method: "POST" });
      const payload = await response.json() as { jobId: string; error?: string };
      if (!response.ok) throw new Error(payload.error || "提交任务失败");
      setJobId(payload.jobId);
      setJob({ id: payload.jobId, kind, status: "queued", stage: "fetch", progress: { completed: 0, total: 0 }, createdAt: "", updatedAt: "" });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "提交任务失败");
      setLogOpen(true); setAction("idle");
    }
  }
  const startSync = () => submit("/api/sync", "sync");
  const retryMedia = () => submit("/api/media/retry", "retry");
  const importHistory = () => submit("/api/history/import", "import");
  const retryFailedJob = () => job && submit(`/api/jobs/${job.id}/retry`, job.kind);
  React.useEffect(() => {
    if (!jobId) return;
    let disposed = false, timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const [jobResponse, dashboardResponse] = await Promise.all([
          fetch(`/api/jobs/${jobId}`, { cache: "no-store" }), fetch("/api/dashboard", { cache: "no-store" }),
        ]);
        if (jobResponse.status === 401) { window.location.assign("/login"); return; }
        if (!jobResponse.ok || !dashboardResponse.ok) throw new Error("暂时无法读取任务状态，正在重试…");
        const currentJob = await jobResponse.json() as JobView;
        const dashboard = await dashboardResponse.json() as DashboardPayload;
        if (disposed) return;
        setJob(currentJob); setData(dashboard); setError(null);
        if (currentJob.status === "succeeded" || currentJob.status === "failed") {
          setJobId(null); setAction("idle");
          if (currentJob.result?.snapshot) setData({ ...dashboard, latest: currentJob.result.snapshot });
          setMessage(currentJob.result?.message || null); setError(currentJob.error || null); setLogOpen(true);
          return;
        }
        setAction(currentJob.kind === "sync" ? "syncing" : currentJob.kind === "retry" ? "retrying" : "importing");
      } catch (caught) { if (!disposed) setError(caught instanceof Error ? caught.message : "正在重试读取任务状态…"); }
      if (!disposed) timer = setTimeout(poll, 2000);
    }
    void poll();
    return () => { disposed = true; clearTimeout(timer); };
  }, [jobId]);
  const top10 = latest?.best50.slice(0, 10).reduce((sum, score) => sum + score.rating, 0) || 0;
  const rest40 = latest?.best50.slice(10).reduce((sum, score) => sum + score.rating, 0) || 0;
  const selectedRange = chartRanges.find((range) => range.label === chartRange);
  const chartPoints = React.useMemo(() => {
    if (!selectedRange || !data.history.length) return [];
    const cutoff = Date.now() - selectedRange.days * 24 * 60 * 60 * 1000;
    const filtered = data.history.filter((point) => {
      const timestamp = Date.parse(`${point.date}T23:59:59+08:00`);
      return Number.isNaN(timestamp) || timestamp >= cutoff;
    });
    return filtered.length ? filtered : data.history.slice(-1);
  }, [data.history, selectedRange]);

  return (
    <main className="app-shell">
      <AppNavigation current="overview" />
      <div className="app-content">

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

      {job ? <div className="job-status" role="status">
        <span>{job.status === "queued" ? "等待处理" : job.status === "running" ? "正在同步" : job.status === "failed" ? "同步失败" : "同步完成"} · {({ fetch: "获取数据", history: "官网历史", media: "媒体处理", archive: "归档备份", done: "完成" } as Record<string, string>)[job.stage] || job.stage}
          {job.progress.total > 0 ? ` · ${job.progress.completed}/${job.progress.total}` : ""}</span>
        {job.status === "failed" ? <Button size="sm" onClick={retryFailedJob} disabled={action !== "idle"}>重试任务</Button> : null}
        {error ? <span>{error}</span> : null}
      </div> : null}
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
            <div><p className="section-kicker">LONGITUDINAL VIEW</p><CardTitle>潜力值折线</CardTitle><CardDescription>官网历史与本地快照 · 每日最高潜力值</CardDescription></div>
            <Badge><Activity size={12} /> {data.history.length ? "TRACKING" : "READY"}</Badge>
          </CardHeader>
          <CardContent>
            <div className="chart-toolbar">
              <Button size="sm" variant="secondary" onClick={importHistory} disabled={action !== "idle"}>{action === "importing" ? <Loader2 className="spin" size={13} /> : <CloudDownload size={13} />}{action === "importing" ? "同步中…" : "同步官网历史"}</Button>
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
            <PttChart key={chartRange} points={chartPoints} />
          </CardContent>
        </Card>
      </section>

      <footer className="footer"><span>ARCAEA B50 STUDIO</span><span>LOWIRO DATA PIPELINE · {data.scheduler.timezone}</span><span>D1 ARCHIVE / R2 MEDIA</span></footer>

      <Dialog open={logOpen} onOpenChange={setLogOpen}>
        <DialogContent><DialogTitle>{error ? "事务未完成" : lastAction === "import" ? "官网历史已同步" : lastAction === "retry" ? "MEDIA PROCESS 重试" : "B50 已获取"}</DialogTitle><DialogDescription>{error || message}</DialogDescription><div className={error ? "dialog-result error" : "dialog-result success"}>{error ? <RefreshCw size={18} /> : <Check size={18} />}<span>{error || message}</span></div></DialogContent>
      </Dialog>
          </div>
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
