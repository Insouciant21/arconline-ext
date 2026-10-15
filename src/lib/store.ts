import { b50Fingerprint } from "./b50";
import { getConfig, getLocalDate } from "./config";
import type { Env } from "./environment";
import { publicAssetUrl, putSnapshot } from "./r2";
import type { B50Snapshot, Best50Score, LogEntry, PotentialHistoryPoint } from "./types";

export class Store {
  constructor(readonly env: Env) {}
  sql(query: string, ...values: (string | number | null)[]) { return this.env.DB.prepare(query).bind(...values); }
  async snapshots() {
    const { results } = await this.sql("SELECT body FROM snapshots ORDER BY fetched_at DESC, id DESC").all<{ body: string }>();
    return this.enrich(results.map(row => JSON.parse(row.body) as B50Snapshot));
  }
  async snapshot(id: string) {
    const row = await this.sql("SELECT body FROM snapshots WHERE id = ?", id).first<{ body: string }>();
    return row ? JSON.parse(row.body) as B50Snapshot : null;
  }
  async latest() {
    const row = await this.sql("SELECT body FROM snapshots ORDER BY fetched_at DESC, id DESC LIMIT 1").first<{ body: string }>();
    return row ? (await this.enrich([JSON.parse(row.body)]))[0] : null;
  }
  async enrich(snapshots: B50Snapshot[]) {
    const aliases = await this.cache<number>("alias");
    return snapshots.map(snapshot => ({ ...snapshot,
      ...(snapshot.potentialImageKey ? { potentialImageUrl: publicAssetUrl(this.env, snapshot.potentialImageKey) } : {}),
      user: { ...snapshot.user, ...(snapshot.user.avatarImageKey ? { avatarImageUrl: publicAssetUrl(this.env, snapshot.user.avatarImageKey) } : {}) },
      best50: snapshot.best50.map(score => ({ ...score,
        difficultyAlias: score.difficultyAlias ?? aliases[`${score.songId}:${score.difficulty}`],
        ...(score.imageKey ? { imageUrl: publicAssetUrl(this.env, score.imageKey) } : {}),
      })),
    }));
  }
  async writeSnapshot(snapshot: B50Snapshot) {
    const date = getLocalDate(snapshot.fetchedAt, getConfig(this.env).timezone);
    await this.env.DB.batch([
      this.sql(`INSERT INTO snapshots(id,fetched_at,local_date,potential,fingerprint,body) VALUES(?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET fetched_at=excluded.fetched_at,local_date=excluded.local_date,
        potential=excluded.potential,fingerprint=excluded.fingerprint,body=excluded.body,backed_up=0`,
        snapshot.id, snapshot.fetchedAt, date, snapshot.potential, b50Fingerprint(snapshot), JSON.stringify(snapshot)),
      this.sql(`INSERT INTO ptt_points(id,local_date,fetched_at,potential,snapshot_id) VALUES(?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET local_date=excluded.local_date,fetched_at=excluded.fetched_at,potential=excluded.potential`,
        `snapshot:${snapshot.id}`, date, snapshot.fetchedAt, snapshot.potential, snapshot.id),
    ]);
  }
  async backup(snapshot: B50Snapshot) {
    await putSnapshot(this.env, snapshot);
    await this.sql("UPDATE snapshots SET backed_up=1 WHERE id=? AND body=?", snapshot.id, JSON.stringify(snapshot)).run();
  }
  async history() {
    const { results } = await this.sql(`SELECT * FROM (
      SELECT local_date AS date,potential,snapshot_id AS snapshotId,fetched_at AS fetchedAt,source,
      ROW_NUMBER() OVER(PARTITION BY local_date ORDER BY potential DESC,fetched_at DESC,id DESC) AS rank
      FROM ptt_points) WHERE rank=1 ORDER BY date`).all<PotentialHistoryPoint>();
    return results.map(({ date, potential, snapshotId, fetchedAt, source }) => ({ date, potential, snapshotId, fetchedAt, ...(source === "lowiro" ? { source } : {}) }));
  }
  async mergeOfficial(points: Array<{ timePlayed: number; potential: number }>) {
    for (let i = 0; i < points.length; i += 80) {
      await this.env.DB.batch(points.slice(i, i + 80).map(point => {
        const fetchedAt = new Date(point.timePlayed).toISOString();
        return this.sql(`INSERT INTO ptt_points(id,local_date,fetched_at,potential,snapshot_id,source) VALUES(?,?,?,?,?,'lowiro')
          ON CONFLICT(id) DO UPDATE SET potential=excluded.potential`, `lowiro:${fetchedAt}`,
          getLocalDate(fetchedAt, getConfig(this.env).timezone), fetchedAt, point.potential, "");
      }));
    }
    const total = await this.sql("SELECT COUNT(*) AS n FROM ptt_points WHERE source='lowiro'").first<number>("n");
    return { received: points.length, total: total || 0 };
  }
  async cache<T>(kind: string) {
    const { results } = await this.sql("SELECT key,body FROM cache WHERE kind=?", kind).all<{ key: string; body: string }>();
    return Object.fromEntries(results.map(row => [row.key, JSON.parse(row.body) as T])) as Record<string, T>;
  }
  async putCache(kind: string, key: string, value: unknown) {
    await this.sql("INSERT INTO cache(kind,key,body) VALUES(?,?,?) ON CONFLICT(kind,key) DO UPDATE SET body=excluded.body", kind, key, JSON.stringify(value)).run();
  }
  async aliases(scores: Best50Score[]) {
    const statements = scores.filter(score => score.difficultyAlias !== undefined).map(score =>
      this.sql("INSERT INTO cache(kind,key,body) VALUES('alias',?,?) ON CONFLICT(kind,key) DO UPDATE SET body=excluded.body",
        `${score.songId}:${score.difficulty}`, JSON.stringify(score.difficultyAlias)));
    if (statements.length) await this.env.DB.batch(statements);
  }
  async log(input: Omit<LogEntry, "id" | "timestamp">) {
    const timestamp = new Date().toISOString();
    const entry = { ...input, timestamp, id: `${timestamp}-${crypto.randomUUID()}` };
    await this.env.DB.batch([
      this.sql("INSERT INTO logs(id,timestamp,body) VALUES(?,?,?)", entry.id, timestamp, JSON.stringify(entry)),
      this.sql("DELETE FROM logs WHERE id IN (SELECT id FROM logs ORDER BY timestamp DESC,id DESC LIMIT -1 OFFSET 500)"),
    ]);
  }
  async logs() {
    const { results } = await this.sql("SELECT body FROM logs ORDER BY timestamp DESC,id DESC LIMIT 500").all<{ body: string }>();
    return results.map(row => JSON.parse(row.body) as LogEntry);
  }
  async exportArchive() {
    const snapshots = (await this.snapshots()).reverse();
    const history = await this.history();
    const files: Record<string, string> = {
      "b50-history.json": JSON.stringify(snapshots, null, 2),
      "ptt-history.json": JSON.stringify(history, null, 2),
      "b50-history.csv": buildB50HistoryCsv(snapshots),
      "ptt-history.csv": buildPttHistoryCsv(history),
    };
    for (const [name, body] of Object.entries(files)) await this.env.ARCHIVE.put(`exports/${name}`, body + "\n", {
      httpMetadata: { contentType: name.endsWith("csv") ? "text/csv; charset=utf-8" : "application/json; charset=utf-8", cacheControl: "no-cache" },
    });
  }
}
function csv(value: string | number) { const text = String(value); return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text; }
export function buildB50HistoryCsv(snapshots: B50Snapshot[]) {
  return ["snapshot_id,fetched_at,trigger,potential,weighted_potential,rank,song_id,difficulty,rating,score,clear_type",
    ...snapshots.flatMap(s => s.best50.map((score, i) => [s.id,s.fetchedAt,s.trigger,s.potential,s.weightedPotential,i+1,score.songId,score.difficulty,score.rating,score.score,score.clearType].map(csv).join(",")))].join("\n");
}
export function buildPttHistoryCsv(points: PotentialHistoryPoint[]) {
  return ["date,potential,snapshot_id,fetched_at", ...points.map(p => [p.date,p.potential,p.snapshotId,p.fetchedAt].map(csv).join(","))].join("\n");
}
