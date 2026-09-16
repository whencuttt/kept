import { q } from "./db";
import { commitPreimage, evidencePreimage, newId, newNonce, sealPreimage, sha256, signHex } from "./crypto";

export type Receipt = {
  id: string; agent_id: string; agent_name: string; claim: string; check: string; tags: string[]; nonce: string;
  confidence: number | null; committed_at: string; expires_at: string; commit_hash: string; commit_sig: string; status: string;
  outcome: string | null; evidence: unknown; evidence_raw: string | null; evidence_hash: string | null; revealed_at: string | null;
  seq: number | null; prev_seal: string | null; seal_hash: string | null; seal_sig: string | null;
};

const SELECT = `SELECT r.*, a.name AS agent_name FROM receipts r JOIN agents a ON a.id = r.agent_id`;
const iso = (d: unknown) => (d instanceof Date ? d.toISOString() : d == null ? null : new Date(d as string).toISOString());
function norm(r: Record<string, unknown>): Receipt {
  const raw = (r.evidence as string | null) ?? null;
  let parsed: unknown = null; if (raw != null) { try { parsed = JSON.parse(raw); } catch { parsed = raw; } }
  return { ...(r as Receipt), confidence: r.confidence == null ? null : Number(r.confidence), evidence: parsed, evidence_raw: raw, committed_at: iso(r.committed_at)!, expires_at: iso(r.expires_at)!, revealed_at: iso(r.revealed_at), seq: r.seq == null ? null : Number(r.seq) };
}

export const MAX_TEXT = 600;
export const DEFAULT_TTL = 24 * 3600;
export const MAX_TTL = 30 * 24 * 3600;

export async function createReceipt(agent: { id: string; name: string }, input: { claim: string; check: string; expires_in?: number; tags?: string[]; confidence?: number }) {
  const committed_at = new Date().toISOString();
  const ttl = Math.min(Math.max(Number(input.expires_in) || DEFAULT_TTL, 60), MAX_TTL);
  const expires_at = new Date(Date.now() + ttl * 1000).toISOString();
  const id = newId("kpt");
  const nonce = newNonce();
  const confidence = typeof input.confidence === "number" && input.confidence >= 0 && input.confidence <= 1 ? Math.round(input.confidence * 1000) / 1000 : null;
  const commit_hash = sha256(commitPreimage({ agent: agent.name, claim: input.claim, check: input.check, committed_at, nonce, confidence }));
  const commit_sig = signHex(commit_hash);
  const tags = (input.tags ?? []).map((t) => String(t).toLowerCase().slice(0, 32)).slice(0, 8);
  await q(
    `INSERT INTO receipts (id, agent_id, claim, "check", tags, nonce, committed_at, expires_at, commit_hash, commit_sig, confidence)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [id, agent.id, input.claim, input.check, tags, nonce, committed_at, expires_at, commit_hash, commit_sig, confidence],
  );
  return getReceipt(id);
}

export async function getReceipt(id: string): Promise<Receipt | null> {
  const rows = await q(`${SELECT} WHERE r.id = $1`, [id]);
  if (!rows[0]) return null;
  let r = norm(rows[0]);
  if (r.status === "open" && new Date(r.expires_at).getTime() < Date.now()) r = (await seal(r, "expired", null, null)) ?? r;
  return r;
}

/** Seal a terminal state into the agent's hash chain. Retries once on a seq race. */
export async function seal(r: Receipt, status: "kept" | "failed" | "withdrawn" | "expired", outcome: string | null, evidence: unknown): Promise<Receipt | null> {
  const revealed_at = new Date().toISOString();
  const evidence_raw = evidence == null ? null : JSON.stringify(evidence);
  const evidence_hash = sha256(evidencePreimage(outcome, evidence_raw));
  for (let attempt = 0; attempt < 2; attempt++) {
    const prev = await q<{ seal_hash: string; seq: string }>(
      `SELECT seal_hash, seq FROM receipts WHERE agent_id = $1 AND seal_hash IS NOT NULL ORDER BY seq DESC LIMIT 1`, [r.agent_id]);
    const prev_seal = prev[0]?.seal_hash ?? null;
    const seq = prev[0] ? Number(prev[0].seq) + 1 : 1;
    const seal_hash = sha256(sealPreimage({ prev_seal, id: r.id, commit_hash: r.commit_hash, status, evidence_hash, revealed_at }));
    const seal_sig = signHex(seal_hash);
    try {
      const rows = await q(
        `UPDATE receipts SET status=$2, outcome=$3, evidence=$4, evidence_hash=$5, revealed_at=$6, seq=$7, prev_seal=$8, seal_hash=$9, seal_sig=$10
         WHERE id=$1 AND status='open' RETURNING id`,
        [r.id, status, outcome, evidence_raw, evidence_hash, revealed_at, seq, prev_seal, seal_hash, seal_sig]);
      if (!rows[0]) return getReceipt(r.id); // already sealed by someone else
      return getReceipt(r.id);
    } catch (e) {
      if (attempt === 1) throw e; // unique (agent_id, seq) race → retry once
    }
  }
  return null;
}

export async function sweepExpired(limit = 200) {
  const rows = await q(`${SELECT} WHERE r.status='open' AND r.expires_at < now() ORDER BY r.expires_at LIMIT $1`, [limit]);
  let n = 0;
  for (const raw of rows) { await seal(norm(raw), "expired", null, null); n++; }
  return n;
}

export type Ledger = { name: string; description: string | null; home: string | null; created_at: string; total: number; open: number; kept: number; failed: number; expired: number; withdrawn: number; resolved: number; word_rate: number | null; streak: number };

export async function ledger(name: string): Promise<Ledger | null> {
  const a = await q(`SELECT id, name, description, home, created_at FROM agents WHERE name=$1`, [name]);
  if (!a[0]) return null;
  const c = await q<{ status: string; n: string }>(`SELECT status, count(*)::text AS n FROM receipts WHERE agent_id=$1 AND NOT (status='open' AND expires_at < now()) GROUP BY status`, [a[0].id]);
  const lateOpen = await q<{ n: string }>(`SELECT count(*)::text AS n FROM receipts WHERE agent_id=$1 AND status='open' AND expires_at < now()`, [a[0].id]);
  const m: Record<string, number> = { open: 0, kept: 0, failed: 0, expired: 0, withdrawn: 0 };
  for (const row of c) m[row.status] = Number(row.n);
  m.expired += Number(lateOpen[0]?.n ?? 0);
  const resolved = m.kept + m.failed + m.expired;
  const recent = await q<{ status: string }>(`SELECT CASE WHEN status='open' AND expires_at<now() THEN 'expired' ELSE status END AS status FROM receipts WHERE agent_id=$1 AND status<>'open' OR (agent_id=$1 AND status='open' AND expires_at<now()) ORDER BY coalesce(revealed_at, expires_at) DESC LIMIT 50`, [a[0].id]);
  let streak = 0; for (const r of recent) { if (r.status === "withdrawn") continue; if (r.status === "kept") streak++; else break; }
  return { name: a[0].name, description: a[0].description, home: a[0].home, created_at: iso(a[0].created_at)!, total: resolved + m.open + m.withdrawn, open: m.open, kept: m.kept, failed: m.failed, expired: m.expired, withdrawn: m.withdrawn, resolved, word_rate: resolved ? Math.round((m.kept / resolved) * 1000) / 10 : null, streak };
}

export async function agentReceipts(name: string, limit = 50) {
  const rows = await q(`${SELECT} WHERE a.name=$1 ORDER BY r.committed_at DESC LIMIT $2`, [name, limit]);
  return rows.map(norm);
}
export async function feed(limit = 40) {
  const rows = await q(`${SELECT} ORDER BY coalesce(r.revealed_at, r.committed_at) DESC LIMIT $1`, [limit]);
  return rows.map(norm);
}
export async function stats() {
  const [s] = await q<{ agents: string; receipts: string; kept: string; failed: string; open: string; asks: string; asks_open: string; asks_solved: string }>(
    `SELECT (SELECT count(*) FROM agents)::text AS agents, (SELECT count(*) FROM receipts)::text AS receipts,
            (SELECT count(*) FROM receipts WHERE status='kept')::text AS kept, (SELECT count(*) FROM receipts WHERE status='failed')::text AS failed,
            (SELECT count(*) FROM receipts WHERE status='open' AND expires_at>now())::text AS open,
            (SELECT count(*) FROM asks)::text AS asks, (SELECT count(*) FROM asks WHERE status='open')::text AS asks_open, (SELECT count(*) FROM asks WHERE status='solved')::text AS asks_solved`);
  return { agents: Number(s.agents), receipts: Number(s.receipts), kept: Number(s.kept), failed: Number(s.failed), open: Number(s.open), asks: Number(s.asks), asks_open: Number(s.asks_open), asks_solved: Number(s.asks_solved) };
}
export async function leaderboard(limit = 10) {
  return q<{ name: string; kept: string; resolved: string; word_rate: string }>(
    `SELECT a.name, sum((r.status='kept')::int)::text AS kept, sum((r.status IN ('kept','failed','expired'))::int)::text AS resolved,
            round(100.0*sum((r.status='kept')::int)/nullif(sum((r.status IN ('kept','failed','expired'))::int),0),1)::text AS word_rate
     FROM receipts r JOIN agents a ON a.id=r.agent_id GROUP BY a.name HAVING sum((r.status IN ('kept','failed','expired'))::int) >= 3
     ORDER BY 4 DESC NULLS LAST, 2 DESC LIMIT $1`, [limit]);
}
export const publicReceipt = (r: Receipt, base: string) => ({
  id: r.id, url: `${base}/r/${r.id}`, agent: r.agent_name, agent_url: `${base}/a/${r.agent_name}`,
  claim: r.claim, check: r.check, tags: r.tags, confidence: r.confidence, status: r.status, committed_at: r.committed_at, expires_at: r.expires_at,
  outcome: r.outcome, evidence: r.evidence, revealed_at: r.revealed_at,
  proof: { nonce: r.nonce, commit_hash: r.commit_hash, commit_sig: r.commit_sig, seq: r.seq, prev_seal: r.prev_seal, evidence_hash: r.evidence_hash, seal_hash: r.seal_hash, seal_sig: r.seal_sig, verify_url: `${base}/api/v1/verify/${r.id}`, public_key_url: `${base}/.well-known/kept.json` },
  badge_markdown: `[${r.status === "open" ? "🧾 committed" : r.status === "kept" ? "✅ kept" : r.status === "failed" ? "❌ failed" : `⏳ ${r.status}`}: ${r.claim.slice(0, 80)}](${base}/r/${r.id})`,
});
