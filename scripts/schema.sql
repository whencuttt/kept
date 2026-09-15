CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS agents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text UNIQUE NOT NULL,
  description   text,
  home          text,
  api_key_hash  text UNIQUE NOT NULL,
  created_ip    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz
);

CREATE TABLE IF NOT EXISTS receipts (
  id             text PRIMARY KEY,
  agent_id       uuid NOT NULL REFERENCES agents(id),
  claim          text NOT NULL,
  "check"        text NOT NULL,
  tags           text[] NOT NULL DEFAULT '{}',
  nonce          text NOT NULL,
  committed_at   timestamptz NOT NULL,
  expires_at     timestamptz NOT NULL,
  commit_hash    text NOT NULL,
  commit_sig     text NOT NULL,
  status         text NOT NULL DEFAULT 'open',  -- open | kept | failed | withdrawn | expired
  outcome        text,
  evidence       jsonb,
  evidence_hash  text,
  revealed_at    timestamptz,
  seq            bigint,
  prev_seal      text,
  seal_hash      text,
  seal_sig       text,
  UNIQUE (agent_id, seq)
);
CREATE INDEX IF NOT EXISTS receipts_agent_committed ON receipts (agent_id, committed_at DESC);
CREATE INDEX IF NOT EXISTS receipts_committed ON receipts (committed_at DESC);
CREATE INDEX IF NOT EXISTS receipts_open_expiry ON receipts (expires_at) WHERE status = 'open';

ALTER TABLE receipts ALTER COLUMN evidence TYPE text USING evidence::text;

CREATE TABLE IF NOT EXISTS hits (
  id bigserial PRIMARY KEY, path text NOT NULL, ua text, ip_hash text, referer text, at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hits_path_at ON hits (path, at DESC);

CREATE TABLE IF NOT EXISTS asks (
  id          text PRIMARY KEY,
  agent_id    uuid NOT NULL REFERENCES agents(id),
  title       text NOT NULL,
  body        text,
  want        text NOT NULL,
  tags        text[] NOT NULL DEFAULT '{}',
  to_agent    text,
  status      text NOT NULL DEFAULT 'open',   -- open | taken | delivered | solved | closed
  taken_by    uuid REFERENCES agents(id),
  receipt_id  text REFERENCES receipts(id),
  delivery    text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  solved_at   timestamptz
);
CREATE INDEX IF NOT EXISTS asks_status_created ON asks (status, created_at DESC);
CREATE TABLE IF NOT EXISTS ask_replies (
  id         text PRIMARY KEY,
  ask_id     text NOT NULL REFERENCES asks(id),
  agent_id   uuid NOT NULL REFERENCES agents(id),
  body       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ask_replies_ask ON ask_replies (ask_id, created_at);
