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

ALTER TABLE receipts ADD COLUMN IF NOT EXISTS confidence numeric(4,3);

ALTER TABLE receipts ADD COLUMN IF NOT EXISTS self_controlled boolean NOT NULL DEFAULT false;

-- The runtime trace key an agent registers for its signed tool-call chain (examples/trace-convention.md).
ALTER TABLE agents ADD COLUMN IF NOT EXISTS trace_kid text;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS trace_public_key_pem text;

-- One row per signed tool call. The interpretation, when the agent records one, lands on the same row.
CREATE TABLE IF NOT EXISTS trace_links (
  agent_id           uuid NOT NULL REFERENCES agents(id),
  session_id         text NOT NULL,
  step_id            text NOT NULL,
  ts                 timestamptz NOT NULL,
  tool_name          text NOT NULL DEFAULT '',
  tool_output_hashes text[] NOT NULL DEFAULT '{}',
  field_hashes       jsonb,
  prev_interp_hash   text NOT NULL DEFAULT '',
  link               text NOT NULL,
  link_sig           text NOT NULL,
  kid                text NOT NULL,
  interp             jsonb,
  interp_hash        text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agent_id, session_id, step_id)
);
CREATE INDEX IF NOT EXISTS trace_links_agent_ts ON trace_links (agent_id, ts DESC);

-- The coverage boundary the check actually sees: a string, or the canonical JSON of the typed tuple
-- {source, selector, window, credential}. Sealed into the commit hash under kept-commit-v3.
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS observes text;

-- Declared at commit: only the committing agent could observe this check. A gate must not act on it.
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS self_observable boolean NOT NULL DEFAULT false;

-- self_observable is a THREE-valued declaration: true, false, or NULL = never declared.
-- It shipped as `NOT NULL DEFAULT false`, which made "the agent did not say" indistinguishable from
-- "the agent said no" — the ledger was rendering its own default as if it were the agent's word.
-- Absence is now NULL and is reported as `undeclared` everywhere.
ALTER TABLE receipts ALTER COLUMN self_observable DROP DEFAULT;
ALTER TABLE receipts ALTER COLUMN self_observable DROP NOT NULL;
-- HISTORICAL BACKFILL, correct only because of the old default. A stored `true` can only have come
-- from an explicit declaration, so it is kept; a stored `false` is unrecoverable — it is either a real
-- `false` or the default nobody asked for — so it becomes NULL rather than be presented as a claim the
-- agent may never have made. This statement is a no-op once the column is nullable and callers write
-- NULL for absence, but migrate.ts replays this whole file: it must never widen to touch new rows.
UPDATE receipts SET self_observable = NULL WHERE self_observable = false AND committed_at < timestamptz '2026-09-16T22:00:00Z';
-- One row IS recoverable: kpt_5wxjlmntu6 was committed with an explicit `self_observable: false`
-- (its ClawHub half is a genuine third-party source), recorded in the run log at the time. Put the
-- agent's own word back rather than leave it reading `undeclared`. No verdict changes: it carries a
-- typed observes whose credential is not its owner.
UPDATE receipts SET self_observable = false WHERE id = 'kpt_5wxjlmntu6' AND self_observable IS NULL;
