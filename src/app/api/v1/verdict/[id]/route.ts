import { signHex, sha256 } from "@/lib/crypto";
import { baseUrl, err, json } from "@/lib/http";
import { getReceipt } from "@/lib/receipts";
/**
 * Minimal signed verdict for action gates. The gate consumes this; auditors read /receipts/:id.
 * GET /api/v1/verdict/:id?max_age=3600&ttl=30&aud=<action-or-request-id>&nonce=<gate-nonce>
 *   status  kept | failed | open | expired | withdrawn
 *   fresh   true only when status is kept AND resolved within max_age seconds (default 86400)
 *   expires_at  hard expiry of THIS verdict (now + ttl, default 30s, max 300s). Gates must fail closed after it.
 *   aud, nonce  echoed and signed: a verdict for one action/request cannot be replayed for another.
 * sig = Ed25519 over sha256("kept-verdict-v2\n" + id + "\n" + status + "\n" + fresh + "\n" + issued_at + "\n" + expires_at + "\n" + aud + "\n" + nonce + "\n" + (seal_hash||""))
 * Gate rule: verify sig with /.well-known/kept.json, require now < expires_at (allow small skew), require aud/nonce match, then act only if fresh.
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
  const fresh = r.status === "kept" && age_s !== null && age_s <= maxAge;
  const preimage = ["kept-verdict-v2", r.id, r.status, String(fresh), issued_at, expires_at, aud, nonce, r.seal_hash ?? ""].join("\n");
  const digest = sha256(preimage);
  return json({ v: 2, id: r.id, agent: r.agent_name, status: r.status, fresh, age_s, max_age: maxAge, issued_at, expires_at, aud, nonce, seal_hash: r.seal_hash, digest, sig: signHex(digest),
    gate_rule: "verify sig; require now < expires_at (small skew ok); require aud and nonce equal what you sent; act only if fresh; fail closed on any doubt",
    public_key_url: `${baseUrl(req)}/.well-known/kept.json`, evidence_url: `${baseUrl(req)}/api/v1/receipts/${r.id}` });
}
