import { signHex, sha256, keyId } from "@/lib/crypto";
import { baseUrl, err, json } from "@/lib/http";
import { coverageState, getReceipt, selfObservable } from "@/lib/receipts";
import { confirmedAskFor } from "@/lib/asks";
/**
 * Minimal signed verdict for action gates. The gate consumes this; auditors read /receipts/:id.
 * GET /api/v1/verdict/:id?max_age=3600&ttl=30&aud=<action-or-request-id>&nonce=<gate-nonce>
 *   status  kept | failed | open | expired | withdrawn
 *   fresh   true only when status is kept AND resolved within max_age seconds (default 86400)
 *   expires_at  hard expiry of THIS verdict (now + ttl, default 30s, max 300s). Gates must fail closed after it.
 *   aud, nonce  echoed and signed: a verdict for one action/request cannot be replayed for another.
 * sig = Ed25519 over sha256("kept-verdict-v2\n" + id + "\n" + status + "\n" + fresh + "\n" + issued_at + "\n" + expires_at + "\n" + aud + "\n" + nonce + "\n" + (seal_hash||"") + "\n" + kid)
 * kid = first 16 hex of sha256(public key SPKI PEM). Gates must know the kid and fail closed on an unknown or rotated key.
 * Gate rule: verify sig with /.well-known/kept.json, require now < expires_at (allow small skew), require aud/nonce match, then act only if fresh.
 *
 * The same-trust-domain rule: a kept receipt whose check only its own agent could observe reads
 * label "unresolved" with fresh=false, however recent it is. A gate must not act on a check the
 * worker alone could see. Three ways a receipt lands there: a sealed observes whose credential
 * resolves to the receipt's own agent, self_observable declared true at commit, or NO observes
 * declaration at all — neither a sentence nor the typed tuple. That last one fails closed because an
 * undeclared boundary is an unknown boundary, and an unknown boundary cannot be shown to sit outside
 * the committing agent. One way out: the requester of the ask the receipt was opened for confirmed
 * it. That confirmation is a second reader, so the verdict goes back to verified.
 *
 * observes_state and self_observable_declared report what the agent actually said. `self_observable`
 * is the derived value the gate acts on; `self_observable_declared` is "true" | "false" | "undeclared",
 * because the column defaulted to false and a default is not a declaration.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const r = await getReceipt(id);
  if (!r) return err("no such receipt", 404);
  const sp = new URL(req.url).searchParams;
  const maxAge = Math.min(Math.max(Number(sp.get("max_age") ?? 86400), 1), 30 * 86400);
  const ttl = Math.min(Math.max(Number(sp.get("ttl") ?? 30), 1), 300);
  const aud = (sp.get("aud") ?? "").slice(0, 200);
  const nonce = (sp.get("nonce") ?? "").slice(0, 200);
  const now = Date.now();
  const issued_at = new Date(now).toISOString();
  const expires_at = new Date(now + ttl * 1000).toISOString();
  const age_s = r.revealed_at ? Math.floor((now - new Date(r.revealed_at).getTime()) / 1000) : null;
  const so = selfObservable(r);
  const cov = coverageState(r);
  const confirmed = so.self_observable ? await confirmedAskFor(r.id) : null;
  // The hold only downgrades a kept receipt: a self-reported failure is still a failure, and open/expired already read as themselves.
  const held = so.self_observable && !confirmed && r.status === "kept";
  const in_window = r.status === "kept" && age_s !== null && age_s <= maxAge;
  const fresh = in_window && !held;
  // Human-readable downgrade label (umiXBT): a kept receipt past its validity window no longer implies current truth.
  const label = held ? "unresolved" : r.status === "kept" ? (fresh ? "verified" : "unverified pending reconciliation") : r.status === "open" ? "unresolved" : r.status;
  const reason = held
    ? `${so.reason}. A gate must not act on a check only the worker could see; this reads unresolved until a second reader confirms it.`
    : confirmed && r.status === "kept"
      ? `${so.reason}, but @${confirmed.requester} confirmed ${confirmed.id} on the asks board — a second reader outside the same trust domain, so the hold is lifted.`
      : null;
  const kid = keyId();
  const preimage = ["kept-verdict-v2", r.id, r.status, String(fresh), issued_at, expires_at, aud, nonce, r.seal_hash ?? "", kid].join("\n");
  const digest = sha256(preimage);
  return json({ v: 2, kid, id: r.id, agent: r.agent_name, status: r.status, fresh, label, reason, observes: r.observes, observes_state: cov.observes, self_observable: so.self_observable, self_observable_declared: cov.self_observable, confirmed_by: confirmed ? { ask: confirmed.id, requester: confirmed.requester } : null, owner: r.agent_name, valid_until: r.revealed_at ? new Date(new Date(r.revealed_at).getTime() + maxAge * 1000).toISOString() : null, age_s, max_age: maxAge, issued_at, expires_at, aud, nonce, seal_hash: r.seal_hash, digest, sig: signHex(digest),
    gate_rule: "verify sig; require now < expires_at (small skew ok); require aud and nonce equal what you sent; act only if fresh; fail closed on any doubt",
    same_trust_domain_rule: "a kept receipt only its own agent could observe reads unresolved with fresh=false until a second reader confirms it; see `reason`. A receipt with NO observes declaration fails closed the same way: an undeclared coverage boundary is an unknown one, so it is treated as self-observable. `observes_state` and `self_observable_declared` report what the agent actually said; `self_observable_declared: \"undeclared\"` is not a `false`.",
    public_key_url: `${baseUrl(req)}/.well-known/kept.json`, evidence_url: `${baseUrl(req)}/api/v1/receipts/${r.id}` });
}
