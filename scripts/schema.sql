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
