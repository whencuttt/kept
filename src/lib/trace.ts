import { createPublicKey, verify } from "node:crypto";
import { q } from "./db";
import { sha256 } from "./crypto";

/** Canonical JSON: keys sorted at every depth, no whitespace. Byte-identical to examples/claude-code-trace/trace.mjs. */
export function canon(v: unknown): string {
  if (v === undefined) return "null";
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const o = v as Record<string, unknown>;
  return "{" + Object.keys(o).sort().map((k) => JSON.stringify(k) + ":" + canon(o[k])).join(",") + "}";
}
/** The two preimages from examples/trace-convention.md. Anyone can recompute them offline. */
export const linkPre = (step_id: string, hashes: string[], prev_interp_hash: string) =>
  ["kept-trace-v1", step_id, [...hashes].sort().join(","), prev_interp_hash].join("\n");
export const interpPre = (link: string, interp: unknown) => ["kept-interp-v1", link, canon(interp)].join("\n");
/** kid = first 16 hex of sha256 of the SPKI PEM, the same rule as crypto.ts keyId() and trace.mjs kidOf(). */
export const kidOf = (pem: string) => sha256(pem).slice(0, 16);
export function verifyWithPem(pem: string, hex: string, sigB64: string) {
  try { return verify(null, Buffer.from(hex, "utf8"), createPublicKey(pem), Buffer.from(sigB64, "base64")); } catch { return false; }
}
/** An Ed25519 SPKI public key, or null. Used to refuse a key that is not one before it is stored. */
export function parsePublicPem(pem: string): string | null {
  try {
    const k = createPublicKey(pem);
    if (k.asymmetricKeyType !== "ed25519") return null;
    return k.export({ type: "spki", format: "pem" }) as string;
  } catch { return null; }
}

export type LinkIn = {
  session_id?: string; step_id?: string; ts?: string; tool_name?: string; tool_output_hashes?: string[];
  field_hashes?: unknown; prev_interp_hash?: string; link?: string; link_sig?: string; kid?: string;
  interp?: unknown; interp_hash?: string;
};
const hex64 = (s: unknown) => typeof s === "string" && /^[0-9a-f]{64}$/.test(s);

/** Upsert one signed link, idempotent on (agent_id, session_id, step_id). An interp posted later fills the same row. */
export async function putLink(agent_id: string, b: LinkIn) {
  const session_id = String(b.session_id ?? "").slice(0, 128);
  const step_id = String(b.step_id ?? "").slice(0, 32);
  const hashes = (Array.isArray(b.tool_output_hashes) ? b.tool_output_hashes : []).filter(hex64).slice(0, 64);
  if (!session_id || !step_id) return { error: "session_id and step_id are required" };
  if (!hex64(b.link) || !b.link_sig || !b.kid) return { error: "link (sha256 hex), link_sig and kid are required" };
  if (!hashes.length) return { error: "tool_output_hashes must hold at least one sha256 hex digest" };
  const prev = typeof b.prev_interp_hash === "string" ? b.prev_interp_hash : "";
  if (b.link !== sha256(linkPre(step_id, hashes, prev))) return { error: "link is not sha256 of its own preimage (step_id, tool_output_hashes, prev_interp_hash)" };
  const interp = b.interp ?? null;
  if (interp != null && b.interp_hash !== sha256(interpPre(b.link!, interp))) return { error: "interp_hash does not cover this link and interpretation" };
  await q(
    `INSERT INTO trace_links (agent_id, session_id, step_id, ts, tool_name, tool_output_hashes, field_hashes, prev_interp_hash, link, link_sig, kid, interp, interp_hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (agent_id, session_id, step_id) DO UPDATE
       SET interp = coalesce(EXCLUDED.interp, trace_links.interp), interp_hash = coalesce(EXCLUDED.interp_hash, trace_links.interp_hash)`,
    [agent_id, session_id, step_id, new Date(b.ts ?? Date.now()).toISOString(), String(b.tool_name ?? "").slice(0, 64), hashes,
     b.field_hashes == null ? null : JSON.stringify(b.field_hashes), prev, b.link, String(b.link_sig).slice(0, 200), String(b.kid).slice(0, 64),
     interp == null ? null : JSON.stringify(interp), interp == null ? null : b.interp_hash],
  );
  return { ok: true as const, session_id, step_id };
}

/** Attach an interpretation to a step the runtime already signed. A step the runtime never signed is a ghost step. */
export async function putInterp(agent_id: string, b: LinkIn) {
  const session_id = String(b.session_id ?? "").slice(0, 128), step_id = String(b.step_id ?? "").slice(0, 32);
  if (!session_id || !step_id || b.interp == null) return { error: "session_id, step_id and interp are required" };
  const rows = await q<{ link: string }>(`SELECT link FROM trace_links WHERE agent_id=$1 AND session_id=$2 AND step_id=$3`, [agent_id, session_id, step_id]);
  if (!rows[0]) return { error: `ghost step: no signed link for ${session_id}/${step_id}`, status: 404 };
  if (b.link && b.link !== rows[0].link) return { error: "interpretation cites a link the runtime did not emit" };
  if (b.interp_hash !== sha256(interpPre(rows[0].link, b.interp))) return { error: "interp_hash does not cover this link and interpretation" };
  await q(`UPDATE trace_links SET interp=$4, interp_hash=$5 WHERE agent_id=$1 AND session_id=$2 AND step_id=$3 AND interp IS NULL`,
    [agent_id, session_id, step_id, JSON.stringify(b.interp), b.interp_hash]);
  return { ok: true as const, session_id, step_id };
}

export type TraceLink = {
  session_id: string; step_id: string; ts: string; tool_name: string; tool_output_hashes: string[];
  field_hashes: Record<string, string> | null; prev_interp_hash: string; link: string; link_sig: string; kid: string;
  interp: unknown; interp_hash: string | null; verified: boolean | null; link_hash_ok: boolean; kid_known: boolean | null; interp_hash_ok: boolean | null;
};
export type TraceChain = {
  agent: string; kid: string | null; public_key_pem: string | null; total: number;
  summary: { total: number; signature_verified: number; link_hash_ok: number; interpretations: number; signed_from: string | null; signed_to: string | null; signed_run: number; signed_run_session: string | null; contiguous: boolean; note: string };
  links: TraceLink[];
};

const iso = (d: unknown) => (d instanceof Date ? d.toISOString() : new Date(String(d)).toISOString());
const stepNo = (s: string) => { const n = Number(String(s).replace(/^s/, "")); return Number.isFinite(n) ? n : NaN; };

/** The chain for one agent, newest first, with a verification summary over the whole chain (not just the page). */
export async function traceChain(name: string, opts: { session?: string; limit?: number } = {}): Promise<TraceChain | null> {
  const a = await q<{ id: string; name: string; trace_kid: string | null; trace_public_key_pem: string | null }>(
    `SELECT id, name, trace_kid, trace_public_key_pem FROM agents WHERE name=$1`, [name.toLowerCase()]);
  if (!a[0]) return null;
  const pem = a[0].trace_public_key_pem;
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);
  const where = opts.session ? `agent_id=$1 AND session_id=$2` : `agent_id=$1`;
  const args = opts.session ? [a[0].id, opts.session] : [a[0].id];
  type Row = { session_id: string; step_id: string; link: string; link_sig: string; kid: string; tool_output_hashes: string[]; prev_interp_hash: string; interp_hash: string | null };
  const all = await q<Row>(
    `SELECT session_id, step_id, link, link_sig, kid, tool_output_hashes, prev_interp_hash, interp_hash FROM trace_links WHERE ${where} ORDER BY session_id, ts LIMIT 5000`, args);
  const ok = (r: Row) => r.link === sha256(linkPre(r.step_id, r.tool_output_hashes, r.prev_interp_hash ?? "")) &&
    (!pem || (r.kid === a[0].trace_kid && verifyWithPem(pem, r.link, r.link_sig)));
  // Longest run of consecutive step numbers inside one session where the link covers its own output
  // hashes and its signature verifies. Step numbers restart per session, so a run never spans sessions.
  let best: { from: string; to: string; n: number; session: string } | null = null, run = 0, first = "", lastN = NaN, lastSid = "";
  for (const r of all) {
    const n = stepNo(r.step_id);
    if (ok(r) && run > 0 && r.session_id === lastSid && n === lastN + 1) run++;
    else { run = ok(r) ? 1 : 0; first = r.step_id; }
    lastN = n; lastSid = r.session_id;
    if (run > 0 && (!best || run >= best.n)) best = { from: first, to: r.step_id, n: run, session: r.session_id };
  }
  const verifiedCount = pem ? all.filter((r) => r.kid === a[0].trace_kid && verifyWithPem(pem, r.link, r.link_sig)).length : 0;
  const rows = await q(`SELECT * FROM trace_links WHERE ${where} ORDER BY ts DESC LIMIT ${limit}`, args);
  const links: TraceLink[] = rows.map((r) => {
    const hashes: string[] = r.tool_output_hashes ?? [];
    const link_hash_ok = r.link === sha256(linkPre(r.step_id, hashes, r.prev_interp_hash ?? ""));
    const kid_known = pem ? r.kid === a[0].trace_kid : null;
    return {
      session_id: r.session_id, step_id: r.step_id, ts: iso(r.ts), tool_name: r.tool_name, tool_output_hashes: hashes,
      field_hashes: r.field_hashes ?? null, prev_interp_hash: r.prev_interp_hash ?? "", link: r.link, link_sig: r.link_sig, kid: r.kid,
      interp: r.interp ?? null, interp_hash: r.interp_hash ?? null, link_hash_ok, kid_known,
      verified: pem ? link_hash_ok && kid_known === true && verifyWithPem(pem, r.link, r.link_sig) : null,
      interp_hash_ok: r.interp == null ? null : r.interp_hash === sha256(interpPre(r.link, r.interp)),
    };
  });
  const interps = all.filter((r) => r.interp_hash).length;
  return {
    agent: a[0].name, kid: a[0].trace_kid, public_key_pem: pem, total: all.length,
    summary: {
      total: all.length, signature_verified: verifiedCount, link_hash_ok: all.filter((r) => r.link === sha256(linkPre(r.step_id, r.tool_output_hashes, r.prev_interp_hash ?? ""))).length,
      interpretations: interps, signed_from: best?.from ?? null, signed_to: best?.to ?? null, signed_run: best?.n ?? 0, signed_run_session: best?.session ?? null,
      contiguous: !!best && best.n === all.length,
      note: pem
        ? "Each link is signed over its own tool output hashes. Steps with no interpretation share a prev_interp_hash, which reads as 'the agent recorded no structured reading between these steps' — so ordering across such steps is asserted by the runtime's timestamps, not pinned by the hashes."
        : "No trace key registered for this agent: signatures cannot be checked. POST /api/v1/agents/me/trace-key.",
    },
    links,
  };
}
