CREATE TABLE snapshots (
  id TEXT PRIMARY KEY, fetched_at TEXT NOT NULL, local_date TEXT NOT NULL,
  potential REAL NOT NULL, fingerprint TEXT NOT NULL, body TEXT NOT NULL,
  backed_up INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX snapshots_time ON snapshots(fetched_at DESC);
CREATE TABLE ptt_points (
  id TEXT PRIMARY KEY, local_date TEXT NOT NULL, fetched_at TEXT NOT NULL,
  potential REAL NOT NULL, snapshot_id TEXT NOT NULL DEFAULT '', source TEXT
);
CREATE INDEX ptt_date ON ptt_points(local_date, potential DESC, fetched_at DESC);
CREATE TABLE cache (
  kind TEXT NOT NULL, key TEXT NOT NULL, body TEXT NOT NULL,
  PRIMARY KEY(kind, key)
);
CREATE TABLE logs (
  id TEXT PRIMARY KEY, timestamp TEXT NOT NULL, body TEXT NOT NULL
);
CREATE INDEX logs_time ON logs(timestamp DESC);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL
);
CREATE TABLE login_attempts (
  key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
CREATE TABLE jobs (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, trigger TEXT NOT NULL,
  status TEXT NOT NULL, stage TEXT NOT NULL DEFAULT 'fetch', step INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  lease_token TEXT, lease_until INTEGER, state TEXT NOT NULL DEFAULT '{}',
  result TEXT, error TEXT, dedupe_key TEXT UNIQUE
);
CREATE INDEX jobs_status ON jobs(status, created_at);
CREATE TABLE outbox (
  job_id TEXT NOT NULL, step INTEGER NOT NULL, sent_at INTEGER,
  PRIMARY KEY(job_id, step), FOREIGN KEY(job_id) REFERENCES jobs(id)
);
CREATE TABLE migration_runs (
  id TEXT PRIMARY KEY, completed_at TEXT NOT NULL, report TEXT NOT NULL
);
