CREATE TABLE bot_bind_codes (
  code_hash TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
CREATE INDEX bot_bind_codes_expires ON bot_bind_codes(expires_at);
