import { ArrowLeft, ClipboardList, History as HistoryIcon } from "lucide-react";
import { SignOutButton } from "@/components/sign-out-button";
import type { LogEntry, LogsPayload } from "@/lib/types";
import { formatRelativeDate } from "@/lib/utils";

export function LogsShell({ initialData }: { initialData: LogsPayload }) {
  const b50Count = initialData.entries.filter((entry) => entry.scope === "b50").length;
  const mediaCount = initialData.entries.filter((entry) => entry.scope === "media").length;

  return (
    <main className="app-shell logs-shell">
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
          <a className="history-nav-link" href="/history">
            <HistoryIcon size={14} />
            历史
          </a>
          <SignOutButton />
        </div>
      </header>

      <section className="logs-intro" aria-labelledby="logs-title">
        <div>
          <p className="section-kicker"><ClipboardList size={13} /> SYSTEM LOG</p>
          <h1 id="logs-title">日志 <span>/ OPERATIONS</span></h1>
          <p className="logs-description">记录 B50 获取与 MEDIA PROCESS 的状态，保留最近 500 条事件。</p>
        </div>
        <div className="logs-overview" aria-label="日志概览">
          <LogMetric label="EVENTS" value={String(initialData.entries.length)} />
          <LogMetric label="B50 FETCH" value={String(b50Count)} />
          <LogMetric label="MEDIA PROCESS" value={String(mediaCount)} />
        </div>
      </section>

      {initialData.entries.length > 0 ? (
        <section className="logs-panel" aria-label="系统日志">
          <div className="logs-panel-heading">
            <span>RECENT OPERATIONS</span>
            <strong>{String(initialData.entries.length).padStart(3, "0")}</strong>
          </div>
          <div className="logs-list">
            {initialData.entries.map((entry) => <LogRow key={entry.id} entry={entry} />)}
          </div>
        </section>
      ) : (
        <section className="logs-empty">
          <ClipboardList size={28} />
          <h2>暂无日志</h2>
          <p>返回概览页获取 B50 后，系统事件会显示在这里。</p>
          <a className="history-empty-link" href="/">返回概览</a>
        </section>
      )}

      <footer className="footer"><span>ARCAEA B50 STUDIO</span><span>B50 FETCH · MEDIA PROCESS</span><span>LOCAL SYSTEM LOG</span></footer>
    </main>
  );
}

function LogMetric({ label, value }: { label: string; value: string }) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}

function LogRow({ entry }: { entry: LogEntry }) {
  const details = formatDetails(entry.details);
  return (
    <article className={`log-entry log-entry-${entry.level}`}>
      <div className="log-entry-type">
        <span>{entry.scope === "b50" ? "B50 FETCH" : "MEDIA PROCESS"}</span>
        <small>{entry.level.toUpperCase()}</small>
      </div>
      <div className="log-entry-copy">
        <time dateTime={entry.timestamp}>{formatRelativeDate(entry.timestamp)}</time>
        <p>{entry.message}</p>
        <small>
          {entry.action.toUpperCase()}
          {entry.snapshotId ? ` · SNAPSHOT ${entry.snapshotId}` : ""}
          {details ? ` · ${details}` : ""}
        </small>
      </div>
    </article>
  );
}

function formatDetails(details: LogEntry["details"]) {
  if (!details) return "";
  return Object.entries(details)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(" · ");
}
