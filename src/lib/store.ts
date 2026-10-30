import { b50Fingerprint } from "./b50";
import { getConfig, getLocalDate } from "./config";
import type { Env } from "./environment";
import { publicAssetUrl, putSnapshot } from "./r2";
import type { B50Snapshot, Best50Score, LogEntry, PotentialHistoryPoint, SnapshotSummary } from "./types";

export interface CacheWrite { kind: string; key: string; value: unknown; }

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
  async snapshotSummaries(): Promise<SnapshotSummary[]> {
    // Summary columns only: the list view must not transfer or parse every
    // snapshot's full B50 body.
    const { results } = await this.sql(`SELECT id, fetched_at AS fetchedAt, potential,
      json_extract(body, '$.weightedPotential') AS weightedPotential,
      json_extract(body, '$.trigger') AS trigger,
      json_extract(body, '$.mediaStatus') AS mediaStatus,
      json_array_length(body, '$.best50') AS entries
      FROM snapshots ORDER BY fetched_at DESC, id DESC`)
      .all<{ id: string; fetchedAt: string; potential: number; weightedPotential: number; trigger: B50Snapshot["trigger"]; mediaStatus: B50Snapshot["mediaStatus"]; entries: number }>();
    return results.map(({ mediaStatus, ...summary }) => ({ ...summary, ...(mediaStatus ? { mediaStatus } : {}) }));
  }
  async enrich(snapshots: B50Snapshot[]) {
    // Only legacy BYD/INS rows need an alias lookup. Current API responses
    // already carry it; other difficulties don't use aliases.
    const keys = [...new Set(snapshots.flatMap(snapshot => snapshot.best50
      .filter(score => score.difficulty === 3 && score.difficultyAlias == null)
      .map(score => `${score.songId}:${score.difficulty}`)))];
    const statements: D1PreparedStatement[] = [];
    for (let index = 0; index < keys.length; index += 100) {
      const batch = keys.slice(index, index + 100);
      statements.push(this.sql(`SELECT key,body FROM cache WHERE kind='alias' AND key IN (${batch.map(() => "?").join(",")})`, ...batch));
    }
    const aliases: Record<string, number> = {};
    if (statements.length) {
      const batches = await this.env.DB.batch<{ key: string; body: string }>(statements);
      for (const { results } of batches) for (const row of results) aliases[row.key] = JSON.parse(row.body) as number;
    }
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
      this.sql("DELETE FROM cache WHERE kind='export' AND key='fingerprint'"),
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
    const { results } = await this.sql("SELECT id,potential FROM ptt_points WHERE source='lowiro'").all<{ id: string; potential: number }>();
    const existing = new Map(results.map(point => [point.id, point.potential]));
    const incoming = new Map(points.map(point => {
      const fetchedAt = new Date(point.timePlayed).toISOString();
      return [`lowiro:${fetchedAt}`, { ...point, fetchedAt }] as const;
    }));
    const changed = [...incoming].filter(([id, point]) => existing.get(id) !== point.potential);
    const timezone = getConfig(this.env).timezone;
    for (let i = 0; i < changed.length; i += 80) {
      await this.env.DB.batch([...changed.slice(i, i + 80).map(([id, point]) => {
        return this.sql(`INSERT INTO ptt_points(id,local_date,fetched_at,potential,snapshot_id,source) VALUES(?,?,?,?,?,'lowiro')
          ON CONFLICT(id) DO UPDATE SET potential=excluded.potential`, id,
          getLocalDate(point.fetchedAt, timezone), point.fetchedAt, point.potential, "");
      }), this.sql("DELETE FROM cache WHERE kind='export' AND key='fingerprint'")]);
    }
    return { received: points.length, total: existing.size + [...incoming.keys()].filter(id => !existing.has(id)).length };
  }
  async cache<T>(kind: string, keys?: string[]) {
    let results: Array<{ key: string; body: string }>;
    if (keys) {
      const unique = [...new Set(keys)], statements: D1PreparedStatement[] = [];
      // The cache kind occupies one of D1's 100 bound parameters.
      for (let index = 0; index < unique.length; index += 99) {
        const batch = unique.slice(index, index + 99);
        statements.push(this.sql(`SELECT key,body FROM cache WHERE kind=? AND key IN (${batch.map(() => "?").join(",")})`, kind, ...batch));
      }
      results = statements.length ? (await this.env.DB.batch<{ key: string; body: string }>(statements)).flatMap(batch => batch.results) : [];
    } else {
      ({ results } = await this.sql("SELECT key,body FROM cache WHERE kind=?", kind).all<{ key: string; body: string }>());
    }
    return Object.fromEntries(results.map(row => [row.key, JSON.parse(row.body) as T])) as Record<string, T>;
  }
  async putCache(kind: string, key: string, value: unknown) {
    await this.sql("INSERT INTO cache(kind,key,body) VALUES(?,?,?) ON CONFLICT(kind,key) DO UPDATE SET body=excluded.body", kind, key, JSON.stringify(value)).run();
  }
  async putCaches(entries: CacheWrite[]) {
    if (entries.length) await this.env.DB.batch(entries.map(({ kind, key, value }) =>
      this.sql("INSERT INTO cache(kind,key,body) VALUES(?,?,?) ON CONFLICT(kind,key) DO UPDATE SET body=excluded.body", kind, key, JSON.stringify(value))));
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
    // Counts detect new rows; writes also invalidate the fingerprint when an
    // existing snapshot or official PTT point changes in place.
    const [snapshots, points] = await Promise.all([
      this.sql("SELECT COUNT(*) AS n, MAX(rowid) AS m FROM snapshots").first<{ n: number; m: number }>(),
      this.sql("SELECT COUNT(*) AS n, MAX(rowid) AS m FROM ptt_points").first<{ n: number; m: number }>(),
    ]);
    const fingerprint = `${snapshots?.n ?? 0}:${snapshots?.m ?? 0}:${points?.n ?? 0}:${points?.m ?? 0}`;
    if ((await this.cache<string>("export")).fingerprint === fingerprint) return;
    const [snapshotsToExport, history] = await Promise.all([this.snapshots(), this.history()]);
    const all = snapshotsToExport.reverse();
    const files: Record<string, string> = {
      "b50-history.json": JSON.stringify(all, null, 2),
      "ptt-history.json": JSON.stringify(history, null, 2),
      "b50-history.csv": buildB50HistoryCsv(all),
      "ptt-history.csv": buildPttHistoryCsv(history),
    };
    const writes = await Promise.allSettled(Object.entries(files).map(([name, body]) => this.env.ARCHIVE.put(`exports/${name}`, body + "\n", {
      httpMetadata: { contentType: name.endsWith("csv") ? "text/csv; charset=utf-8" : "application/json; charset=utf-8", cacheControl: "no-cache" },
    })));
    const failure = writes.find(write => write.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
    await this.putCache("export", "fingerprint", fingerprint);
  }
}
function csv(value: string | number) { const text = String(value); return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text; }
function buildB50HistoryCsv(snapshots: B50Snapshot[]) {
  return ["snapshot_id,fetched_at,trigger,potential,weighted_potential,rank,song_id,difficulty,rating,score,clear_type",
    ...snapshots.flatMap(s => s.best50.map((score, i) => [s.id,s.fetchedAt,s.trigger,s.potential,s.weightedPotential,i+1,score.songId,score.difficulty,score.rating,score.score,score.clearType].map(csv).join(",")))].join("\n");
}
function buildPttHistoryCsv(points: PotentialHistoryPoint[]) {
  return ["date,potential,snapshot_id,fetched_at", ...points.map(p => [p.date,p.potential,p.snapshotId,p.fetchedAt].map(csv).join(","))].join("\n");
}
