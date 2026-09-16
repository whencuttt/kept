import { q } from "./db";
import { canonicalObserves, commitPreimage, commitPreimageVersion, evidencePreimage, newId, newNonce, observesCredential, sealPreimage, sha256, signHex, type ObservesTuple } from "./crypto";

export type Receipt = {
  id: string; agent_id: string; agent_name: string; claim: string; check: string; tags: string[]; nonce: string;
  confidence: number | null; self_controlled: boolean; observes: string | null; self_observable: boolean; committed_at: string; expires_at: string; commit_hash: string; commit_sig: string; status: string;
  outcome: string | null; evidence: unknown; evidence_raw: string | null; evidence_hash: string | null; revealed_at: string | null;
  seq: number | null; prev_seal: string | null; seal_hash: string | null; seal_sig: string | null;
};

const SELECT = `SELECT r.*, a.name AS agent_name FROM receipts r JOIN agents a ON a.id = r.agent_id`;
const iso = (d: unknown) => (d instanceof Date ? d.toISOString() : d == null ? null : new Date(d as string).toISOString());
function norm(r: Record<string, unknown>): Receipt {
  const raw = (r.evidence as string | null) ?? null;
  let parsed: unknown = null; if (raw != null) { try { parsed = JSON.parse(raw); } catch { parsed = raw; } }
  return { ...(r as Receipt), confidence: r.confidence == null ? null : Number(r.confidence), self_controlled: r.self_controlled === true, observes: (r.observes as string | null) ?? null, self_observable: r.self_observable === true, evidence: parsed, evidence_raw: raw, committed_at: iso(r.committed_at)!, expires_at: iso(r.expires_at)!, revealed_at: iso(r.revealed_at), seq: r.seq == null ? null : Number(r.seq) };
}

export const MAX_TEXT = 600;
/** A prior is clamped into [PRIOR_MIN, PRIOR_MAX] before it is sealed: no prior is certainty, and the log score of a certainty that misses is infinite. */
export const PRIOR_MIN = 0.01, PRIOR_MAX = 0.99;
export const clampPrior = (c: number) => Math.min(PRIOR_MAX, Math.max(PRIOR_MIN, Math.round(c * 1000) / 1000));
/** Fewer resolved receipts than this and an agent is listed unranked. */
export const RANK_MIN = 5;
export const DEFAULT_TTL = 24 * 3600;
export const MAX_TTL = 30 * 24 * 3600;

export const EXPIRES_IN_UNIT = `expires_in is a duration in SECONDS (min 60, max ${MAX_TTL} = 30 days). A fully-qualified ISO-8601 instant such as "2026-09-19T14:00:00.250Z" or "2026-09-19T19:30:00+05:30" is also accepted and sealed to the exact millisecond named. An ISO string with NO timezone offset names no instant and is rejected: the ledger will not guess a zone. It is sealed into the receipt and cannot be amended afterwards, so a value that is not understood is rejected, never silently defaulted, clamped or truncated.`;

/** What the caller asked for, once understood. `default` and `seconds` are durations measured from
 *  commit time; `instant` is an absolute moment the caller named, carried as epoch milliseconds so it
 *  is sealed exactly rather than rounded into a whole-second duration. */
export type ExpiresIn = { kind: "default" } | { kind: "seconds"; seconds: number } | { kind: "instant"; atMs: number };
export const DEFAULT_EXPIRES_IN: ExpiresIn = { kind: "default" };
export const secondsExpiresIn = (seconds: number): ExpiresIn => ({ kind: "seconds", seconds });

/** A fully-qualified ISO-8601 instant: date, time, and an EXPLICIT offset (Z, +HH:MM or +HHMM). */
const ISO_INSTANT = /^(\d{4}-\d{2}-\d{2})[Tt](\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d+))?(Z|z|[+-]\d{2}:\d{2}|[+-]\d{4})$/;
/** ISO-8601-shaped but with no offset at all — a local wall-clock reading, not an instant. Matched
 *  separately only so the 400 can say what is missing instead of "not a date". */
const ISO_NO_OFFSET = /^\d{4}-\d{2}-\d{2}(?:[Tt ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?)?$/;

/** Parse the caller's expires_in. Returns a duration or an absolute instant, or `default`.
 *  Rejects rather than substitutes: this value becomes a sealed deadline the agent cannot amend,
 *  and a receipt whose expiry is not the one its author asked for cannot be honestly resolved.
 *  (This function exists because `Number(v) || DEFAULT_TTL` silently turned an ISO date string
 *  into a 24h expiry, and Math.min/Math.max silently clamped out-of-range durations. It rejects
 *  offset-less ISO strings and returns absolute milliseconds because the first version of the fix
 *  still read a zone-less string in the server's local zone and still floored an accepted instant
 *  into whole seconds of duration, sealing up to 1s early.)
 *  NOTE: `null` and an omitted key are deliberately the same path — "no value" either way. A caller
 *  whose upstream produced nothing therefore receives the default, not a 400. */
export function parseExpiresIn(v: unknown): { ok: true; value: ExpiresIn } | { ok: false; error: string } {
  if (v === undefined || v === null) return { ok: true, value: DEFAULT_EXPIRES_IN };
  if (typeof v === "number" || (typeof v === "string" && /^\d+(\.\d+)?$/.test(v.trim()))) {
    const n = Number(v);
    if (!Number.isFinite(n)) return { ok: false, error: `expires_in must be a finite number. ${EXPIRES_IN_UNIT}` };
    if (n < 60) return { ok: false, error: `expires_in ${n} is under the 60s minimum. ${EXPIRES_IN_UNIT}` };
    if (n > MAX_TTL) return { ok: false, error: `expires_in ${n} is over the ${MAX_TTL}s maximum. ${EXPIRES_IN_UNIT}` };
    return { ok: true, value: { kind: "seconds", seconds: Math.floor(n) } };
  }
  if (typeof v === "string") {
    const raw = v.trim();
    const m = ISO_INSTANT.exec(raw);
    if (!m) {
      if (ISO_NO_OFFSET.test(raw))
        return { ok: false, error: `expires_in ${JSON.stringify(raw)} has no timezone offset, so it names no instant — the same string would seal a different moment on a differently-configured server. Add Z or an offset such as +05:30. ${EXPIRES_IN_UNIT}` };
      return { ok: false, error: `expires_in ${JSON.stringify(raw)} is neither a number of seconds nor a fully-qualified ISO-8601 instant. ${EXPIRES_IN_UNIT}` };
    }
    const [, date, hh, mm, ss, frac, offRaw] = m;
    // Sub-millisecond digits are dropped by any JS Date, so accept them only when they are lossless.
    if (frac && frac.length > 3 && /[^0]/.test(frac.slice(3)))
      return { ok: false, error: `expires_in ${JSON.stringify(raw)} carries sub-millisecond precision (.${frac}); Kept seals milliseconds and will not truncate a value you cannot amend. Round it to at most 3 fractional digits. ${EXPIRES_IN_UNIT}` };
    const ms = (frac ?? "").slice(0, 3).padEnd(3, "0");
    const off = offRaw.toUpperCase() === "Z" ? "Z" : offRaw.length === 5 ? `${offRaw.slice(0, 3)}:${offRaw.slice(3)}` : offRaw;
    if (off !== "Z" && (Number(off.slice(1, 3)) > 23 || Number(off.slice(4, 6)) > 59))
      return { ok: false, error: `expires_in ${JSON.stringify(raw)} has an out-of-range timezone offset. ${EXPIRES_IN_UNIT}` };
    const atMs = Date.parse(`${date}T${hh}:${mm}:${ss ?? "00"}.${ms}${off}`);
    if (!Number.isFinite(atMs)) return { ok: false, error: `expires_in ${JSON.stringify(raw)} is not a real date. ${EXPIRES_IN_UNIT}` };
    const away = atMs - Date.now();
    if (away < 60_000) return { ok: false, error: `expires_in ${JSON.stringify(raw)} is in the past or less than 60s away. ${EXPIRES_IN_UNIT}` };
    if (away > MAX_TTL * 1000) return { ok: false, error: `expires_in ${JSON.stringify(raw)} is more than 30 days away. ${EXPIRES_IN_UNIT}` };
    return { ok: true, value: { kind: "instant", atMs } };
  }
  return { ok: false, error: `expires_in must be a number of seconds or a fully-qualified ISO-8601 string. ${EXPIRES_IN_UNIT}` };
}

/** observes: the coverage boundary the check actually sees. Accepted either as a plain sentence or as
 *  the typed tuple {source, selector, window, credential}; both canonicalise to one string, and that one
 *  string is what is sealed. Bounds are on the canonical form, so what is hashed is what was measured. */
export const MIN_OBSERVES = 8, MAX_OBSERVES = 600;
export type ObservesResult = { ok: true; value: string | null } | { ok: false; error: string };
export function parseObserves(raw: unknown): ObservesResult {
  if (raw == null || raw === "") return { ok: true, value: null };
  if (typeof raw === "string") {
    const v = raw.trim();
    if (v.length < MIN_OBSERVES) return { ok: false, error: `observes: name the coverage boundary the check actually sees (${MIN_OBSERVES}+ chars), e.g. "rows in listings visible to the job's own DB role, at the moment of the after-snapshot"` };
    if (v.length > MAX_OBSERVES) return { ok: false, error: `observes must be <= ${MAX_OBSERVES} chars` };
    return { ok: true, value: v };
  }
  if (typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "observes: a string, or an object with source, selector, window, credential" };
  const o = raw as Record<string, unknown>;
  const extra = Object.keys(o).filter((k) => !(["source", "selector", "window", "credential"] as string[]).includes(k));
  if (extra.length) return { ok: false, error: `observes: only source, selector, window, credential are sealed; remove ${extra.join(", ")}` };
  for (const k of Object.keys(o)) if (o[k] != null && typeof o[k] !== "string") return { ok: false, error: `observes.${k} must be a string` };
  const t = o as ObservesTuple;
  if (!String(t.source ?? "").trim() || !String(t.selector ?? "").trim()) return { ok: false, error: "observes: source (what is read) and selector (which part of it) are both required; window and credential are optional" };
  const value = canonicalObserves(t);
  const content = (["source", "selector", "window", "credential"] as const).map((k) => String(t[k] ?? "").trim()).join("").length;
  if (content < MIN_OBSERVES) return { ok: false, error: `observes: too thin to be a boundary (${MIN_OBSERVES}+ chars across its fields)` };
  if (value.length > MAX_OBSERVES) return { ok: false, error: `observes: canonical form must be <= ${MAX_OBSERVES} chars (it is ${value.length})` };
  return { ok: true, value };
}

/** A credential that is the receipt's own agent, or a word meaning "me". */
const SELF_CREDENTIALS = new Set(["self", "me", "my", "mine", "own", "owner", "itself", "this agent", "same agent", "the agent", "the worker", "the job", "the job itself"]);
/** The same-trust-domain rule. A check only the committing agent could see is not independently
 *  observable, so a gate must not act on it: the verdict reads unresolved until a second reader confirms.
 *  Three ways in — the agent declared it, the sealed observes names the agent's own credential, or no
 *  boundary was sealed at all on a receipt the agent alone controls. */
export function selfObservable(r: Receipt): { self_observable: boolean; reason: string | null } {
  const cred = observesCredential(r.observes);
  const owned = cred != null && (() => {
    const n = cred.trim().toLowerCase().replace(/^@/, "").replace(/^agent:/, "").trim();
    return n === r.agent_name.toLowerCase() || SELF_CREDENTIALS.has(n);
  })();
  if (owned) return { self_observable: true, reason: `same-trust-domain rule: observes.credential is "${cred}", the receipt's own agent, so observer and subject are the same party` };
  if (r.self_observable) return { self_observable: true, reason: "same-trust-domain rule: the agent declared self_observable at commit, so only the committing agent could see the check" };
  if (!r.observes && r.self_controlled) return { self_observable: true, reason: "same-trust-domain rule: no observes boundary was sealed and the receipt is self_controlled, so nothing outside the committing agent could see the check" };
  return { self_observable: false, reason: null };
}

export async function createReceipt(agent: { id: string; name: string }, input: { claim: string; check: string; expires_in?: ExpiresIn; tags?: string[]; confidence?: number; self_controlled?: boolean; observes?: string | null; self_observable?: boolean }) {
  // ONE clock read for both sealed timestamps: a second Date.now() below used to add its own drift
  // on top of the truncation, so expires_at was neither the instant asked for nor committed_at + ttl.
  const now = new Date();
  const committed_at = now.toISOString();
  // Never silently substitute a deadline: callers validate with parseExpiresIn and return 400.
  // If an unvalidated value reaches here we throw rather than seal an expiry nobody asked for.
  const e = input.expires_in ?? DEFAULT_EXPIRES_IN;
  if (typeof e !== "object" || e === null || !("kind" in e))
    throw new Error("expires_in must be validated with parseExpiresIn before createReceipt; an unparsed value would seal an expiry nobody asked for");
  // An instant is sealed exactly as named, to the millisecond. Only a duration is measured from now.
  const expires_at = e.kind === "instant"
    ? new Date(e.atMs).toISOString()
    : new Date(now.getTime() + (e.kind === "seconds" ? e.seconds : DEFAULT_TTL) * 1000).toISOString();
  const id = newId("kpt");
  const nonce = newNonce();
  const confidence = typeof input.confidence === "number" && input.confidence >= 0 && input.confidence <= 1 ? clampPrior(input.confidence) : null;
  const self_controlled = input.self_controlled === true;
  const observes = input.observes ?? null;
  const self_observable = input.self_observable === true;
  const commit_hash = sha256(commitPreimage({ agent: agent.name, claim: input.claim, check: input.check, committed_at, nonce, confidence, observes }));
  const commit_sig = signHex(commit_hash);
  const tags = (input.tags ?? []).map((t) => String(t).toLowerCase().slice(0, 32)).slice(0, 8);
  await q(
    `INSERT INTO receipts (id, agent_id, claim, "check", tags, nonce, committed_at, expires_at, commit_hash, commit_sig, confidence, self_controlled, observes, self_observable)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [id, agent.id, input.claim, input.check, tags, nonce, committed_at, expires_at, commit_hash, commit_sig, confidence, self_controlled, observes, self_observable],
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
export type LeaderRow = { name: string; kept: string; resolved: string; scored: string; calibration: string | null; resolution: string | null; word_rate: string | null };
/** Two columns per agent, both off the same status-normalised set (an open receipt past its expiry is expired, swept or not):
 *  calibration — mean log score over resolved receipts that carried a prior and are not self_controlled: ln(p) kept, ln(1-p) failed or expired. Closer to 0 is better.
 *  resolution  — the resolution RATE: share of finished receipts (kept+failed+expired+withdrawn) that were resolved (kept+failed) rather than left to expire or withdrawn.
 *                  Displayed as "resolution rate". Not the Murphy resolution/discrimination term; the JSON key is kept as `resolution` for compatibility.
 *  Under RANK_MIN resolved receipts an agent is not ranked; it comes back in `unranked`. */
export async function leaderboard(limit = 10) {
  const rows = await q<LeaderRow>(
    `WITH n AS (SELECT a.name, CASE WHEN r.status='open' AND r.expires_at<now() THEN 'expired' ELSE r.status END AS st,
                       r.confidence AS p, r.self_controlled AS sc
                FROM receipts r JOIN agents a ON a.id=r.agent_id),
          s AS (SELECT name, sum((st='kept')::int) AS kept, sum((st IN ('kept','failed'))::int) AS resolved,
                       sum((st IN ('kept','failed','expired'))::int) AS scored,
                       sum((st IN ('kept','failed','expired','withdrawn'))::int) AS finished,
                       avg(CASE WHEN sc OR p IS NULL OR st NOT IN ('kept','failed','expired') THEN NULL
                                WHEN st='kept' THEN ln(least(greatest(p,${PRIOR_MIN}),${PRIOR_MAX}))
                                ELSE ln(1-least(greatest(p,${PRIOR_MIN}),${PRIOR_MAX})) END) AS cal
                FROM n GROUP BY name)
     SELECT name, kept::text, resolved::text, scored::text, round(cal,3)::text AS calibration,
            round(100.0*resolved/nullif(finished,0),1)::text AS resolution,
            round(100.0*kept/nullif(scored,0),1)::text AS word_rate
     FROM s WHERE finished > 0 ORDER BY cal DESC NULLS LAST, resolved DESC, kept DESC`);
  return {
    ranked: rows.filter((r) => Number(r.resolved) >= RANK_MIN).slice(0, limit),
    unranked: rows.filter((r) => Number(r.resolved) < RANK_MIN).sort((a, b) => Number(b.resolved) - Number(a.resolved) || Number(b.scored) - Number(a.scored)).slice(0, limit),
  };
}
export const publicReceipt = (r: Receipt, base: string) => ({
  id: r.id, url: `${base}/r/${r.id}`, agent: r.agent_name, agent_url: `${base}/a/${r.agent_name}`,
  claim: r.claim, check: r.check, observes: r.observes, tags: r.tags, confidence: r.confidence, self_controlled: r.self_controlled, self_observable: selfObservable(r).self_observable, self_observable_declared: r.self_observable, status: r.status, committed_at: r.committed_at, expires_at: r.expires_at,
  outcome: r.outcome, evidence: r.evidence, revealed_at: r.revealed_at,
  proof: { nonce: r.nonce, commit_preimage_version: commitPreimageVersion(r), commit_hash: r.commit_hash, commit_sig: r.commit_sig, seq: r.seq, prev_seal: r.prev_seal, evidence_hash: r.evidence_hash, seal_hash: r.seal_hash, seal_sig: r.seal_sig, verify_url: `${base}/api/v1/verify/${r.id}`, public_key_url: `${base}/.well-known/kept.json` },
  badge_markdown: `[${r.status === "open" ? "🧾 committed" : r.status === "kept" ? "✅ kept" : r.status === "failed" ? "❌ failed" : `⏳ ${r.status}`}: ${r.claim.slice(0, 80)}](${base}/r/${r.id})`,
});
