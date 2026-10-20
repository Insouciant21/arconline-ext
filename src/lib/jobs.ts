import type { Env, JobMessage } from "./environment";
import type { JobKind, JobView } from "./types";
import { Store } from "./store";
import { AppError } from "./errors";
import { runStep, type SyncState } from "./sync";

export interface JobRow {
  id: string; kind: JobKind; trigger: "manual" | "daily" | "cron";
  status: JobView["status"]; stage: string; step: number; attempts: number;
  created_at: string; updated_at: string; lease_token: string | null; lease_until: number | null;
  state: string; result: string | null; error: string | null;
}
function jobView(row: JobRow): JobView {
  const state = JSON.parse(row.state) as SyncState;
  return { id: row.id, kind: row.kind, status: row.status, stage: row.stage,
    progress: { completed: state.media?.filter(item => item.done).length || 0, total: state.media?.length || 0 },
    createdAt: row.created_at, updatedAt: row.updated_at,
    ...(row.result ? { result: JSON.parse(row.result) } : {}), ...(row.error ? { error: row.error } : {}),
  };
}
export async function getJob(env: Env, id: string) {
  const row = await new Store(env).sql("SELECT * FROM jobs WHERE id=?", id).first<JobRow>();
  if (!row) throw new AppError("任务不存在。", 404, "JOB_NOT_FOUND");
  return jobView(row);
}
export async function activeJob(env: Env) {
  const row = await new Store(env).sql("SELECT * FROM jobs WHERE status IN ('queued','running') ORDER BY created_at,id LIMIT 1").first<JobRow>();
  return row ? jobView(row) : null;
}
export async function enqueue(env: Env, kind: JobKind, trigger: JobRow["trigger"] = "manual", dedupeKey: string | null = null, state: SyncState = {}) {
  if (env.MUTATIONS_ENABLED === "false") throw new AppError("维护中，暂时停止同步。", 503, "MAINTENANCE");
  const store = new Store(env);
  const id = crypto.randomUUID(), now = new Date().toISOString();
  await env.DB.batch([
    store.sql(`INSERT OR IGNORE INTO jobs(id,kind,trigger,status,created_at,updated_at,dedupe_key,state)
      SELECT ?,?,?,'queued',?,?,?,? WHERE ? IS NOT NULL OR NOT EXISTS (
        SELECT 1 FROM jobs WHERE kind=? AND status IN ('queued','running'))`,
      id, kind, trigger, now, now, dedupeKey, JSON.stringify(state), dedupeKey, kind),
    store.sql("INSERT OR IGNORE INTO outbox(job_id,step) SELECT id,step FROM jobs WHERE id=?", id),
  ]);
  const row = await store.sql(dedupeKey ? "SELECT * FROM jobs WHERE dedupe_key=?" : "SELECT * FROM jobs WHERE id=? OR (kind=? AND status IN ('queued','running')) ORDER BY created_at LIMIT 1", ...(dedupeKey ? [dedupeKey] : [id,kind])).first<JobRow>();
  if (!row) throw new Error("Could not persist job");
  // The outbox survives a queue outage. The scheduled dispatcher will retry.
  await dispatch(env).catch(error => console.error("[outbox] deferred", error));
  return { jobId: row.id, status: row.status };
}
export async function retryJob(env: Env, id: string) {
  const store = new Store(env);
  const row = await store.sql("SELECT * FROM jobs WHERE id=?", id).first<JobRow>();
  if (!row || row.status !== "failed") throw new AppError("任务不处于失败状态。", 409, "JOB_RETRY_NOT_AVAILABLE");
  const next = row.step + 1;
  await env.DB.batch([
    store.sql("UPDATE jobs SET status='queued',attempts=0,error=NULL,step=?,lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=? AND status='failed' AND step=?", next, new Date().toISOString(), id, row.step),
    store.sql("INSERT OR IGNORE INTO outbox(job_id,step) SELECT id,step FROM jobs WHERE id=? AND status='queued'", id),
  ]);
  await dispatch(env).catch(error => console.error("[outbox] deferred", error));
  return { jobId: id, status: "queued" };
}
async function dispatch(env: Env) {
  const store = new Store(env);
  const { results } = await store.sql(`SELECT o.job_id,o.step FROM outbox o JOIN jobs j ON j.id=o.job_id AND j.step=o.step
    WHERE j.status='queued' AND (o.sent_at IS NULL OR o.sent_at<?) ORDER BY j.created_at LIMIT 50`, Date.now() - 300_000).all<{ job_id: string; step: number }>();
  for (const row of results) {
    await env.JOBS.send({ jobId: row.job_id, step: row.step });
    await store.sql("UPDATE outbox SET sent_at=? WHERE job_id=? AND step=?", Date.now(), row.job_id, row.step).run();
  }
}
export async function recover(env: Env) {
  const store = new Store(env), now = Date.now();
  const { results } = await store.sql("SELECT * FROM jobs WHERE status='running' AND lease_until<?", now).all<JobRow>();
  for (const row of results) {
    if (row.attempts >= 4) await failJob(env, row, "任务多次中断，已停止自动重试。", true);
    else await env.DB.batch([
      store.sql("UPDATE jobs SET status='queued',lease_token=NULL,lease_until=NULL WHERE id=? AND status='running' AND lease_until<?", row.id, now),
      store.sql("UPDATE outbox SET sent_at=NULL WHERE job_id=? AND step=?", row.id, row.step),
    ]);
  }
  await env.DB.batch([
    store.sql("DELETE FROM sessions WHERE expires_at<?", now),
    store.sql("DELETE FROM login_attempts WHERE expires_at<?", now),
    store.sql("DELETE FROM outbox WHERE job_id IN (SELECT id FROM jobs WHERE status IN ('succeeded','failed'))"),
  ]);
  await dispatch(env);
}
async function failJob(env: Env, row: JobRow, message: string, expired = false) {
  const store = new Store(env);
  const changed = await store.sql(`UPDATE jobs SET status='failed',error=?,lease_token=NULL,lease_until=NULL,updated_at=?
    WHERE id=? AND status='running' AND lease_token=? ${expired ? "AND lease_until<?" : ""}`,
    message, new Date().toISOString(), row.id, row.lease_token, ...(expired ? [Date.now()] : [])).run();
  if (!changed.meta.changes) return;
  const state = JSON.parse(row.state) as SyncState;
  if (state.snapshotId) {
    const snapshot = await store.snapshot(state.snapshotId);
    if (snapshot) {
      snapshot.mediaStatus = "failed"; snapshot.mediaError = message;
      await store.writeSnapshot(snapshot);
      await store.backup(snapshot).catch(error => console.error("[backup] failure state", error));
    }
  }
  await store.log({ scope: row.stage === "media" ? "media" : "b50", level: "error", action: "job-failed", message, ...(state.snapshotId ? { snapshotId: state.snapshotId } : {}) });
}
export async function consume(env: Env, batch: MessageBatch<JobMessage>) {
  if (env.MUTATIONS_ENABLED === "false") { batch.retryAll({ delaySeconds: 60 }); return; }
  for (const message of batch.messages) {
    const store = new Store(env), lease = crypto.randomUUID(), now = Date.now();
    // A lease lasts longer than a consumer invocation. Claims also serialize
    // invocations if a redelivery overlaps a deployment or runtime restart.
    const row = await store.sql(`UPDATE jobs SET status='running',lease_token=?,lease_until=?,attempts=attempts+1,updated_at=?
      WHERE id=? AND step=? AND status='queued'
      AND NOT EXISTS(SELECT 1 FROM jobs WHERE status='running' AND lease_until>?) RETURNING *`,
      lease, now + 20 * 60_000, new Date(now).toISOString(), message.body.jobId, message.body.step, now).first<JobRow>();
    if (!row) {
      const current = await store.sql("SELECT status,step FROM jobs WHERE id=?", message.body.jobId).first<JobRow>();
      if (current?.step === message.body.step && (current.status === "queued" || current.status === "running")) message.retry({ delaySeconds: 60 });
      else message.ack();
      continue;
    }
    try {
      const next = await runStep(env, row, async state => {
        const written = await store.sql("UPDATE jobs SET state=?,updated_at=? WHERE id=? AND lease_token=? AND status='running'", JSON.stringify(state), new Date().toISOString(), row.id, lease).run();
        if (!written.meta.changes) throw new Error("Task lease lost");
        row.state = JSON.stringify(state);
      });
      await env.DB.batch([
        store.sql(`UPDATE jobs SET status=?,stage=?,state=?,result=?,error=NULL,step=step+1,attempts=0,lease_token=NULL,lease_until=NULL,updated_at=?
          WHERE id=? AND step=? AND lease_token=?`, next.result ? "succeeded" : "queued", next.stage, JSON.stringify(next.state), next.result ? JSON.stringify(next.result) : null, new Date().toISOString(), row.id, row.step, lease),
        store.sql("DELETE FROM outbox WHERE job_id=? AND step=?", row.id, row.step),
        store.sql("INSERT OR IGNORE INTO outbox(job_id,step) SELECT id,step FROM jobs WHERE id=? AND status='queued'", row.id),
      ]);
      message.ack();
      await dispatch(env).catch(error => console.error("[outbox] deferred", error));
    } catch (error) {
      console.error("[job] step failed", row.id, row.stage, error);
      const reason = error instanceof Error ? error.message : "同步失败。";
      if (row.attempts >= 4 || (error instanceof AppError && error.status < 500)) {
        await failJob(env, row, reason);
        message.ack();
      } else {
        await store.sql("UPDATE jobs SET status='queued',lease_token=NULL,lease_until=NULL,error=?,updated_at=? WHERE id=? AND lease_token=?", reason, new Date().toISOString(), row.id, lease).run();
        message.retry({ delaySeconds: 30 * row.attempts });
      }
    }
  }
}
